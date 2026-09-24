import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { hasFreshnessTestDatabase, openFreshnessTestDatabase } from './__tests__/freshnessDatabase';
const m = vi.hoisted(() => ({ db: null as any, settings: null as any }));
vi.mock('../../utils/prisma', () => ({ prisma: {
    account: { findUniqueOrThrow: async () => ({ receiptTransportMode: 'GUARDED' }) },
    receiptAccount: { findUnique: async () => ({ cutoverState: 'guarded', cutoverEpoch: 'epoch', receivingFrozen: false }) },
    deliverySyncAccount: { findUnique: async () => ({ capabilityStatus: 'supported', inboundCapabilityStatus: 'supported' }) },
    receiptOperation: { count: async () => 0 }, receiptLegacyWork: { count: async () => 0 },
    deliveryInputSync: { findUnique: async () => ({ status: 'synced', ackRevision: 1n, desiredRevision: 1n, payload: { enabled: true, settings: m.settings } }), count: async () => 0 },
    wooProduct: { count: async () => Number((await m.db.query(`SELECT COUNT(*) AS n FROM "WooProduct" WHERE "accountId"='a'`)).rows[0].n) },
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
        const sql = strings.reduce((s, part, i) => s + (i ? `$${i}` : '') + part, '');
        return (await m.db.query(sql, values)).rows.map((row: any) => Object.fromEntries(Object.entries(row).map(([key, value]) =>
            ['total', 'eligible', 'stale', 'unverified', 'excluded'].includes(key) ? [key, BigInt(value as string)] : [key, value])));
    },
} }));
vi.mock('../woo', () => ({ WooService: { forAccount: async () => ({ deliveryControl: async () => ({ schemaVersion: 1, protocolVersion: 1, productionEstimates: true, blockers: [], wooVersion: '10.6.2', presentation: 'classic', environmentFingerprint: 'a'.repeat(64), state: { revision: 1, active: false, mode: 'guarded', epoch: 'epoch' } }) }) } }));
vi.mock('../../utils/accountFeatures', () => ({ isAccountFeatureEnabled: async () => true }));
vi.mock('./freshnessPrerequisite', () => ({ checkFreshnessPrerequisite: async () => ({ ready: true }) }));
vi.mock('./inventoryCompatibility', () => ({ checkInventoryCompatibility: async () => ({ ready: true, blockedCount: 0, targets: [] }) }));
import { defaultSettings } from './validation';
import { deliveryReadiness } from './launch';

describe.skipIf(!hasFreshnessTestDatabase)('launch eligibility classification (isolated PostgreSQL SQL)', () => {
    beforeEach(async () => {
        m.db = await openFreshnessTestDatabase();
        m.settings = { ...defaultSettings('UTC'), shippingMethods: [{ methodId: 'flat_rate', instanceId: 7, zoneId: 0, zoneName: 'Rest', title: 'Shipping', enabled: true, minTransitDays: 1, maxTransitDays: 2, fulfilmentType: 'delivery' }] };
        await m.db.exec(`CREATE TABLE "WooProduct" (id text, "accountId" text, "wooId" int, "productionMinDays" int, "productionMaxDays" int, "rawData" jsonb);
            CREATE TABLE "ProductVariation" ("productId" text, "wooId" int, "productionMinDays" int, "productionMaxDays" int);
            CREATE TABLE "DeliveryInputSync" (id text, "accountId" text, scope text, "entityId" int, payload jsonb);`);
    });
    afterEach(async () => { await m.db?.close(); m.db = null; });
    it('allows healthy synced production products while isolating stale, missing and other-account records', async () => {
        m.settings.estimateMode = 'production';
        await m.db.exec(`ALTER TABLE "DeliveryInputSync" ADD COLUMN status text, ADD COLUMN "ackRevision" bigint, ADD COLUMN "desiredRevision" bigint;
            INSERT INTO "WooProduct" VALUES
              ('healthy','a',10,0,2,'{"type":"simple"}'), ('broken','a',20,0,2,'{"type":"simple"}'),
              ('missing','a',30,0,2,'{"type":"simple"}'), ('foreign','b',40,0,2,'{"type":"simple"}'),
              ('custom','a',50,0,2,'{"type":"custom"}'), ('trash','a',60,0,2,'{"type":"simple","status":"trash"}');
            INSERT INTO "DeliveryInputSync" (id,"accountId",scope,"entityId",status,"ackRevision","desiredRevision") VALUES
              ('healthy','a','product',10,'synced',1,1), ('broken','a','product',20,'blocked',0,1),
              ('foreign','b','product',40,'synced',1,1), ('custom','a','product',50,'synced',1,1), ('trash','a','product',60,'synced',1,1);`);
        expect(await deliveryReadiness('a')).toMatchObject({ ready: true, estimateMode: 'production', eligibleConfiguredCount: 1,
            warnings: expect.arrayContaining(['production_products_not_synced']) });
        await m.db.exec(`UPDATE "DeliveryInputSync" SET "desiredRevision"=2 WHERE id='healthy'`);
        expect((await deliveryReadiness('a')).blockers).toContain('no_eligible_configured_products');
    });
    async function product(id: number, targets: { wooId: number; state: string }[], safety = 'verified', expired = false, type = 'simple') {
        await m.db.query(`INSERT INTO "WooProduct" VALUES ($1,'a',$2,0,2,$3)`, [String(id), id, JSON.stringify({ type })]);
        await m.db.query(`INSERT INTO "DeliveryInputSync" VALUES ($1,'a','inbound',$2,$3)`, [String(id), id, JSON.stringify({
            generatedAt: new Date(Date.now() - 1000).toISOString(), expiresAt: new Date(Date.now() + (expired ? -100 : 86_400_000)).toISOString(),
            receiptSafety: safety, receiptProof: safety === 'verified' ? { version: 1, epoch: 'epoch' } : undefined, targets,
        })]);
    }
    it('permits a verified product alongside explicit stale/unverified BOM exclusion and reports its ID', async () => {
        await product(10, [{ wooId: 10, state: 'pending' }]);
        await product(20, [{ wooId: 20, state: 'unsupported' }], 'unverified', true);
        expect(await deliveryReadiness('a')).toMatchObject({ ready: true, eligibleConfiguredCount: 1, excludedConfiguredCount: 1, excludedProductWooIds: [20], freshness: { stale: 0, unverified: 0 } });
    });
    it('requires a real eligible product; all exclusions are not ready', async () => {
        await product(20, [{ wooId: 20, state: 'unsupported' }], 'unverified');
        const result = await deliveryReadiness('a');
        expect(result.blockers).toContain('no_eligible_configured_products');
        expect(result.blockers).not.toContain('inbound_unverified');
    });
    it('retains proof/integrity blockers for supported or corrupt inputs', async () => {
        await product(10, [{ wooId: 10, state: 'pending' }], 'unverified');
        await product(20, [{ wooId: 20, state: 'unsupported' }], 'unverified');
        expect((await deliveryReadiness('a')).blockers).toContain('inbound_unverified');
        await m.db.exec(`UPDATE "DeliveryInputSync" SET payload=jsonb_set(payload,'{targets}','[{"wooId":10,"state":"integrity_error"}]') WHERE "entityId"=10`);
        expect((await deliveryReadiness('a')).blockers).toContain('inbound_unverified');
    });
    it('ignores a variable parent container but reports configured excluded sibling targets', async () => {
        await product(10, [{ wooId: 10, state: 'unsupported' }, { wooId: 11, state: 'pending' }, { wooId: 12, state: 'unsupported' }], 'verified', false, 'variable');
        await m.db.exec(`UPDATE "WooProduct" SET "productionMinDays"=NULL,"productionMaxDays"=NULL;
            INSERT INTO "ProductVariation" VALUES ('10',11,0,2),('10',12,NULL,NULL);`);
        expect(await deliveryReadiness('a')).toMatchObject({ ready: true, eligibleConfiguredCount: 1, excludedProductWooIds: [] });
        await m.db.exec(`UPDATE "ProductVariation" SET "productionMinDays"=0,"productionMaxDays"=2 WHERE "wooId"=12`);
        expect(await deliveryReadiness('a')).toMatchObject({ ready: true, eligibleConfiguredCount: 1, excludedProductWooIds: [10] });
    });
});
