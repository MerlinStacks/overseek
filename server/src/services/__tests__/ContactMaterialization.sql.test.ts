import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from 'pg';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { materializeContact } from '../ContactMaterialization';
import { backfillContactPage } from '../backfillContacts';
import { updateCustomerTotals, withOrderTotalsTransaction } from '../sync/orderCustomerTotals';
import { esClient } from '../../utils/elastic';
import { CustomerSync } from '../sync/CustomerSync';
import { closeContactProjectionPool, drainContactProjections, queueContactProjection } from '../ContactProjection';
import { AutomationEnrollmentService } from '../AutomationEnrollmentService';

const state = vi.hoisted(() => ({ db: null as any }));
vi.mock('../../utils/prisma', () => ({ prisma: new Proxy({}, { get: (_, key) => {
    const value = state.db[key];
    return typeof value === 'function' ? value.bind(state.db) : value;
} }) }));
vi.mock('../../utils/elastic', () => ({ esClient: { bulk: vi.fn(), delete: vi.fn() } }));
vi.mock('../../utils/logger', () => ({ Logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

// Explicit test DB only. Creates and drops a randomly named isolated schema, never application tables.
const url = process.env.CONTACT_MATERIALIZATION_TEST_DATABASE_URL;
describe.skipIf(!url)('contact materialization PostgreSQL integration', () => {
    const schema = `contact_test_${randomUUID().replaceAll('-', '')}`;
    const admin = new Client({ connectionString: url });
    let db: PrismaClient;
    beforeAll(async () => {
        vi.stubEnv('DATABASE_URL', url!);
        await admin.connect();
        await admin.query(`CREATE SCHEMA "${schema}"; SET search_path TO "${schema}";
            CREATE TABLE "WooCustomer" (
                id text PRIMARY KEY, "accountId" text NOT NULL, "wooId" int NOT NULL, email text NOT NULL,
                "firstName" text, "lastName" text, "totalSpent" numeric(10,2) NOT NULL, "ordersCount" int NOT NULL,
                "rawData" jsonb NOT NULL, "createdAt" timestamp NOT NULL DEFAULT now(), "updatedAt" timestamp NOT NULL,
                UNIQUE ("accountId", "wooId")
            );
            CREATE TABLE "WooOrder" (
                id text PRIMARY KEY, "accountId" text NOT NULL, "wooId" int NOT NULL,
                "wooCustomerId" int, "billingEmail" text, total numeric(10,2), "rawData" jsonb NOT NULL DEFAULT '{}'
            );
            CREATE TABLE "AutomationEnrollment" (
                id text PRIMARY KEY, "accountId" text NOT NULL, email text NOT NULL, "wooCustomerId" int,
                "automationId" text DEFAULT 'automation', "contextData" jsonb, status text DEFAULT 'ACTIVE',
                "statusReason" text, "currentNodeId" text, "lastProcessedNodeId" text,
                "triggerEntityType" text, "triggerEntityId" text, "dedupeKey" text, "nextRunAt" timestamp,
                "enteredAt" timestamp DEFAULT now(), "completedAt" timestamp, "cancelledAt" timestamp,
                "conversionAt" timestamp, "convertedOrderId" text, "convertedRevenue" numeric(10,2),
                "lastEmailLogId" text, "createdAt" timestamp DEFAULT now(), "updatedAt" timestamp DEFAULT now()
            );
            CREATE TABLE "AutomationRunEvent" (
                id text PRIMARY KEY, "accountId" text, "automationId" text, "enrollmentId" text,
                "nodeId" text, "eventType" text, outcome text, metadata jsonb, "createdAt" timestamp DEFAULT now()
            );
            CREATE TABLE "SyncState" (
                id text PRIMARY KEY, "accountId" text NOT NULL, "entityType" text NOT NULL,
                "lastSyncedAt" timestamp, cursor text, "updatedAt" timestamp NOT NULL,
                UNIQUE ("accountId", "entityType")
            );
            CREATE TABLE "Conversation" (
                id text PRIMARY KEY, "accountId" text, "wooCustomerId" text, "guestEmail" text
            );`);
        db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url,
            options: `-c search_path=${schema}`, max: 10 }, { schema }) });
        state.db = db;
    });
    beforeEach(async () => {
        vi.resetAllMocks();
        vi.mocked(esClient.bulk).mockResolvedValue({ errors: false } as any);
        await admin.query('TRUNCATE "WooCustomer", "WooOrder", "AutomationEnrollment", "AutomationRunEvent", "SyncState"');
    });
    afterAll(async () => {
        await db?.$disconnect();
        await closeContactProjectionPool();
        vi.unstubAllEnvs();
        await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await admin.end();
    });

    it('serializes competing guest/enrollment creators and negative-ID allocation, scoped to account', async () => {
        await Promise.all(Array.from({ length: 12 }, (_, index) =>
            withOrderTotalsTransaction('a', tx => materializeContact(tx, 'a', {
                source: index % 2 ? 'ORDER' : 'AUTOMATION', email: ' Guest@Example.com '
            }))));
        expect(await db.wooCustomer.count()).toBe(1);
        await Promise.all(['another@example.com', 'third@example.com'].map(email =>
            withOrderTotalsTransaction('a', tx => materializeContact(tx, 'a', { source: 'AUTOMATION', email }))));
        const contacts = await db.wooCustomer.findMany({ where: { accountId: 'a' }, orderBy: { wooId: 'asc' } });
        expect(contacts.map(c => c.wooId)).toEqual([-3, -2, -1]);
        await withOrderTotalsTransaction('b', tx => materializeContact(tx, 'b', { source: 'ORDER', email: 'guest@example.com' }));
        expect(await db.wooCustomer.count()).toBe(4);
    });

    it('promotes the same local row once during competing Woo/order deliveries, preserving local metadata', async () => {
        const local = await withOrderTotalsTransaction('a', tx => materializeContact(tx, 'a', { source: 'AUTOMATION', email: 'guest@example.com' }));
        await db.wooCustomer.update({ where: { id: local.id }, data: { rawData: { contactStatus: 'COMPLAINT', blocked: true } } });
        await Promise.all(['ORDER', 'WOO_CUSTOMER'].map(source => withOrderTotalsTransaction('a', tx =>
            materializeContact(tx, 'a', { source: source as any, wooCustomerId: 42, email: 'guest@example.com' }))));
        expect(await db.wooCustomer.findMany()).toEqual([expect.objectContaining({
            id: local.id, wooId: 42, rawData: { contactStatus: 'COMPLAINT', blocked: true }
        })]);
        expect(esClient.delete).not.toHaveBeenCalled();
        expect(await db.syncState.count({ where: { entityType: 'contact-projection:-1' } })).toBe(1);
    });

    it('backfills bounded pages, uses normalized historic emails, preserves positive IDs and can restart', async () => {
        await admin.query(`INSERT INTO "WooOrder" (id, "accountId", "wooId", "wooCustomerId", "billingEmail", total) VALUES
            ('01', 'a', 1, 42, ' Guest@Example.com ', 12.34),
            ('02', 'a', 2, NULL, 'GUEST@example.com', 5.66),
            ('03', 'b', 3, NULL, 'other@example.com', 99);
            INSERT INTO "AutomationEnrollment" (id, "accountId", email, "wooCustomerId") VALUES ('enrollment', 'a', 'guest@example.com', NULL);`);
        const first = await backfillContactPage('a', 'orders', undefined, 1);
        expect(first).toEqual({ cursor: '01', count: 1, done: false });
        await backfillContactPage('a', 'orders', first.cursor, 1);
        await backfillContactPage('a', 'enrollments');
        await backfillContactPage('a', 'orders');
        const contacts = await db.wooCustomer.findMany();
        expect(contacts).toHaveLength(1);
        expect(contacts[0]).toMatchObject({ wooId: 42, ordersCount: 2, rawData: { contactStatus: 'UNVERIFIED' } });
        expect(Number(contacts[0].totalSpent)).toBe(18);
        expect(esClient.bulk).not.toHaveBeenCalled();
        await drainContactProjections();
        expect(esClient.bulk).toHaveBeenCalledWith(expect.objectContaining({ operations: expect.arrayContaining([
            expect.objectContaining({ id: contacts[0].id, wooId: 42, totalSpent: 18, ordersCount: 2 })
        ]) }), expect.anything());
    });

    it('commits backfill through an ES outage and recovers from durable pending keys after restart', async () => {
        await admin.query(`INSERT INTO "AutomationEnrollment" (id, "accountId", email, "wooCustomerId") VALUES ('enrollment', 'a', 'guest@example.com', NULL)`);
        vi.mocked(esClient.bulk).mockResolvedValueOnce({ errors: true } as any);
        await backfillContactPage('a', 'enrollments');
        expect(await db.wooCustomer.count()).toBe(1);
        await expect(drainContactProjections()).rejects.toThrow('durable pending keys retained');
        expect(await db.syncState.count()).toBe(1);
        await closeContactProjectionPool();
        await drainContactProjections();
        expect(await db.syncState.count()).toBe(0);
        expect(await db.wooCustomer.count()).toBe(1);
    });

    it('materializes anonymous orders separately, counts them, and repairs deletion to zero', async () => {
        await admin.query(`INSERT INTO "WooOrder" (id, "accountId", "wooId", total) VALUES ('01', 'a', 1, 12.34), ('02', 'a', 2, 5.66)`);
        await backfillContactPage('a', 'orders');
        expect((await db.wooCustomer.findMany()).map(c => c.ordersCount)).toEqual([1, 1]);
        await withOrderTotalsTransaction('a', async tx => {
            await tx.$executeRaw`DELETE FROM "WooOrder" WHERE id = '01'`;
            await updateCustomerTotals(tx, 'a', [{ wooId: 1, wooCustomerId: null, billingEmail: null }]);
        });
        const contact = await db.wooCustomer.findFirst({ where: { rawData: { path: ['materializationKey'], equals: 'order:1' } } });
        expect(contact?.ordersCount).toBe(0);
    });

    it('full customer reconciliation retains local contacts and stale Woo identities with order or enrollment history', async () => {
        for (const wooCustomerId of [50, 51, 52]) {
            await withOrderTotalsTransaction('a', tx => materializeContact(tx, 'a', {
                source: 'WOO_CUSTOMER', wooCustomerId, email: `${wooCustomerId}@example.com`
            }));
        }
        await withOrderTotalsTransaction('a', tx => materializeContact(tx, 'a', { source: 'AUTOMATION', email: 'local@example.com' }));
        await admin.query(`UPDATE "WooCustomer" SET "updatedAt" = '2020-01-01';
            INSERT INTO "AutomationEnrollment" (id, "accountId", email, "wooCustomerId") VALUES ('enrollment', 'a', 'different@example.com', 50);
            INSERT INTO "WooOrder" (id, "accountId", "wooId", "billingEmail", total) VALUES ('order', 'a', 1, '51@example.com', 10);`);
        const woo = { getCustomers: vi.fn().mockResolvedValue({ totalPages: 1,
            data: [{ id: 42, email: 'current@example.com', first_name: 'Current', last_name: 'Person' }] }) };
        const result = await (new CustomerSync() as any).sync(woo, 'a', false);
        expect(result.itemsDeleted).toBe(1);
        expect((await db.wooCustomer.findMany({ orderBy: { wooId: 'asc' } })).map(c => c.wooId)).toEqual([-1, 42, 50, 51]);
        expect(esClient.delete).not.toHaveBeenCalled();
        await drainContactProjections();
        expect(esClient.bulk).toHaveBeenCalledWith(expect.objectContaining({ operations: expect.arrayContaining([
            { delete: { _index: 'customers', _id: 'a_52' } }
        ]) }), expect.anything());
    });

    it('does not publish rolled-back contacts or delete a committed identity on rolled-back promotion', async () => {
        await expect(withOrderTotalsTransaction('a', async tx => {
            const c = await materializeContact(tx, 'a', { source: 'ORDER', email: 'phantom@example.com' });
            await queueContactProjection(tx, 'a', [c.id]);
            throw new Error('rollback');
        })).rejects.toThrow('rollback');
        expect(await drainContactProjections()).toBe(0);
        expect(esClient.bulk).not.toHaveBeenCalled();
        const contact = await withOrderTotalsTransaction('a', async tx => {
            const c = await materializeContact(tx, 'a', { source: 'AUTOMATION', email: 'real@example.com' });
            await queueContactProjection(tx, 'a', [c.id]);
            return c;
        });
        await drainContactProjections();
        vi.mocked(esClient.bulk).mockClear();
        await expect(withOrderTotalsTransaction('a', async tx => {
            await materializeContact(tx, 'a', { source: 'ORDER', wooCustomerId: 42, email: contact.email });
            await queueContactProjection(tx, 'a', [contact.id]);
            throw new Error('rollback promotion');
        })).rejects.toThrow('rollback promotion');
        expect(await drainContactProjections()).toBe(0);
        expect(esClient.bulk).not.toHaveBeenCalled();
        expect((await db.wooCustomer.findUnique({ where: { id: contact.id } }))?.wooId).toBe(-1);
    });

    it('persists a paid-trigger enrollment while ES is unavailable, then projects without replaying the trigger', async () => {
        vi.mocked(esClient.bulk).mockRejectedValueOnce(new Error('ES down'));
        const result = await new AutomationEnrollmentService().createEnrollment({
            automation: { id: 'automation', accountId: 'a' } as any,
            email: 'paid@example.com', triggerEntityType: 'ORDER', triggerEntityId: '123', dedupeKey: 'paid:123'
        });
        expect(result.created).toBe(true);
        expect(await db.automationEnrollment.count()).toBe(1);
        expect(await db.automationRunEvent.count({ where: { eventType: 'ENROLLED' } })).toBe(1);
        expect(esClient.bulk).not.toHaveBeenCalled();
        await expect(drainContactProjections()).rejects.toThrow('ES down');
        await drainContactProjections();
        expect(await db.syncState.count()).toBe(0);
        expect(await db.automationEnrollment.count()).toBe(1);
    });

    it('retains a newer generation written during projection and serializes competing projectors', async () => {
        await new AutomationEnrollmentService().createEnrollment({
            automation: { id: 'automation', accountId: 'a' } as any, email: 'guest@example.com'
        });
        vi.mocked(esClient.bulk).mockImplementationOnce(async () => {
            expect(await drainContactProjections()).toBe(0);
            await withOrderTotalsTransaction('a', async tx => {
                const c = await materializeContact(tx, 'a', { source: 'ORDER', email: 'guest@example.com', wooCustomerId: 42 });
                await queueContactProjection(tx, 'a', [c.id]);
            });
            return { errors: false } as any;
        });
        await drainContactProjections();
        expect(await db.syncState.count()).toBe(2);
        await drainContactProjections();
        expect(await db.syncState.count()).toBe(0);
        expect(esClient.bulk).toHaveBeenLastCalledWith(expect.objectContaining({ operations: expect.arrayContaining([
            { delete: { _index: 'customers', _id: 'a_-1' } },
            expect.objectContaining({ wooId: 42, email: 'guest@example.com' })
        ]) }), expect.anything());
    });

    it('replays after ES success but failed DB acknowledgement and rechecks reused negative keys', async () => {
        const service = new AutomationEnrollmentService();
        await service.createEnrollment({ automation: { id: 'automation', accountId: 'a' } as any, email: 'guest@example.com' });
        await withOrderTotalsTransaction('a', async tx => {
            const c = await materializeContact(tx, 'a', { source: 'ORDER', email: 'guest@example.com', wooCustomerId: 42 });
            await queueContactProjection(tx, 'a', [c.id]);
        });
        await service.createEnrollment({ automation: { id: 'automation', accountId: 'a' } as any, email: 'new@example.com' });
        const ack = vi.spyOn(db.syncState, 'deleteMany').mockRejectedValueOnce(new Error('connection lost before ack'));
        await expect(drainContactProjections()).rejects.toThrow('connection lost before ack');
        ack.mockRestore();
        expect(await db.syncState.count()).toBe(2);
        await drainContactProjections();
        expect(await db.syncState.count()).toBe(0);
        const operations = (vi.mocked(esClient.bulk).mock.lastCall![0] as any).operations;
        expect(operations).toContainEqual(expect.objectContaining({ wooId: -1, email: 'new@example.com' }));
        expect(operations).not.toContainEqual({ delete: { _index: 'customers', _id: 'a_-1' } });
    });

    it('reconciles beyond a deleted 500-row cursor boundary', async () => {
        await admin.query(`INSERT INTO "WooCustomer" (id, "accountId", "wooId", email, "ordersCount", "totalSpent", "rawData", "updatedAt")
            SELECT lpad(n::text, 6, '0'), 'a', n, n::text || '@example.com', 0, 0, '{}',
                CASE WHEN n <= 501 THEN '2020-01-01'::timestamp ELSE now() + interval '1 day' END
            FROM generate_series(1, 2000) n`);
        const woo = { getCustomers: vi.fn().mockResolvedValue({ totalPages: 1, data: [{ id: 2001, email: 'current@example.com' }] }) };
        const result = await (new CustomerSync() as any).sync(woo, 'a', false);
        expect(result.itemsDeleted).toBe(501);
        expect(await db.wooCustomer.count({ where: { wooId: { lte: 501 } } })).toBe(0);
        expect(await db.syncState.count()).toBe(502);
        expect(esClient.bulk).not.toHaveBeenCalled();
    }, 15000);

    it('acknowledges successful bulk items but keeps failed keys durable without blocking later keys', async () => {
        const service = new AutomationEnrollmentService();
        for (const email of ['one@example.com', 'two@example.com']) await service.createEnrollment({
            automation: { id: 'automation', accountId: 'a' } as any, email
        });
        vi.mocked(esClient.bulk).mockResolvedValueOnce({ errors: true, items: [
            { index: { status: 201 } }, { index: { status: 400, error: { type: 'mapping_error' } } }
        ] } as any);
        await expect(drainContactProjections()).rejects.toThrow('durable pending keys retained');
        expect(await db.syncState.count()).toBe(1);
        await drainContactProjections();
        expect(await db.syncState.count()).toBe(0);
    });

    it('retains projection intent when a legacy editor changes committed metadata during an ES request', async () => {
        const result = await new AutomationEnrollmentService().createEnrollment({
            automation: { id: 'automation', accountId: 'a' } as any, email: 'guest@example.com'
        });
        vi.mocked(esClient.bulk).mockImplementationOnce(async () => {
            await db.wooCustomer.updateMany({ where: { accountId: 'a', email: result.enrollment.email },
                data: { rawData: { contactStatus: 'COMPLAINT' } } });
            return { errors: false } as any;
        });
        await drainContactProjections();
        expect(await db.syncState.count()).toBe(1);
        await drainContactProjections();
        expect(await db.syncState.count()).toBe(0);
        expect(esClient.bulk).toHaveBeenLastCalledWith(expect.objectContaining({ operations: expect.arrayContaining([
            expect.objectContaining({ contactStatus: 'COMPLAINT' })
        ]) }), expect.anything());
    });
});
