const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Client } = require('pg');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { repair, loadMigrations, baselineSql } = require('../repair_migration_history');

const url = process.env.MIGRATION_REPAIR_TEST_DATABASE_URL;
test('db-push history repair is atomic, verified, preserves data and is repeatable', { skip: !url, timeout: 180000 }, async t => {
    assert.match(new URL(url).pathname, /^\/migration_repair_test_[a-z0-9_]+$/);
    const db = new Client({ connectionString: url });
    await db.connect();
    const baseline = baselineSql(url);
    const migrations = loadMigrations();
    const run = apply => repair(db, { baseline, migrations, apply, log: () => {} });
    try {
        await db.query(baseline);
        await db.query(`CREATE TABLE "_prisma_migrations" (
            id varchar(36) PRIMARY KEY, checksum varchar(64) NOT NULL, finished_at timestamptz,
            migration_name varchar(255) NOT NULL, logs text, rolled_back_at timestamptz,
            started_at timestamptz NOT NULL DEFAULT now(), applied_steps_count integer NOT NULL DEFAULT 0)`);
        for (const m of migrations.filter(m => m.name < '20260107060000')) {
            await db.query('INSERT INTO "_prisma_migrations" (id,checksum,migration_name,finished_at) VALUES ($1,$2,$3,now())', [m.name.slice(0, 14), m.hash, m.name]);
        }
        await db.query(`INSERT INTO "Account" (id,name,"wooUrl","wooConsumerKey","wooConsumerSecret","updatedAt") VALUES ('a','Test','https://example.test','test','test',now());
            INSERT INTO "WooProduct" (id,"accountId","wooId",name,"stockQuantity","rawData","updatedAt",status)
              VALUES ('p','a',123,'Product',17,'{"status":"publish"}',now(),'private');
            INSERT INTO "DeliverySyncAccount" ("accountId","updatedAt","capabilityStatus","inboundCapabilityStatus") VALUES ('a',now(),'supported','supported');
            INSERT INTO "DeliveryInputSync" (id,"accountId",scope,"entityId",payload,status,"desiredRevision","ackRevision","updatedAt")
              VALUES ('s','a','product',123,'{}','synced',5,5,now()),
                     ('in','a','inbound',123,'{"targets":[]}','synced',4,4,now());
            INSERT INTO "ReceiptOwner" ("accountId","stockOwnerWooId","lastSequence","appliedSequence") VALUES ('a',123,1,1);
            INSERT INTO "ReceiptCycle" (id,"accountId","purchaseOrderId") VALUES ('cycle','a','historical-po');
            INSERT INTO "ReceiptOperation" ("operationId","accountId","cycleId","purchaseOrderId","productId","productWooId","variationWooId","stockOwnerWooId",sequence,delta,state)
              VALUES ('operation','a','cycle','historical-po','p',123,124,123,1,2,'applied');`);
        await t.test('failed history is not silently resolved', async () => {
            const m = migrations.find(m => m.name === '20260115000000_add_sms_channel');
            await db.query('INSERT INTO "_prisma_migrations" (id,checksum,migration_name) VALUES ($1,$2,$3)', ['failed', m.hash, m.name]);
            await assert.rejects(run(false), /Unresolved failed migration/);
            await db.query('DELETE FROM "_prisma_migrations" WHERE id=\'failed\'');
        });
        await t.test('same-named wrong schema is rejected', async () => {
            await db.query('ALTER TABLE "DashboardWidget" ALTER COLUMN "sortOrder" SET DEFAULT 99');
            await assert.rejects(run(false), /Columns\/defaults\/nullability differs/);
            await db.query('ALTER TABLE "DashboardWidget" ALTER COLUMN "sortOrder" SET DEFAULT 0');
        });
        await t.test('automatic repair rejects unreviewed failures and changed checksums', async () => {
            for (const name of ['20260115000000_add_sms_channel', '20260116193056_add_sync_log_retry']) {
                const m = migrations.find(m => m.name === name);
                await db.query('INSERT INTO "_prisma_migrations" (id,checksum,migration_name) VALUES ($1,$2,$3)',
                    ['auto-failed', name.includes('sms_channel') ? '0'.repeat(64) : m.hash, m.name]);
                await assert.rejects(repair(db, { baseline, apply: true, automatic: true, log: () => {} }), /Unresolved failed migration/);
                assert.equal((await db.query('SELECT rolled_back_at FROM "_prisma_migrations" WHERE id=\'auto-failed\'')).rows[0].rolled_back_at, null);
                await db.query('DELETE FROM "_prisma_migrations" WHERE id=\'auto-failed\'');
            }
        });
        await t.test('automatic failed-widget repair rolls back history on schema mismatch and late backfill failure', async () => {
            await db.query('UPDATE "_prisma_migrations" SET finished_at=NULL,logs=\'original failure\' WHERE migration_name=\'20260107000000_add_widget_sort_order\'');
            await db.query('ALTER TABLE "DashboardWidget" ALTER COLUMN "sortOrder" SET DEFAULT 99');
            await assert.rejects(repair(db, { baseline, apply: true, automatic: true, log: () => {} }), /Columns\/defaults\/nullability differs/);
            await db.query('ALTER TABLE "DashboardWidget" ALTER COLUMN "sortOrder" SET DEFAULT 0');
            await db.query(`INSERT INTO "WooOrder" (id,"accountId","wooId",number,status,currency,total,"rawData","dateCreated","dateModified","updatedAt")
                VALUES ('auto-bad','a',998,'998','pending','AUD',0,'{"date_created_gmt":"private-invalid-value"}',now(),now(),now())`);
            await assert.rejects(repair(db, { baseline, apply: true, automatic: true, log: () => {} }), /22007/);
            const row = (await db.query('SELECT finished_at,rolled_back_at,logs FROM "_prisma_migrations" WHERE migration_name=\'20260107000000_add_widget_sort_order\'')).rows[0];
            assert.deepEqual(row, { finished_at: null, rolled_back_at: null, logs: 'original failure' });
            assert.equal((await db.query('SELECT count(*)::int AS n FROM "_prisma_migrations"')).rows[0].n, 19);
            await db.query('DELETE FROM "WooOrder" WHERE id=\'auto-bad\'');
            await db.query('UPDATE "_prisma_migrations" SET finished_at=now() WHERE migration_name=\'20260107000000_add_widget_sort_order\'');
        });
        await t.test('invalid data rolls back checks and history', async () => {
            await db.query('UPDATE "WooProduct" SET "productionMinDays"=10,"productionMaxDays"=2');
            await assert.rejects(run(true), /23514/);
            assert.equal((await db.query('SELECT count(*)::int AS n FROM "_prisma_migrations"')).rows[0].n, 19);
            await db.query('UPDATE "WooProduct" SET "productionMinDays"=NULL,"productionMaxDays"=NULL');
        });
        await t.test('a late backfill failure rolls back already installed functions', async () => {
            await db.query(`INSERT INTO "WooOrder" (id,"accountId","wooId",number,status,currency,total,"rawData","dateCreated","dateModified","updatedAt")
                VALUES ('bad','a',999,'999','pending','AUD',0,'{"date_created_gmt":"private-invalid-value"}',now(),now(),now())`);
            await assert.rejects(run(true), error => /backfill 20260123000000.*22007/.test(error.message) && !error.message.includes('private-invalid-value'));
            assert.equal((await db.query("SELECT count(*)::int AS n FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'delivery_%'")).rows[0].n, 0);
            assert.equal((await db.query('SELECT count(*)::int AS n FROM "_prisma_migrations"')).rows[0].n, 19);
            await db.query('DELETE FROM "WooOrder" WHERE id=\'bad\'');
        });
        await t.test('a concurrent Prisma migration prevents repair', async () => {
            const other = new Client({ connectionString: url });
            await other.connect();
            try {
                await other.query('SELECT pg_advisory_lock(72707369)');
                await assert.rejects(run(true), /Another migration is running/);
            } finally { await other.end(); }
        });
        await t.test('rehearsal rolls back every change', async () => {
            const result = await run(false);
            assert.equal(result.pending, 41);
            assert.ok(result.functions >= 17);
            assert.ok(result.triggers >= 18);
            assert.equal((await db.query("SELECT count(*)::int AS n FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'delivery_%'")).rows[0].n, 0);
            assert.equal((await db.query('SELECT count(*)::int AS n FROM "_prisma_migrations"')).rows[0].n, 19);
        });
        await t.test('apply installs final SQL and records the complete history', async () => {
            await db.query('UPDATE "_prisma_migrations" SET finished_at=NULL WHERE migration_name=\'20260107000000_add_widget_sort_order\'');
            const sms = migrations.find(m => m.name === '20260115000000_add_sms_channel');
            await db.query('INSERT INTO "_prisma_migrations" (id,checksum,migration_name,logs) VALUES ($1,$2,$3,$4)', ['failed-sms', sms.hash, sms.name, 'original SMS failure']);
            // Run the real startup runner: Prisma P3009 -> automatic repair ->
            // real migrate deploy verification, using only this disposable DB.
            const result = spawnSync(process.execPath, ['scripts/startup_migrations.js'], {
                cwd: path.resolve(__dirname, '../..'),
                env: { ...process.env, DATABASE_URL: url, MIGRATION_AUTO_REPAIR: 'true' },
                encoding: 'utf8', timeout: 60000,
            });
            assert.equal(result.status, 0, result.stderr);
            assert.match(result.stderr, /P3009/);
            assert.match(result.stdout, /COMMITTED: 42 migrations/);
            assert.match(result.stdout, /No pending migrations/);
            assert.equal((await db.query('SELECT count(*)::int AS n FROM "_prisma_migrations"')).rows[0].n, 62);
            const attempts = (await db.query('SELECT logs,rolled_back_at FROM "_prisma_migrations" WHERE finished_at IS NULL')).rows;
            assert.equal(attempts.length, 2);
            assert.ok(attempts.every(row => row.rolled_back_at && row.logs.startsWith('original')));
            const product = (await db.query('SELECT status,"stockQuantity" FROM "WooProduct" WHERE id=\'p\'')).rows[0];
            assert.deepEqual(product, { status: 'private', stockQuantity: 17 });
            const input = (await db.query('SELECT status,"desiredRevision"::text,"ackRevision"::text FROM "DeliveryInputSync" WHERE id=\'s\'')).rows[0];
            assert.deepEqual(input, { status: 'synced', desiredRevision: '5', ackRevision: '5' });
            assert.equal((await db.query('SELECT "capabilityStatus" FROM "DeliverySyncAccount" WHERE "accountId"=\'a\'')).rows[0].capabilityStatus, 'supported');
            assert.equal((await db.query('SELECT delta FROM "ReceiptOperation" WHERE "operationId"=\'operation\'')).rows[0].delta, 2);
            await assert.rejects(db.query('UPDATE "ReceiptOperation" SET delta=3 WHERE "operationId"=\'operation\''), /immutable/);
            assert.equal((await db.query('SELECT "ackRevision"::text AS ack FROM "DeliveryInputSync" WHERE id=\'in\'')).rows[0].ack, '4');
            await db.query('UPDATE "WooProduct" SET "productionMinDays"=0,"productionMaxDays"=1 WHERE id=\'p\'');
            assert.equal((await db.query('SELECT count(*)::int AS n FROM "DeliveryInboundDirtyTarget" WHERE "accountId"=\'a\' AND "wooId"=123')).rows[0].n, 1);
        });
        await t.test('repeat apply is a verified no-op', async () => {
            const before = (await db.query('SELECT row_to_json(s) AS value FROM "DeliveryInputSync" s WHERE id=\'s\'')).rows;
            const result = await run(true);
            assert.equal(result.pending, 0);
            assert.deepEqual((await db.query('SELECT row_to_json(s) AS value FROM "DeliveryInputSync" s WHERE id=\'s\'')).rows, before);
        });
        await t.test('Prisma migrate deploy accepts the repaired history', () => {
            const result = spawnSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy', '--config', 'prisma/prisma.config.ts'], {
                cwd: path.resolve(__dirname, '../..'), env: { ...process.env, DATABASE_URL: url }, encoding: 'utf8', timeout: 60000,
            });
            assert.equal(result.status, 0, result.stderr);
            assert.match(result.stdout, /No pending migrations/);
        });
        await t.test('changed trigger definitions cannot be silently trusted', async () => {
            await db.query('ALTER TABLE "WooProduct" DISABLE TRIGGER delivery_product_write');
            await assert.rejects(run(true), /Existing triggers differs/);
            await db.query('ALTER TABLE "WooProduct" ENABLE TRIGGER delivery_product_write');
        });
        await t.test('scratch schemas never survive', async () => {
            assert.equal((await db.query("SELECT count(*)::int AS n FROM pg_namespace WHERE nspname LIKE 'migration_repair_%'")).rows[0].n, 0);
        });
    } finally { await db.end(); }
});
