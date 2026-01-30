import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CustomersService } from '../customers';

// Mock the dependencies
const mockFindFirst = vi.fn();
const mockFindMany = vi.fn();
const mockUpdate = vi.fn();

vi.mock('../../utils/prisma', () => ({
    prisma: {
        wooCustomer: {
            findFirst: (...args: any[]) => mockFindFirst(...args),
            findMany: (...args: any[]) => mockFindMany(...args),
            update: (...args: any[]) => mockUpdate(...args),
        },
        wooOrder: {
            findMany: vi.fn().mockResolvedValue([]),
        },
        automationEnrollment: {
            findMany: vi.fn().mockResolvedValue([]),
        },
        analyticsSession: {
            findMany: vi.fn().mockResolvedValue([]),
        }
    }
}));

const mockSearch = vi.fn();
vi.mock('../../utils/elastic', () => ({
    esClient: {
        search: (...args: any[]) => mockSearch(...args)
    }
}));

vi.mock('../../utils/logger', () => ({
    Logger: {
        debug: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        info: vi.fn()
    }
}));

describe('CustomersService', () => {
    const accountId = 'account-123';
    const otherAccountId = 'account-999';
    const customerId = 'customer-abc';

    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('getCustomerDetails', () => {
        it('should return customer if found in the correct account', async () => {
            const mockCustomer = {
                id: customerId,
                accountId: accountId,
                email: 'test@example.com',
                wooId: 123
            };

            mockFindFirst.mockResolvedValueOnce(mockCustomer);

            const result = await CustomersService.getCustomerDetails(accountId, customerId);

            expect(result).not.toBeNull();
            expect(result?.customer).toEqual(mockCustomer);
            expect(mockFindFirst).toHaveBeenCalledTimes(1);
        });

        it('should NOT allow cross-account lookup (VULNERABILITY FIXED)', async () => {
            // First call returns null (not found in account)
            mockFindFirst.mockResolvedValueOnce(null);

            // Mock ES fallback to also return nothing (to ensure we reach end of function)
            mockSearch.mockResolvedValueOnce({
                 hits: { hits: [], total: { value: 0 } }
            });

            const result = await CustomersService.getCustomerDetails(accountId, customerId);

            // Expect null because it wasn't found in the account, and we disallowed global lookup.
            expect(result).toBeNull();

            // We expect mockFindFirst to be called ONLY ONCE (the scoped lookup).
            // The second global lookup (which was the vulnerability) should not happen.
            expect(mockFindFirst).toHaveBeenCalledTimes(1);
        });
    });
});
