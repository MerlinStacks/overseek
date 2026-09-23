import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hasFreshnessTestDatabase, openFreshnessTestDatabase } from './__tests__/freshnessDatabase';

const m = vi.hoisted(() => ({ db: null as any }));
vi.mock('../../utils/prisma', () => ({ prisma: {
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
        const sql = strings.reduce((text, part, i) => text + (i ? `$${i}` : '') + part, '');
        return (await m.db.query(sql, values)).rows;
    },
} }));
vi.mock('../woo', () => ({ WooService: {} }));
vi.mock('./resync', () => ({ enqueueDeliveryResync: vi.fn(), drainDeliveryResyncs: vi.fn() }));
vi.mock('./inboundResync', () => ({ drainInboundBuilds: vi.fn() }));
import { selectDeliveryInput } from './sync';

describe.skipIf(!hasFreshnessTestDatabase)('source-current dispatch selection (isolated PostgreSQL)', () => {
    beforeEach(async () => {
        m.db = await openFreshnessTestDatabase();
        await m.db.exec(`
            CREATE TABLE "DeliverySyncAccount" ("accountId" text PRIMARY KEY, "inboundGeneration" int, "inboundCapabilityStatus" text, "inboundRequested" boolean);
            CREATE TABLE "DeliveryInboundDirtyTarget" ("accountId" text, "wooId" int, PRIMARY KEY ("accountId", "wooId"));
            CREATE TABLE "DeliveryInputSync" (id text PRIMARY KEY, "accountId" text, scope text DEFAULT 'inbound', "entityId" int,
                status text DEFAULT 'pending', "inboundGeneration" int DEFAULT 2, priority int DEFAULT 2,
                "nextAttemptAt" timestamptz DEFAULT '2026-01-01', "leaseExpiresAt" timestamptz, payload jsonb DEFAULT '{"targets":[]}');
            INSERT INTO "DeliverySyncAccount" VALUES ('a',2,'supported',true),('b',2,'supported',true);
            INSERT INTO "DeliveryInputSync" (id,"accountId","entityId") VALUES ('a1','a',1),('a2','a',2),('a3','a',3),('b1','b',1);
        `);
    });
    afterEach(async () => { await m.db?.close(); m.db = null; });
    it('continues sending other products through an uninterrupted dirty-target stream, scoped per tenant', async () => {
        await m.db.exec(`INSERT INTO "DeliveryInboundDirtyTarget" VALUES ('a',1)`);
        for (const id of ['a2', 'a3']) {
            expect((await selectDeliveryInput('a'))?.id).toBe(id);
            await m.db.query(`UPDATE "DeliveryInputSync" SET status='synced' WHERE id=$1`, [id]);
            await m.db.exec(`DELETE FROM "DeliveryInboundDirtyTarget"; INSERT INTO "DeliveryInboundDirtyTarget" VALUES ('a',1)`);
        }
        expect(await selectDeliveryInput('a')).toBeUndefined();
        expect((await selectDeliveryInput('b'))?.id).toBe('b1');
        await m.db.exec(`DELETE FROM "DeliveryInboundDirtyTarget"`);
        expect((await selectDeliveryInput('a'))?.id).toBe('a1');
    });
    it('excludes old-generation tombstones, parked and leased inputs before LIMIT', async () => {
        await m.db.exec(`UPDATE "DeliveryInputSync" SET "inboundGeneration"=1 WHERE id='a1';
            UPDATE "DeliveryInputSync" SET "leaseExpiresAt"=NOW()+INTERVAL '2 minutes' WHERE id='a2';`);
        expect((await selectDeliveryInput('a'))?.id).toBe('a3');
        await m.db.exec(`UPDATE "DeliveryInputSync" SET status='failed' WHERE id='a3'`);
        expect(await selectDeliveryInput('a')).toBeUndefined();
        await m.db.exec(`UPDATE "DeliveryInputSync" SET "leaseExpiresAt"=NOW()-INTERVAL '1 second' WHERE id='a2'`);
        expect((await selectDeliveryInput('a'))?.id).toBe('a2');
    });
    it('preserves settings priority and inbound capability suppression during builds', async () => {
        await m.db.exec(`UPDATE "DeliverySyncAccount" SET "inboundCapabilityStatus"='plugin_update_required' WHERE "accountId"='a';
            INSERT INTO "DeliveryInputSync" (id,"accountId",scope,"entityId",priority) VALUES ('settings','a','settings',0,0);`);
        expect((await selectDeliveryInput('a'))?.id).toBe('settings');
        await m.db.exec(`UPDATE "DeliveryInputSync" SET status='synced' WHERE id='settings'`);
        expect(await selectDeliveryInput('a')).toBeUndefined();
    });
});
