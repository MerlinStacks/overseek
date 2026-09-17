import { beforeEach, describe, expect, it, vi } from 'vitest';
import { materializeContact } from '../ContactMaterialization';
import { queueContactProjection } from '../ContactProjection';
import { esClient } from '../../utils/elastic';

vi.mock('../../utils/elastic', () => ({ esClient: { bulk: vi.fn(), delete: vi.fn() } }));
const tx = { $queryRaw: vi.fn(), syncState: { upsert: vi.fn() }, wooCustomer: {
    findUnique: vi.fn(), findFirst: vi.fn(), aggregate: vi.fn(), create: vi.fn(), update: vi.fn(), findMany: vi.fn()
} };
const local = { id: 'local', accountId: 'a', wooId: -7, email: 'person@example.com', firstName: 'Original',
    rawData: { contactStatus: 'COMPLAINT', marketingSubscribed: false, blocked: true, customConsent: { at: 'yesterday' } } };

describe('contact materialization identity and consent', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        tx.wooCustomer.findUnique.mockResolvedValue(null);
        tx.wooCustomer.findFirst.mockResolvedValue(null);
        tx.wooCustomer.aggregate.mockResolvedValue({ _min: { wooId: -7 } });
        tx.wooCustomer.create.mockImplementation(async ({ data }) => ({ id: 'created', ...data }));
        tx.wooCustomer.update.mockImplementation(async ({ data }) => ({ ...local, ...data }));
        vi.mocked(esClient.bulk).mockResolvedValue({ errors: false } as any);
    });

    it('normalizes and creates a negative-ID, unverified guest without granting consent', async () => {
        const contact = await materializeContact(tx as any, 'a', { source: 'ORDER', email: ' Person@Example.COM ' });
        expect(contact).toMatchObject({ accountId: 'a', wooId: -8, email: 'person@example.com',
            ordersCount: 0, rawData: { contactStatus: 'UNVERIFIED', marketingSubscribed: false } });
        expect(tx.$queryRaw).toHaveBeenCalledWith(expect.anything(), 'order-totals:a');
        expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.wooCustomer.findFirst.mock.invocationCallOrder[0]);
    });

    it('promotes in place without relying on an email uniqueness violation, preserving all metadata', async () => {
        tx.wooCustomer.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(local);
        const contact = await materializeContact(tx as any, 'a', { source: 'WOO_CUSTOMER', wooCustomerId: 42,
            email: 'person@example.com', firstName: 'Remote', remoteData: { contactStatus: 'SUBSCRIBED', billing: { city: 'Sydney' } } });
        expect(contact).toMatchObject({ id: 'local', wooId: 42, firstName: 'Remote', rawData: {
            ...local.rawData, billing: { city: 'Sydney' }
        } });
        expect(tx.wooCustomer.create).not.toHaveBeenCalled();
        expect(esClient.delete).not.toHaveBeenCalled();
        expect(tx.syncState.upsert).toHaveBeenCalledWith(expect.objectContaining({
            create: expect.objectContaining({ accountId: 'a', entityType: 'contact-projection:-7' })
        }));
    });

    it('reuses canonical positive identity without overwriting its email from order billing', async () => {
        tx.wooCustomer.findUnique.mockResolvedValue({ ...local, wooId: 42 });
        const contact = await materializeContact(tx as any, 'a', { source: 'ORDER', wooCustomerId: 42, email: 'different@example.com' });
        expect(contact.email).toBe('person@example.com');
        expect(contact.rawData).toEqual(local.rawData);
        expect(tx.wooCustomer.findFirst).not.toHaveBeenCalled();
        expect(tx.wooCustomer.update.mock.calls[0][0].data).not.toHaveProperty('rawData');
    });

    it('rereads consent under a row lock before merging remote customer data', async () => {
        tx.wooCustomer.findUnique.mockResolvedValue({ ...local, wooId: 42, rawData: { contactStatus: 'SUBSCRIBED' } });
        tx.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([{ rawData: local.rawData }]);
        const contact = await materializeContact(tx as any, 'a', {
            source: 'WOO_CUSTOMER', wooCustomerId: 42, email: local.email, remoteData: { billing: { city: 'Sydney' } }
        });
        expect(contact.rawData).toMatchObject(local.rawData);
        expect(tx.$queryRaw.mock.calls[1][0].join('')).toContain('FOR UPDATE');
    });

    it('does not steal a different positive identity sharing the same email', async () => {
        tx.wooCustomer.findFirst.mockResolvedValue({ ...local, wooId: 11 });
        const contact = await materializeContact(tx as any, 'a', { source: 'AUTOMATION', wooCustomerId: 42, email: local.email });
        expect(contact.wooId).toBe(42);
        expect(tx.wooCustomer.update).not.toHaveBeenCalled();
        expect(tx.wooCustomer.findFirst).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
            where: { accountId: 'a', email: { equals: local.email, mode: 'insensitive' }, wooId: { gt: 0 } }
        }));
    });

    it('replays an email-only enrollment using its existing contact', async () => {
        tx.wooCustomer.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(local);
        const contact = await materializeContact(tx as any, 'a', { source: 'AUTOMATION', email: local.email });
        expect(contact.id).toBe('local');
        expect(contact.rawData).toEqual(local.rawData);
        expect(tx.wooCustomer.create).not.toHaveBeenCalled();
    });

    it('uses stable source keys rather than treating all empty emails as one person', async () => {
        await materializeContact(tx as any, 'a', { source: 'ORDER', sourceKey: 'order:123' });
        expect(tx.wooCustomer.findFirst).toHaveBeenCalledWith({ where: { accountId: 'a', wooId: { lt: 0 }, email: '',
            rawData: { path: ['materializationKey'], equals: 'order:123' } } });
        expect(tx.wooCustomer.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
            email: '', rawData: expect.objectContaining({ materializationKey: 'order:123' })
        }) }));
    });

    it('promotes without contacting ES and leaves transactional intent for the old key', async () => {
        tx.wooCustomer.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(local);
        vi.mocked(esClient.delete).mockRejectedValue(new Error('ES unavailable'));
        await expect(materializeContact(tx as any, 'a', { source: 'ORDER', wooCustomerId: 42, email: local.email }))
            .resolves.toMatchObject({ wooId: 42 });
        expect(esClient.delete).not.toHaveBeenCalled();
        expect(tx.syncState.upsert).toHaveBeenCalled();
    });

    it('records projection intent in the caller transaction without contacting ES', async () => {
        tx.wooCustomer.findMany.mockResolvedValue([{ ...local, totalSpent: '12.34', ordersCount: 2, createdAt: new Date() }]);
        vi.mocked(esClient.bulk).mockResolvedValue({ errors: true } as any);
        await queueContactProjection(tx as any, 'a', ['local']);
        expect(esClient.bulk).not.toHaveBeenCalled();
        expect(tx.syncState.upsert).toHaveBeenCalledWith(expect.objectContaining({
            create: expect.objectContaining({ accountId: 'a', entityType: 'contact-projection:-7', cursor: expect.any(String) })
        }));
    });
});
