import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CustomersService } from '../customers';

// Mock the dependencies
const mockFindFirst = vi.fn();
const mockFindMany = vi.fn();
const mockUpdate = vi.fn();
const mockEmailUnsubscribeFindFirst = vi.fn();
const mockEmailUnsubscribeFindMany = vi.fn();
const mockEmailUnsubscribeCount = vi.fn();

vi.mock('../../utils/prisma', () => ({
    prisma: {
        wooCustomer: {
            findFirst: (...args: any[]) => mockFindFirst(...args),
            findMany: (...args: any[]) => mockFindMany(...args),
            update: (...args: any[]) => mockUpdate(...args),
        },
        wooOrder: {
            findMany: vi.fn().mockResolvedValue([]),
            aggregate: vi.fn().mockResolvedValue({
                _count: { id: 0 },
                _sum: { total: 0 }
            }),
        },
        automationEnrollment: {
            findMany: vi.fn().mockResolvedValue([]),
        },
        analyticsSession: {
            findMany: vi.fn().mockResolvedValue([]),
        },
        emailUnsubscribe: {
            findFirst: (...args: any[]) => mockEmailUnsubscribeFindFirst(...args),
            findMany: (...args: any[]) => mockEmailUnsubscribeFindMany(...args),
            count: (...args: any[]) => mockEmailUnsubscribeCount(...args),
        },
        conversation: {
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
    const customerId = 'customer-abc';

    beforeEach(() => {
        vi.clearAllMocks();
        mockEmailUnsubscribeFindFirst.mockResolvedValue(null);
        mockEmailUnsubscribeFindMany.mockResolvedValue([]);
        mockEmailUnsubscribeCount.mockResolvedValue(0);
    });

    describe('getCustomerDetails', () => {
        it('should return customer if found in the correct account', async () => {
            const mockCustomer = {
                id: customerId,
                accountId: accountId,
                email: 'test@example.com',
                wooId: 123,
                totalSpent: 0,
                ordersCount: 0
            };

            mockFindFirst.mockResolvedValueOnce(mockCustomer);

            const result = await CustomersService.getCustomerDetails(accountId, customerId);

            expect(result).not.toBeNull();
            // Service enriches customer with computed stats from orders (fallback when DB value is 0)
            expect(result?.customer).toEqual({
                ...mockCustomer,
                contactStatus: 'SUBSCRIBED',
                totalSpent: 0,
                ordersCount: 0
            });
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

    describe('searchCustomers', () => {
        it('applies suppression status overlays and unsubscribed counts', async () => {
            const pagedResponse = {
                hits: {
                    hits: [
                        {
                            _id: 'account-123_customer-1',
                            _source: {
                                id: 'customer-1',
                                email: 'alice@example.com',
                                firstName: 'Alice',
                                lastName: 'A',
                                ordersCount: 1,
                                totalSpent: 10,
                                rawData: {}
                            }
                        },
                        {
                            _id: 'account-123_customer-2',
                            _source: {
                                id: 'customer-2',
                                email: 'bob@example.com',
                                firstName: 'Bob',
                                lastName: 'B',
                                ordersCount: 1,
                                totalSpent: 20,
                                rawData: { contactStatus: 'SUBSCRIBED' }
                            }
                        }
                    ],
                    total: { value: 2 }
                },
                aggregations: {
                    contact_statuses: {
                        buckets: [{ key: 'SUBSCRIBED', doc_count: 2 }]
                    }
                }
            };

            mockSearch
                .mockResolvedValueOnce(pagedResponse)
                .mockResolvedValueOnce({
                    hits: { total: { value: 2 } },
                    aggregations: {
                        contact_statuses: {
                            buckets: [{ key: 'SUBSCRIBED', doc_count: 2 }]
                        }
                    }
                })
                .mockResolvedValueOnce({
                    hits: { total: { value: 1 }, hits: [] }
                });

            mockEmailUnsubscribeFindMany.mockImplementation(async (args: any) => {
                if (args?.where?.scope) {
                    return [{ email: 'alice@example.com' }];
                }

                if (args?.where?.email?.in) {
                    return [{ email: 'alice@example.com', scope: 'MARKETING' }];
                }

                return [];
            });

            const result = await CustomersService.searchCustomers(accountId, '', 1, 20, 'ALL', []);

            expect(result.customers).toHaveLength(2);
            expect(result.customers[0].contactStatus).toBe('UNSUBSCRIBED');
            expect(result.statusCounts.UNSUBSCRIBED).toBe(1);
            expect(result.statusCounts.SUBSCRIBED).toBe(1);
        });

        it('filters UNSUBSCRIBED status by suppression list emails', async () => {
            mockEmailUnsubscribeFindMany.mockImplementation(async (args: any) => {
                if (args?.where?.scope) {
                    return [{ email: 'alice@example.com' }];
                }

                if (args?.where?.email?.in) {
                    return [{ email: 'alice@example.com', scope: 'MARKETING' }];
                }

                return [];
            });

            mockSearch
                .mockResolvedValueOnce({
                    hits: {
                        hits: [
                            {
                                _id: 'account-123_customer-1',
                                _source: {
                                    id: 'customer-1',
                                    email: 'alice@example.com',
                                    firstName: 'Alice',
                                    lastName: 'A',
                                    ordersCount: 1,
                                    totalSpent: 10,
                                    rawData: {}
                                }
                            }
                        ],
                        total: { value: 1 }
                    },
                    aggregations: {
                        contact_statuses: {
                            buckets: []
                        }
                    }
                })
                .mockResolvedValueOnce({
                    hits: { total: { value: 1 } },
                    aggregations: {
                        contact_statuses: {
                            buckets: []
                        }
                    }
                })
                .mockResolvedValueOnce({
                    hits: { total: { value: 1 }, hits: [] }
                });

            const result = await CustomersService.searchCustomers(accountId, '', 1, 20, 'UNSUBSCRIBED', []);
            const searchPayload = mockSearch.mock.calls[0][0];
            const mustClauses = searchPayload.query.bool.must as Array<any>;

            expect(mustClauses.some((clause) => clause.terms?.['email.keyword']?.includes('alice@example.com'))).toBe(true);
            expect(result.customers).toHaveLength(1);
            expect(result.customers[0].contactStatus).toBe('UNSUBSCRIBED');
        });
    });
});
