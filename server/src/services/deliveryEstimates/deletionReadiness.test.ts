import { describe, expect, it, vi } from 'vitest';
import { hasFreshnessTestDatabase, openFreshnessTestDatabase } from './__tests__/freshnessDatabase';
const m = vi.hoisted(() => ({ db: null as any, settings: null as any }));
vi.mock('../../utils/prisma', () => ({ prisma: {
    account: { findUniqueOrThrow: async () => ({ receiptTransportMode: 'GUARDED' }) },
    receiptAccount: { findUnique: async () => ({ cutoverState: 'guarded', cutoverEpoch: 'epoch', receivingFrozen: false }) },
    deliverySyncAccount: { findUnique: async () => ({ capabilityStatus: 'supported', inboundCapabilityStatus: 'supported' }) },
    receiptOperation: { count: async () => 0 }, receiptLegacyWork: { count: async () => 0 },
    deliveryInputSync: {
        findUnique: async () => ({ status: 'synced', desiredRevision: 1n, ackRevision: 1n, payload: { enabled: true, settings: m.settings } }),
        count: async () => Number((await m.db.query(`SELECT COUNT(*) AS n FROM "DeliveryInputSync" WHERE "accountId"='a' AND status <> 'synced'`)).rows[0].n),
    },
    wooProduct: { count: async () => Number((await m.db.query('SELECT COUNT(*) AS n FROM "WooProduct"')).rows[0].n) },
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
        const sql = strings.reduce((text, part, i) => text + (i ? `$${i}` : '') + part, '');
        const rows = (await m.db.query(sql, values)).rows;
        // Match Prisma's bigint mapping for native pg and embedded PostgreSQL.
        return rows.map((row: any) => Object.fromEntries(Object.entries(row).map(([key, value]) =>
            ['total', 'eligible', 'stale', 'unverified', 'excluded'].includes(key) ? [key, BigInt(value as string)] : [key, value])));
    },
} }));
vi.mock('../woo', () => ({ WooService: { forAccount: async () => ({ deliveryControl: async () => ({
    schemaVersion: 1, protocolVersion: 1, blockers: [], wooVersion: '10.6.2', presentation: 'classic', environmentFingerprint: 'a'.repeat(64),
    state: { revision: 1, active: false, mode: 'guarded', epoch: 'epoch' },
}) }) } }));
vi.mock('../../utils/accountFeatures', () => ({ isAccountFeatureEnabled: async () => true }));
vi.mock('./freshnessPrerequisite', () => ({ checkFreshnessPrerequisite: async () => ({ ready: true }) }));
vi.mock('./inventoryCompatibility', () => ({ checkInventoryCompatibility: async () => ({ ready: true, blockedCount: 0, targets: [] }) }));
import { defaultSettings } from './validation';
import { deliveryReadiness } from './launch';

describe.skipIf(!hasFreshnessTestDatabase)('deleted-product ACK/readiness isolation (real readiness SQL)', () => {
    it('waits for both tombstone ACKs then permits the remaining eligible product', async () => {
        m.db = await openFreshnessTestDatabase();
        try {
            m.settings = { ...defaultSettings('UTC'), shippingMethods: [{ methodId: 'flat_rate', instanceId: 7, zoneId: 0, zoneName: 'Rest', title: 'Shipping', enabled: true, minTransitDays: 1, maxTransitDays: 2, fulfilmentType: 'delivery' }] };
            await m.db.exec(`CREATE TABLE "WooProduct" (id text, "accountId" text, "wooId" int, "productionMinDays" int, "productionMaxDays" int, "rawData" jsonb);
                CREATE TABLE "ProductVariation" ("productId" text, "wooId" int, "productionMinDays" int, "productionMaxDays" int, "deliveryActive" boolean DEFAULT true);
                CREATE TABLE "DeliveryInputSync" (id text, "accountId" text, scope text, "entityId" int, status text, payload jsonb);
                INSERT INTO "WooProduct" VALUES ('live','a',20,0,2,'{"type":"simple"}');
                INSERT INTO "DeliveryInputSync" VALUES ('deleted-product','a','product',10,'pending','{"wooId":10,"productionMinDays":null,"productionMaxDays":null,"variations":[]}'),
                    ('deleted-inbound','a','inbound',10,'pending','{"wooId":10,"targets":[],"receiptSafety":"unverified","expiresAt":"2020-01-01T00:00:00Z"}');`);
            const now = new Date();
            await m.db.query(`INSERT INTO "DeliveryInputSync" VALUES ('live','a','inbound',20,'synced',$1)`, [JSON.stringify({
                wooId: 20, generatedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 86_400_000).toISOString(), receiptSafety: 'verified', receiptProof: { epoch: 'epoch' },
                targets: [{ wooId: 20, stockOwnerWooId: 20, state: 'pending', supplierLead: null, batches: [] }],
            })]);
            expect((await deliveryReadiness('a')).blockers).toContain('inputs_pending');
            await m.db.exec(`UPDATE "DeliveryInputSync" SET status='synced' WHERE id='deleted-inbound'`);
            expect((await deliveryReadiness('a')).blockers).toContain('inputs_pending');
            await m.db.exec(`UPDATE "DeliveryInputSync" SET status='synced' WHERE id='deleted-product'`);
            expect(await deliveryReadiness('a')).toMatchObject({ ready: true, configuredCount: 1, eligibleConfiguredCount: 1, pendingInputs: 0, blockers: [], freshness: { stale: 0, unverified: 0 } });
            // Readiness consumes the builder's target classification, never ANY BOM
            // existence. Cost-only BOMs retain the normal eligible native payload.
            await m.db.exec(`CREATE TABLE "BOM" (id text,"productId" text); INSERT INTO "BOM" VALUES ('cost-only','live')`);
            expect(await deliveryReadiness('a')).toMatchObject({ ready: true, eligibleConfiguredCount: 1, excludedConfiguredCount: 0 });
            // A stock-derived source instead emits unsupported; no component dates
            // or certification can make that finished-product target eligible.
            await m.db.exec(`UPDATE "DeliveryInputSync" SET payload=jsonb_set(payload,'{targets}',
                '[{"wooId":20,"stockOwnerWooId":null,"state":"unsupported","supplierLead":null,"batches":[]}]') WHERE id='live'`);
            expect(await deliveryReadiness('a')).toMatchObject({ ready: false, eligibleConfiguredCount: 0, excludedConfiguredCount: 1,
                blockers: ['no_eligible_configured_products'], warnings: expect.arrayContaining(['configured_products_excluded_unsupported_or_BOM']) });
        } finally { await m.db.close(); m.db = null; }
    }, 30_000);
});
