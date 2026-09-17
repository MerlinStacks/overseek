import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CustomersService } from '../customers';

const mocks = vi.hoisted(() => ({
    find: vi.fn(), txFind: vi.fn(), update: vi.fn(), suppressions: vi.fn(),
    remove: vi.fn(), create: vi.fn(), transaction: vi.fn(), index: vi.fn()
}));
vi.mock('../../utils/prisma', () => ({ prisma: {
    wooCustomer: { findFirst: mocks.find },
    wooOrder: { findMany: vi.fn(async () => []), aggregate: vi.fn(async () => ({ _sum: { total: 0 }, _count: { id: 0 } })) },
    analyticsSession: { findMany: vi.fn(async () => []) },
    conversation: { findMany: vi.fn(async () => []) },
    emailUnsubscribe: { findMany: mocks.suppressions },
    $transaction: mocks.transaction
} }));
vi.mock('../../utils/elastic', () => ({ esClient: {} }));
vi.mock('../../utils/logger', () => ({ Logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../woo', () => ({ WooService: {} }));
vi.mock('../search/IndexingService', () => ({ IndexingService: { indexCustomer: mocks.index } }));
vi.mock('../automation/ContactAutomationHistory', () => ({ getContactAutomationHistory: vi.fn(async () => []) }));

const customer = {
    id: 'local-contact', accountId: 'account', wooId: -10, email: ' Old@Example.com ',
    firstName: 'Ada', lastName: 'Lovelace', totalSpent: 0, ordersCount: 0,
    rawData: { contactStatus: 'COMPLAINT', previousEmails: [' Historic@Example.com '], billing: { city: 'Sydney' } }
};

beforeEach(() => {
    vi.clearAllMocks();
    mocks.find.mockResolvedValue(customer);
    mocks.txFind.mockResolvedValue(customer);
    mocks.suppressions.mockResolvedValue([]);
    mocks.update.mockImplementation(async ({ data }) => ({ ...customer, ...data }));
    mocks.transaction.mockImplementation(async callback => callback({
        wooCustomer: { findFirst: mocks.txFind, update: mocks.update },
        emailUnsubscribe: { deleteMany: mocks.remove, create: mocks.create }
    }));
});

describe('customer details suppression consumers', () => {
    it.each([
        ['ALL', 'UNSUBSCRIBED', 'UNSUBSCRIBED', false],
        ['ALL', 'BOUNCED', 'BOUNCED', false],
        ['ALL', 'UNVERIFIED', 'UNVERIFIED', false],
        ['MARKETING', 'UNVERIFIED', 'UNVERIFIED', true],
        ['MARKETING', 'SOFT_BOUNCED', 'SOFT_BOUNCED', true],
        ['ALL', null, 'COMPLAINT', false]
    ])('uses scope=%s classification=%s for label %s', async (scope, contactStatus, expected, transactional) => {
        mocks.suppressions.mockResolvedValue([{ scope, contactStatus }]);
        const result = await CustomersService.getCustomerDetails('account', customer.id);
        expect(result?.customer.contactStatus).toBe(expected);
        expect(result?.sendingMethods).toEqual({ marketing: false, transactional });
        expect(mocks.suppressions).toHaveBeenCalledWith({
            where: { accountId: 'account', email: { in: ['old@example.com', 'historic@example.com'], mode: 'insensitive' } },
            select: { scope: true, contactStatus: true }
        });
    });

    it('does not label a generic ALL opt-out as complaint and chooses the strongest historical suppression', async () => {
        mocks.find.mockResolvedValue({ ...customer, rawData: { contactStatus: 'SUBSCRIBED' } });
        mocks.suppressions.mockResolvedValue([
            { scope: 'MARKETING', contactStatus: 'COMPLAINT' }, { scope: 'ALL', contactStatus: null }
        ]);
        const result = await CustomersService.getCustomerDetails('account', customer.id);
        expect(result?.customer.contactStatus).toBe('UNSUBSCRIBED');
        expect(result?.sendingMethods).toEqual({ marketing: false, transactional: false });
    });
});

describe('manual contact status writes', () => {
    it.each([
        ['UNVERIFIED', 'MARKETING', false, true], ['UNSUBSCRIBED', 'MARKETING', false, true],
        ['SOFT_BOUNCED', 'MARKETING', false, true], ['BOUNCED', 'ALL', false, false],
        ['COMPLAINT', 'ALL', false, false], ['SUBSCRIBED', null, true, true]
    ] as const)('persists %s classification and scope %s using the latest email', async (status, scope, marketing, transactional) => {
        mocks.txFind.mockResolvedValue({ ...customer, email: ' Current@Example.com ', rawData: { concurrent: 'preserved' } });
        const result = await CustomersService.updateContactStatus('account', customer.id, status);
        expect(mocks.transaction).toHaveBeenCalledTimes(1);
        expect(mocks.txFind).toHaveBeenCalledWith({ where: { accountId: 'account', id: customer.id } });
        expect(mocks.update).toHaveBeenCalledWith({
            where: { id: customer.id }, data: { rawData: { concurrent: 'preserved', contactStatus: status } }
        });
        expect(mocks.remove).toHaveBeenCalledWith({
            where: { accountId: 'account', email: { equals: 'current@example.com', mode: 'insensitive' } }
        });
        if (scope) {
            expect(mocks.create).toHaveBeenCalledWith({ data: {
                accountId: 'account', email: 'current@example.com', scope, contactStatus: status, reason: expect.any(String)
            } });
        } else {
            expect(mocks.create).not.toHaveBeenCalled();
        }
        expect(result).toEqual({ contactStatus: status, sendingMethods: { marketing, transactional } });
        expect(mocks.index).toHaveBeenCalledWith('account', customer);
    });

    it('does not write when the account-scoped customer is missing', async () => {
        mocks.find.mockResolvedValue(null);
        expect(await CustomersService.updateContactStatus('other', customer.id, 'UNVERIFIED')).toBeNull();
        expect(mocks.find).toHaveBeenCalledWith({ where: { accountId: 'other', id: customer.id } });
        expect(mocks.transaction).not.toHaveBeenCalled();
    });
});

describe('email change suppression transfer', () => {
    it.each([
        ['ALL', 'UNSUBSCRIBED', 'COMPLAINT', 'UNSUBSCRIBED'],
        ['MARKETING', 'UNVERIFIED', 'COMPLAINT', 'UNVERIFIED'],
        ['ALL', null, 'BOUNCED', 'BOUNCED'],
        ['MARKETING', null, 'SOFT_BOUNCED', 'SOFT_BOUNCED'],
        ['ALL', null, 'COMPLAINT', 'COMPLAINT'],
        ['ALL', null, 'SUBSCRIBED', 'UNSUBSCRIBED']
    ])('copies %s/%s with latest raw %s as %s', async (scope, contactStatus, latestStatus, expected) => {
        mocks.txFind.mockResolvedValue({ ...customer, rawData: { ...customer.rawData, contactStatus: latestStatus } });
        mocks.suppressions.mockResolvedValue([{ scope, contactStatus, reason: 'Original reason' }]);
        await CustomersService.updateCustomerProfile('account', customer.id, {
            firstName: 'Ada', lastName: 'Lovelace', email: ' New@Example.com '
        });
        expect(mocks.suppressions).toHaveBeenCalledWith({
            where: { accountId: 'account', email: { equals: 'old@example.com', mode: 'insensitive' } },
            select: { scope: true, reason: true, contactStatus: true }
        });
        expect(mocks.remove).toHaveBeenCalledExactlyOnceWith({
            where: { accountId: 'account', email: { equals: 'new@example.com', mode: 'insensitive' } }
        });
        expect(mocks.create).toHaveBeenCalledWith({ data: {
            accountId: 'account', email: 'new@example.com', scope, reason: 'Original reason', contactStatus: expected
        } });
        expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
            email: 'new@example.com', rawData: expect.objectContaining({
                contactStatus: latestStatus, previousEmails: ['historic@example.com', 'old@example.com']
            })
        }) }));
    });

    it('does not transfer suppression for a case-only email edit', async () => {
        await CustomersService.updateCustomerProfile('account', customer.id, {
            firstName: 'Ada', lastName: 'Lovelace', email: 'OLD@example.com'
        });
        expect(mocks.suppressions).not.toHaveBeenCalled();
        expect(mocks.remove).not.toHaveBeenCalled();
        expect(mocks.create).not.toHaveBeenCalled();
    });
});
