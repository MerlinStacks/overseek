#!/usr/bin/env node
/** One-time repair for the September 2026 db-push installation, not a general
 * migration runner. No existing migration files or successful records are edited.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { Client } = require('pg');
const { splitSql, ident } = require('./migration-repair/sql');
const { catalogue, differences, key } = require('./migration-repair/catalogue');
const { buildCustomReference } = require('./migration-repair/plan');

const ROOT = path.resolve(__dirname, '..');
const HISTORY_HASH = 'c60d2867666e1fc3b592eb4be29de5a951abdb22690218a8427702c37fe31377';
const SCHEMA_HASH = 'bd576b4a0c8416ffed0a54aebda8cae72e854b73eaa4751581eb9435d829c9e5';
const FIRST = '20260107060000_add_cascade_delete_to_account_relations';
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function loadMigrations() {
    const dir = path.join(ROOT, 'prisma/migrations');
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory() && !fs.existsSync(path.join(dir, entry.name, 'migration.sql'))) {
            throw new Error(`Migration directory has no migration.sql: ${entry.name}`);
        }
    }
    const migrations = fs.readdirSync(dir).sort().filter(name => fs.existsSync(path.join(dir, name, 'migration.sql')))
        .map(name => { const sql = fs.readFileSync(path.join(dir, name, 'migration.sql'), 'utf8'); return { name, sql, hash: digest(sql) }; });
    if (digest(JSON.stringify(migrations.map(({ name, hash }) => ({ name, hash })))) !== HISTORY_HASH ||
        digest(fs.readFileSync(path.join(ROOT, 'prisma/schema.prisma'))) !== SCHEMA_HASH) {
        throw new Error('Repair specification does not match this image. Use the reviewed recovery image.');
    }
    return migrations;
}

function connectionUrl() {
    if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
    const url = new URL('postgresql://postgres:5432/overseek');
    url.username = process.env.POSTGRES_USER || 'admin';
    url.password = process.env.POSTGRES_PASSWORD || 'password';
    url.hostname = process.env.POSTGRES_HOST || 'postgres';
    url.port = process.env.POSTGRES_PORT || '5432';
    url.pathname = '/' + (process.env.POSTGRES_DB || 'overseek');
    return url.toString();
}

function baselineSql(url) {
    const result = spawnSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'diff',
        '--from-empty', '--to-schema', 'prisma/schema.prisma', '--config', 'prisma/prisma.config.ts', '--script'], {
        cwd: ROOT, env: { ...process.env, DATABASE_URL: url, PRISMA_HIDE_UPDATE_MESSAGE: 'true' },
        encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 120000,
    });
    if (result.status !== 0 || !result.stdout?.includes('CREATE TABLE "Account"')) {
        throw new Error('Could not generate the reference schema with Prisma. No repair was attempted.');
    }
    return result.stdout;
}

function assertSame(label, expected, actual, extras = false) {
    const errors = differences(expected, actual, extras);
    if (errors.length) throw new Error(`${label} differs: ${errors.slice(0, 15).join(', ')}. Repair stopped; do not mark migrations applied.`);
}

async function repair(db, { apply = false, baseline, migrations = loadMigrations(), log = console.log } = {}) {
    const reference = 'migration_repair_' + crypto.randomBytes(8).toString('hex');
    let stage = 'preflight';
    await db.query('BEGIN');
    try {
        await db.query("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='120s'; SET LOCAL search_path=public,pg_catalog");
        // Same lock key used by Prisma Migrate, held through verification/history.
        const lock = await db.query('SELECT pg_try_advisory_xact_lock(72707369) AS locked');
        if (!lock.rows[0].locked) throw new Error('Another migration is running; retry after it completes.');
        const tables = (await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows;
        if (!tables.some(row => row.tablename === '_prisma_migrations')) throw new Error('Migration history is missing; this repair is not a fresh-install baseline.');
        await db.query(`LOCK TABLE ${tables.map(row => `public.${ident(row.tablename)}`).join(',')} IN ACCESS EXCLUSIVE MODE`);
        const history = (await db.query('SELECT migration_name,checksum,finished_at,rolled_back_at FROM "_prisma_migrations"')).rows;
        const known = new Map(migrations.map(m => [m.name, m]));
        for (const row of history) {
            if (!known.has(row.migration_name)) throw new Error(`Unknown migration history: ${row.migration_name}`);
            if (!row.finished_at && !row.rolled_back_at) throw new Error(`Unresolved failed migration: ${row.migration_name}`);
            if (row.finished_at && !row.rolled_back_at && row.checksum !== known.get(row.migration_name).hash) {
                throw new Error(`Applied migration checksum mismatch: ${row.migration_name}`);
            }
        }
        const applied = new Set(history.filter(row => row.finished_at && !row.rolled_back_at).map(row => row.migration_name));
        const pending = migrations.filter(m => !applied.has(m.name));
        if (pending.some(m => m.name < FIRST)) throw new Error('Pre-January baseline is incomplete. This repair only handles the verified post-widget backlog.');
        log(`[Repair] ${pending.length} pending migrations; mode=${apply ? 'apply' : 'rehearsal (ROLLBACK)'}.`);

        stage = 'reference schema';
        await db.query(`CREATE SCHEMA ${ident(reference)}; SET LOCAL search_path=${ident(reference)},pg_catalog`);
        for (const sql of splitSql(baseline)) {
            if (/^CREATE SCHEMA/.test(sql)) continue;
            await db.query(sql);
        }
        const base = await catalogue(db, reference);
        const data = await buildCustomReference(db, migrations.filter(m => m.name >= FIRST));
        const expected = await catalogue(db, reference);
        const actual = await catalogue(db, 'public');
        // Compare the complete current Prisma schema, not just object existence.
        assertSame('Columns/defaults/nullability', base.columns, actual.columns);
        assertSame('Enums', base.enums, actual.enums);
        assertSame('Primary/foreign keys', base.constraints, actual.constraints.filter(c => c.type !== 'c'));
        assertSame('Prisma indexes', base.indexes, actual.indexes, true);
        // Existing custom objects must already equal their final specification.
        // Never replace unknown functions/triggers or weaken a constraint.
        for (const kind of ['indexes', 'constraints', 'functions', 'triggers']) {
            assertSame(`Existing ${kind}`, actual[kind], expected[kind], true);
        }
        const active = await db.query('SELECT count(*)::int AS count FROM "ReceiptAccount" WHERE active OR "desiredActive"');
        if (active.rows[0].count && pending.length) throw new Error('Deactivate delivery display before repairing its database prerequisites.');

        stage = 'constraints and indexes';
        const install = definition => definition.replaceAll('__schema__.', 'public.');
        for (const constraint of expected.constraints) {
            if (actual.constraints.some(row => key(row) === key(constraint))) continue;
            if (constraint.type !== 'c') throw new Error('Unexpected missing structural constraint');
            await db.query(`ALTER TABLE public.${ident(constraint.table_name)} ADD CONSTRAINT ${ident(constraint.name)} ${install(constraint.definition)}`);
        }
        for (const index of expected.indexes) {
            if (!actual.indexes.some(row => key(row) === key(index))) await db.query(install(index.definition));
        }
        stage = 'functions';
        for (const fn of expected.functions) {
            if (actual.functions.some(row => key(row) === key(fn))) continue;
            await db.query(install(fn.definition));
            if (fn.comment !== null) {
                // Comments originate only in pinned repository migrations.
                await db.query(`COMMENT ON FUNCTION public.${ident(fn.name)}(${fn.arguments}) IS '${fn.comment.replaceAll("'", "''")}'`);
            }
        }
        // All data migrations execute only if their history is pending. No stock
        // quantities, receipt deltas, successful ack revisions or PO quantities
        // are rewritten. Preserve later application values in recovery backfills.
        for (const item of data) {
            if (applied.has(item.migration)) continue;
            stage = `backfill ${item.migration}`;
            const result = await db.query(item.sql);
            log(`[Repair] ${item.migration}: ${result.rowCount} affected rows.`);
        }
        stage = 'triggers';
        for (const trigger of expected.triggers) {
            if (!actual.triggers.some(row => key(row) === key(trigger))) await db.query(install(trigger.definition));
        }
        stage = 'final verification';
        const final = await catalogue(db, 'public');
        for (const kind of Object.keys(expected)) assertSame(`Final ${kind}`, expected[kind], final[kind]);
        // Commit migration history atomically with the verified repair. This is
        // equivalent to migrate resolve --applied, but cannot leave half a repair.
        for (const migration of pending) {
            await db.query(`INSERT INTO "_prisma_migrations"
                (id,checksum,migration_name,started_at,finished_at,applied_steps_count,logs)
                VALUES ($1,$2,$3,now(),now(),0,$4)`, [crypto.randomUUID(), migration.hash, migration.name,
                'Verified September 2026 db-push reconciliation: current schema, custom SQL and pending backfills.']);
        }
        await db.query(`DROP SCHEMA ${ident(reference)} CASCADE`);
        await db.query(apply ? 'COMMIT' : 'ROLLBACK');
        log(`[Repair] ${apply ? 'COMMITTED' : 'REHEARSAL PASSED; ALL CHANGES ROLLED BACK'}: ${pending.length} migrations, ${expected.functions.length} functions, ${expected.triggers.length} triggers verified.`);
        return { pending: pending.length, functions: expected.functions.length, triggers: expected.triggers.length };
    } catch (error) {
        await db.query('ROLLBACK');
        // Do not print PostgreSQL DETAIL (may contain customer/row data) or URLs.
        if (error.code) throw new Error(`Repair rolled back at ${stage}: PostgreSQL ${error.code}${error.constraint ? ` (${error.constraint})` : ''}. No migration history was advanced.`);
        throw error;
    }
}

async function main() {
    const args = process.argv.slice(2);
    if (args.length !== 1 || !['--check', '--apply'].includes(args[0])) throw new Error('Usage: node scripts/repair_migration_history.js --check | --apply');
    const migrations = loadMigrations();
    const url = connectionUrl();
    const parsed = new URL(url);
    if (parsed.searchParams.has('schema') && parsed.searchParams.get('schema') !== 'public') throw new Error('Repair supports public schema only.');
    const baseline = baselineSql(url);
    const db = new Client({ connectionString: url, application_name: 'overseek-migration-repair', connectionTimeoutMillis: 10000 });
    await db.connect();
    try { await repair(db, { apply: args[0] === '--apply', baseline, migrations }); }
    finally { await db.end(); }
}
if (require.main === module) main().catch(error => { console.error(`[Repair] ${error.message}`); process.exitCode = 1; });
module.exports = { repair, loadMigrations, baselineSql, connectionUrl };
