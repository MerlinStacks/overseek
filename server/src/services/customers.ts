import { esClient } from '../utils/elastic';
import { prisma } from '../utils/prisma';
import { Logger } from '../utils/logger';
import { Prisma } from '@prisma/client';

type ContactStatus = 'UNVERIFIED' | 'SUBSCRIBED' | 'BOUNCED' | 'UNSUBSCRIBED' | 'SOFT_BOUNCED' | 'COMPLAINT';
type ContactListStatus = ContactStatus | 'BLOCKED';

type FilterOperator = 'is' | 'is not' | 'contains' | 'greater than' | 'less than';

interface AdvancedFilterCondition {
    field: string;
    operator: FilterOperator | string;
    value: string;
}

interface AdvancedFilterGroup {
    combinator: 'AND' | 'OR';
    conditions: AdvancedFilterCondition[];
}

const CONTACT_STATUS_METHODS: Record<ContactStatus, { marketing: boolean; transactional: boolean }> = {
    UNVERIFIED: { marketing: false, transactional: true },
    SUBSCRIBED: { marketing: true, transactional: true },
    BOUNCED: { marketing: false, transactional: false },
    UNSUBSCRIBED: { marketing: false, transactional: true },
    SOFT_BOUNCED: { marketing: false, transactional: true },
    COMPLAINT: { marketing: false, transactional: false }
};

function normalizeContactStatus(rawStatus: unknown): ContactStatus {
    const value = String(rawStatus || '').trim().toUpperCase();
    if (value === 'UNVERIFIED' || value === 'SUBSCRIBED' || value === 'BOUNCED' || value === 'UNSUBSCRIBED' || value === 'SOFT_BOUNCED' || value === 'COMPLAINT') {
        return value;
    }
    return 'SUBSCRIBED';
}

export class CustomersService {
    private static getSuppressedRawCounts(rows: Array<{ rawData: Prisma.JsonValue }>): Record<ContactStatus, number> {
        return rows.reduce((acc, row) => {
            const rawData = row.rawData && typeof row.rawData === 'object' && !Array.isArray(row.rawData)
                ? row.rawData as Record<string, unknown>
                : {};
            const status = normalizeContactStatus(rawData.contactStatus);
            acc[status] += 1;
            return acc;
        }, {
            UNVERIFIED: 0,
            SUBSCRIBED: 0,
            BOUNCED: 0,
            UNSUBSCRIBED: 0,
            SOFT_BOUNCED: 0,
            COMPLAINT: 0
        } as Record<ContactStatus, number>);
    }

    private static buildConditionClause(condition: AdvancedFilterCondition): any | null {
        const field = String(condition.field || '').trim();
        const operator = String(condition.operator || '').trim().toLowerCase() as FilterOperator;
        const value = String(condition.value || '').trim();

        if (!field || field === 'Select' || !value) return null;

        if (field === 'Name') {
            if (operator === 'contains') {
                return {
                    multi_match: {
                        query: value,
                        fields: ['firstName', 'lastName'],
                        fuzziness: 'AUTO'
                    }
                };
            }
            if (operator === 'is not') {
                return {
                    bool: {
                        must_not: [{
                            multi_match: {
                                query: value,
                                fields: ['firstName', 'lastName'],
                                operator: 'and'
                            }
                        }]
                    }
                };
            }
            return {
                multi_match: {
                    query: value,
                    fields: ['firstName', 'lastName'],
                    operator: 'and'
                }
            };
        }

        if (field === 'Email') {
            if (operator === 'contains') {
                return { wildcard: { 'email.keyword': `*${value.toLowerCase()}*` } };
            }
            if (operator === 'is not') {
                return { bool: { must_not: [{ term: { 'email.keyword': value.toLowerCase() } }] } };
            }
            return { term: { 'email.keyword': value.toLowerCase() } };
        }

        if (field === 'Contact Status') {
            const status = value.toUpperCase();
            if (operator === 'is not') {
                return {
                    bool: {
                        must_not: [
                            {
                                bool: {
                                    should: [
                                        { term: { 'rawData.contactStatus.keyword': status } },
                                        { term: { 'rawData.contactStatus': status } }
                                    ],
                                    minimum_should_match: 1
                                }
                            }
                        ]
                    }
                };
            }
            return {
                bool: {
                    should: [
                        { term: { 'rawData.contactStatus.keyword': status } },
                        { term: { 'rawData.contactStatus': status } }
                    ],
                    minimum_should_match: 1
                }
            };
        }

        if (field === 'Total Spent' || field === 'Orders') {
            const numeric = Number(value);
            if (Number.isNaN(numeric)) return null;
            const numericField = field === 'Total Spent' ? 'totalSpent' : 'ordersCount';
            if (operator === 'greater than') return { range: { [numericField]: { gt: numeric } } };
            if (operator === 'less than') return { range: { [numericField]: { lt: numeric } } };
            if (operator === 'is not') return { bool: { must_not: [{ term: { [numericField]: numeric } }] } };
            return { term: { [numericField]: numeric } };
        }

        return null;
    }

    private static buildGroupClause(group: AdvancedFilterGroup): any | null {
        const clauses = (group.conditions || [])
            .map((condition) => this.buildConditionClause(condition))
            .filter(Boolean);
        if (clauses.length === 0) return null;
        return { bool: { must: clauses } };
    }

    private static buildAdvancedFilterClause(groups: AdvancedFilterGroup[]): any | null {
        const normalizedGroups = (groups || [])
            .map((group) => ({ combinator: group.combinator === 'OR' ? 'OR' : 'AND', conditions: group.conditions || [] }))
            .map((group) => ({ combinator: group.combinator, clause: this.buildGroupClause(group as AdvancedFilterGroup) }))
            .filter((item) => !!item.clause) as Array<{ combinator: 'AND' | 'OR'; clause: any }>;

        if (normalizedGroups.length === 0) return null;

        let expression = normalizedGroups[0].clause;
        for (let index = 1; index < normalizedGroups.length; index += 1) {
            const current = normalizedGroups[index];
            if (current.combinator === 'OR') {
                expression = {
                    bool: {
                        should: [expression, current.clause],
                        minimum_should_match: 1
                    }
                };
            } else {
                expression = {
                    bool: {
                        must: [expression, current.clause]
                    }
                };
            }
        }

        return expression;
    }

    static async searchContacts(
        accountId: string,
        query: string = '',
        page: number = 1,
        limit: number = 20,
        status: ContactListStatus | 'ALL' = 'ALL'
    ) {
        const offset = (page - 1) * limit;
        const searchClause = query
            ? Prisma.sql`AND (
                COALESCE("firstName", '') ILIKE ${`%${query}%`}
                OR COALESCE("lastName", '') ILIKE ${`%${query}%`}
                OR "email" ILIKE ${`%${query}%`}
                OR COALESCE("blockedReason", '') ILIKE ${`%${query}%`}
            )`
            : Prisma.empty;
        const statusClause = status === 'ALL'
            ? Prisma.empty
            : Prisma.sql`AND "contactStatus" = ${status}`;
        const contactsCte = Prisma.sql`
            WITH customer_base AS (
                SELECT
                    wc."id",
                    wc."wooId",
                    wc."email",
                    wc."firstName",
                    wc."lastName",
                    wc."totalSpent",
                    wc."ordersCount",
                    wc."createdAt" AS "dateCreated",
                    wc."updatedAt",
                    bc."id" AS "blockedId",
                    bc."reason" AS "blockedReason",
                    bc."blockedAt",
                    blocker."fullName" AS "blockedByName",
                    CASE
                        WHEN bc."id" IS NOT NULL THEN 'BLOCKED'
                        WHEN suppression."scope" = 'ALL' THEN 'COMPLAINT'
                        WHEN suppression."scope" = 'MARKETING' THEN 'UNSUBSCRIBED'
                        WHEN UPPER(COALESCE(wc."rawData"->>'contactStatus', '')) IN
                            ('UNVERIFIED', 'SUBSCRIBED', 'BOUNCED', 'UNSUBSCRIBED', 'SOFT_BOUNCED', 'COMPLAINT')
                            THEN UPPER(wc."rawData"->>'contactStatus')
                        ELSE 'SUBSCRIBED'
                    END AS "contactStatus",
                    ROW_NUMBER() OVER (
                        PARTITION BY COALESCE(NULLIF(LOWER(TRIM(wc."email")), ''), wc."id")
                        ORDER BY wc."ordersCount" DESC, wc."updatedAt" DESC
                    ) AS row_number
                FROM "WooCustomer" wc
                LEFT JOIN LATERAL (
                    SELECT blocked.*
                    FROM "BlockedContact" blocked
                    WHERE blocked."accountId" = wc."accountId"
                      AND LOWER(TRIM(blocked."email")) = LOWER(TRIM(wc."email"))
                    ORDER BY blocked."blockedAt" DESC
                    LIMIT 1
                ) bc ON TRUE
                LEFT JOIN "User" blocker ON blocker."id" = bc."blockedBy"
                LEFT JOIN LATERAL (
                    SELECT unsubscribed."scope"
                    FROM "EmailUnsubscribe" unsubscribed
                    WHERE unsubscribed."accountId" = wc."accountId"
                      AND LOWER(TRIM(unsubscribed."email")) = LOWER(TRIM(wc."email"))
                    ORDER BY unsubscribed."createdAt" DESC
                    LIMIT 1
                ) suppression ON TRUE
                WHERE wc."accountId" = ${accountId}
            ),
            contacts AS (
                SELECT
                    "id",
                    "wooId",
                    "email",
                    "firstName",
                    "lastName",
                    "totalSpent",
                    "ordersCount",
                    "dateCreated",
                    "contactStatus",
                    "blockedReason",
                    "blockedAt",
                    "blockedByName",
                    TRUE AS "isCustomer"
                FROM customer_base
                WHERE row_number = 1

                UNION ALL

                SELECT
                    blocked."id",
                    NULL::integer AS "wooId",
                    blocked."email",
                    NULL::text AS "firstName",
                    NULL::text AS "lastName",
                    0::numeric AS "totalSpent",
                    0::integer AS "ordersCount",
                    blocked."blockedAt" AS "dateCreated",
                    'BLOCKED'::text AS "contactStatus",
                    blocked."reason" AS "blockedReason",
                    blocked."blockedAt",
                    blocker."fullName" AS "blockedByName",
                    FALSE AS "isCustomer"
                FROM "BlockedContact" blocked
                LEFT JOIN "User" blocker ON blocker."id" = blocked."blockedBy"
                WHERE blocked."accountId" = ${accountId}
                  AND NOT EXISTS (
                      SELECT 1
                      FROM "WooCustomer" customer
                      WHERE customer."accountId" = blocked."accountId"
                        AND LOWER(TRIM(customer."email")) = LOWER(TRIM(blocked."email"))
                  )
            )
        `;

        type ContactRow = {
            id: string;
            wooId: number | null;
            email: string;
            firstName: string | null;
            lastName: string | null;
            totalSpent: Prisma.Decimal;
            ordersCount: number;
            dateCreated: Date;
            contactStatus: ContactListStatus;
            blockedReason: string | null;
            blockedAt: Date | null;
            blockedByName: string | null;
            isCustomer: boolean;
        };

        const [rows, countRows] = await Promise.all([
            prisma.$queryRaw<ContactRow[]>`${contactsCte}
                SELECT *
                FROM contacts
                WHERE TRUE ${searchClause} ${statusClause}
                ORDER BY COALESCE(NULLIF("firstName", ''), "email") ASC, "lastName" ASC NULLS LAST
                LIMIT ${limit}
                OFFSET ${offset}
            `,
            prisma.$queryRaw<Array<{ contactStatus: ContactListStatus; count: bigint }>>`${contactsCte}
                SELECT "contactStatus", COUNT(*) AS count
                FROM contacts
                WHERE TRUE ${searchClause}
                GROUP BY "contactStatus"
            `
        ]);

        const statusCounts: Record<ContactListStatus | 'ALL', number> = {
            ALL: 0,
            UNVERIFIED: 0,
            SUBSCRIBED: 0,
            BOUNCED: 0,
            UNSUBSCRIBED: 0,
            SOFT_BOUNCED: 0,
            COMPLAINT: 0,
            BLOCKED: 0
        };
        for (const countRow of countRows) {
            const count = Number(countRow.count);
            statusCounts[countRow.contactStatus] = count;
            statusCounts.ALL += count;
        }

        const total = status === 'ALL' ? statusCounts.ALL : statusCounts[status];
        return {
            contacts: rows.map((row) => ({
                ...row,
                totalSpent: Number(row.totalSpent)
            })),
            total,
            page,
            totalPages: Math.ceil(total / limit),
            statusCounts
        };
    }

    static async searchCustomers(
        accountId: string,
        query: string = '',
        page: number = 1,
        limit: number = 20,
        status: 'UNVERIFIED' | 'SUBSCRIBED' | 'BOUNCED' | 'UNSUBSCRIBED' | 'SOFT_BOUNCED' | 'COMPLAINT' | 'ALL' = 'ALL',
        advancedFilters: AdvancedFilterGroup[] = []
    ) {
        const from = (page - 1) * limit;
        const suppressionSearchClause = query
            ? Prisma.sql`AND (
                "firstName" ILIKE ${`%${query}%`}
                OR "lastName" ILIKE ${`%${query}%`}
                OR "email" ILIKE ${`%${query}%`}
            )`
            : Prisma.empty;
        const unsubscribedEmails = await prisma.emailUnsubscribe.findMany({
                where: {
                    accountId,
                    scope: { in: ['MARKETING', 'ALL'] }
                },
                select: { email: true, scope: true },
                distinct: ['email']
            });

        const marketingSuppressedEmailList = unsubscribedEmails
            .filter((row) => row.scope === 'MARKETING')
            .map((row) => row.email.toLowerCase());
        const allSuppressedEmailList = unsubscribedEmails
            .filter((row) => row.scope === 'ALL')
            .map((row) => row.email.toLowerCase());
        const suppressedEmailList = [...marketingSuppressedEmailList, ...allSuppressedEmailList];
        const suppressionByEmail = new Map(
            unsubscribedEmails.map((row) => [row.email.toLowerCase(), row.scope])
        );
        const suppressedCustomerRows = suppressedEmailList.length > 0
            ? await prisma.$queryRaw<Array<{ wooId: number | null; email: string; rawData: Prisma.JsonValue }>>`
                SELECT DISTINCT "wooId", "email", "rawData"
                FROM "WooCustomer"
                WHERE "accountId" = ${accountId}
                  AND "ordersCount" > 0
                  AND "wooId" IS NOT NULL
                  AND lower("email") = ANY(${suppressedEmailList}::text[])
                  ${suppressionSearchClause}
            `
            : [];
        const marketingSuppressedCustomerRows = suppressedCustomerRows.filter((row) => marketingSuppressedEmailList.includes(String(row.email || '').toLowerCase()));
        const allSuppressedCustomerRows = suppressedCustomerRows.filter((row) => allSuppressedEmailList.includes(String(row.email || '').toLowerCase()));
        const suppressedEmailClause = suppressedEmailList.length > 0
            ? {
                bool: {
                    must_not: [
                        { terms: { 'email.keyword': suppressedEmailList } },
                        { terms: { email: suppressedEmailList } }
                    ]
                }
            }
            : null;

        const baseMust: any[] = [
            { term: { accountId } },
            { range: { ordersCount: { gt: 0 } } }
        ];

        if (query) {
            baseMust.push({
                multi_match: {
                    query,
                    fields: ['firstName', 'lastName', 'email'],
                    fuzziness: 'AUTO'
                }
            });
        }

        const statusMust = [...baseMust];

        if (status === 'UNSUBSCRIBED') {
            const [unsubscribedCustomers, unsubscribedTotalRows, allStatusAggs] = await Promise.all([
                marketingSuppressedEmailList.length > 0
                    ? prisma.$queryRaw<Array<{
                        id: string;
                        wooId: number;
                        email: string;
                        firstName: string | null;
                        lastName: string | null;
                        totalSpent: Prisma.Decimal;
                        ordersCount: number;
                        rawData: Prisma.JsonValue;
                        createdAt: Date;
                    }>>`
                        SELECT "id", "wooId", "email", "firstName", "lastName", "totalSpent", "ordersCount", "rawData", "createdAt"
                        FROM "WooCustomer"
                        WHERE "accountId" = ${accountId}
                          AND "ordersCount" > 0
                          AND lower("email") = ANY(${marketingSuppressedEmailList}::text[])
                          ${suppressionSearchClause}
                        ORDER BY "firstName" ASC NULLS LAST, "lastName" ASC NULLS LAST
                        LIMIT ${limit}
                        OFFSET ${from}
                    `
                    : Promise.resolve([]),
                marketingSuppressedEmailList.length > 0
                    ? prisma.$queryRaw<Array<{ count: bigint }>>`
                        SELECT COUNT(DISTINCT "id") AS count
                        FROM "WooCustomer"
                        WHERE "accountId" = ${accountId}
                          AND "ordersCount" > 0
                          AND lower("email") = ANY(${marketingSuppressedEmailList}::text[])
                          ${suppressionSearchClause}
                    `
                    : Promise.resolve([{ count: BigInt(0) }]),
                esClient.search({
                    index: 'customers',
                    query: {
                        bool: { must: baseMust }
                    },
                    from: 0,
                    size: 0,
                    track_total_hits: true,
                    aggs: {
                        contact_statuses: {
                            terms: {
                                field: 'rawData.contactStatus.keyword',
                                size: 10
                            }
                        }
                    }
                }).catch(() => null)
            ]);

            const unsubscribedTotal = Number(unsubscribedTotalRows[0]?.count || 0);
            const allTotal = (allStatusAggs?.hits.total as any)?.value || 0;
            const buckets = (allStatusAggs?.aggregations as any)?.contact_statuses?.buckets || [];
            const rawCounts = buckets.reduce((acc: Record<string, number>, bucket: { key: string; doc_count: number }) => {
                acc[bucket.key] = bucket.doc_count;
                return acc;
            }, {});
            const knownStatusesTotal = (rawCounts.UNVERIFIED || 0)
                + (rawCounts.SUBSCRIBED || 0)
                + (rawCounts.BOUNCED || 0)
                + (rawCounts.UNSUBSCRIBED || 0)
                + (rawCounts.SOFT_BOUNCED || 0)
                + (rawCounts.COMPLAINT || 0);
            const missingStatusCount = Math.max(allTotal - knownStatusesTotal, 0);
            const suppressedRawCounts = this.getSuppressedRawCounts(suppressedCustomerRows);

            return {
                customers: unsubscribedCustomers.map((customer) => ({
                    id: String(customer.wooId),
                    wooId: customer.wooId,
                    email: customer.email,
                    firstName: customer.firstName || '',
                    lastName: customer.lastName || '',
                    totalSpent: Number(customer.totalSpent),
                    ordersCount: customer.ordersCount,
                    dateCreated: customer.createdAt,
                    rawData: customer.rawData,
                    contactStatus: 'UNSUBSCRIBED' as ContactStatus
                })),
                total: unsubscribedTotal,
                page,
                totalPages: Math.ceil(unsubscribedTotal / limit),
                statusCounts: {
                    ALL: allTotal,
                    UNVERIFIED: Math.max((rawCounts.UNVERIFIED || 0) - (suppressedRawCounts.UNVERIFIED || 0), 0),
                    SUBSCRIBED: Math.max(((rawCounts.SUBSCRIBED || 0) + missingStatusCount) - (suppressedRawCounts.SUBSCRIBED || 0), 0),
                    BOUNCED: Math.max((rawCounts.BOUNCED || 0) - (suppressedRawCounts.BOUNCED || 0), 0),
                    UNSUBSCRIBED: Math.max((rawCounts.UNSUBSCRIBED || 0) - (suppressedRawCounts.UNSUBSCRIBED || 0), 0) + unsubscribedTotal,
                    SOFT_BOUNCED: Math.max((rawCounts.SOFT_BOUNCED || 0) - (suppressedRawCounts.SOFT_BOUNCED || 0), 0),
                    COMPLAINT: Math.max((rawCounts.COMPLAINT || 0) - (suppressedRawCounts.COMPLAINT || 0), 0) + allSuppressedCustomerRows.length
                }
            };

        }

        if (status !== 'ALL') {
            if (status === 'SUBSCRIBED') {
                statusMust.push({
                    bool: {
                        should: [
                            { term: { 'rawData.contactStatus.keyword': 'SUBSCRIBED' } },
                            { term: { 'rawData.contactStatus': 'SUBSCRIBED' } },
                            {
                                bool: {
                                    must_not: [
                                        { exists: { field: 'rawData.contactStatus' } }
                                    ]
                                }
                            }
                        ],
                        minimum_should_match: 1
                    }
                });
                if (suppressedEmailClause) {
                    statusMust.push(suppressedEmailClause);
                }
            } else if (status === 'COMPLAINT') {
                const should: any[] = [
                    { term: { 'rawData.contactStatus.keyword': 'COMPLAINT' } },
                    { term: { 'rawData.contactStatus': 'COMPLAINT' } }
                ];
                if (allSuppressedEmailList.length > 0) {
                    should.push(
                        { terms: { 'email.keyword': allSuppressedEmailList } },
                        { terms: { email: allSuppressedEmailList } }
                    );
                }
                statusMust.push({
                    bool: {
                        should,
                        minimum_should_match: 1
                    }
                });
                if (marketingSuppressedEmailList.length > 0) {
                    statusMust.push({
                        bool: {
                            must_not: [
                                { terms: { 'email.keyword': marketingSuppressedEmailList } },
                                { terms: { email: marketingSuppressedEmailList } }
                            ]
                        }
                    });
                }
            } else {
                statusMust.push({
                    bool: {
                        should: [
                            { term: { 'rawData.contactStatus.keyword': status } },
                            { term: { 'rawData.contactStatus': status } }
                        ],
                        minimum_should_match: 1
                    }
                });
                if (suppressedEmailClause) {
                    statusMust.push(suppressedEmailClause);
                }
            }
        }

        const advancedFilterClause = this.buildAdvancedFilterClause(advancedFilters);
        if (advancedFilterClause) {
            statusMust.push(advancedFilterClause);
        }

        try {
            const [response, allStatusAggs] = await Promise.all([
                esClient.search({
                index: 'customers',
                query: {
                    bool: { must: statusMust }
                },
                from,
                size: limit,
                sort: [
                    { 'firstName.keyword': { order: 'asc', unmapped_type: 'keyword' } },
                    { 'lastName.keyword': { order: 'asc', unmapped_type: 'keyword' } }
                ],
                track_total_hits: true
            }),
                esClient.search({
                    index: 'customers',
                    query: {
                        bool: { must: baseMust }
                    },
                    from: 0,
                    size: 0,
                    track_total_hits: true,
                    aggs: {
                        contact_statuses: {
                            terms: {
                                field: 'rawData.contactStatus.keyword',
                                size: 10
                            }
                        }
                    }
                })
            ]);

            const hits = response.hits.hits.map(hit => ({
                id: hit._id,
                ...(hit._source as any),
                contactStatus: normalizeContactStatus((hit._source as any)?.rawData?.contactStatus)
            }));

            const normalizedHits = hits.map((hit: any) => {
                const normalizedEmail = String(hit.email || '').trim().toLowerCase();
                const suppressionScope = suppressionByEmail.get(normalizedEmail);
                if (suppressionScope === 'ALL') {
                    return { ...hit, contactStatus: 'COMPLAINT' as ContactStatus };
                }
                if (suppressionScope === 'MARKETING') {
                    return { ...hit, contactStatus: 'UNSUBSCRIBED' as ContactStatus };
                }
                return hit;
            });

            const total = (response.hits.total as any).value || 0;
            const allTotal = (allStatusAggs.hits.total as any).value || 0;
            const buckets = (allStatusAggs.aggregations as any)?.contact_statuses?.buckets || [];
            const rawCounts = buckets.reduce((acc: Record<string, number>, bucket: { key: string; doc_count: number }) => {
                acc[bucket.key] = bucket.doc_count;
                return acc;
            }, {});
            const knownStatusesTotal = (rawCounts.UNVERIFIED || 0)
                + (rawCounts.SUBSCRIBED || 0)
                + (rawCounts.BOUNCED || 0)
                + (rawCounts.UNSUBSCRIBED || 0)
                + (rawCounts.SOFT_BOUNCED || 0)
                + (rawCounts.COMPLAINT || 0);
            const missingStatusCount = Math.max(allTotal - knownStatusesTotal, 0);
            const suppressedRawCounts = this.getSuppressedRawCounts(suppressedCustomerRows);
            const unsubscribedCount = marketingSuppressedCustomerRows.length;

            const statusCounts = {
                ALL: allTotal,
                UNVERIFIED: Math.max((rawCounts.UNVERIFIED || 0) - (suppressedRawCounts.UNVERIFIED || 0), 0),
                SUBSCRIBED: Math.max(((rawCounts.SUBSCRIBED || 0) + missingStatusCount) - (suppressedRawCounts.SUBSCRIBED || 0), 0),
                BOUNCED: Math.max((rawCounts.BOUNCED || 0) - (suppressedRawCounts.BOUNCED || 0), 0),
                UNSUBSCRIBED: Math.max((rawCounts.UNSUBSCRIBED || 0) - (suppressedRawCounts.UNSUBSCRIBED || 0), 0) + unsubscribedCount,
                SOFT_BOUNCED: Math.max((rawCounts.SOFT_BOUNCED || 0) - (suppressedRawCounts.SOFT_BOUNCED || 0), 0),
                COMPLAINT: Math.max((rawCounts.COMPLAINT || 0) - (suppressedRawCounts.COMPLAINT || 0), 0) + allSuppressedCustomerRows.length
            };
            Logger.debug(`CustomerSearch`, { query, page, total, status });

            return {
                customers: normalizedHits,
                total,
                page,
                totalPages: Math.ceil(total / limit),
                statusCounts
            };
        } catch (error) {
            Logger.error('Elasticsearch Customer Search Error', { error });
            return {
                customers: [],
                total: 0,
                page,
                totalPages: 0,
                statusCounts: {
                    ALL: 0,
                    UNVERIFIED: 0,
                    SUBSCRIBED: 0,
                    BOUNCED: 0,
                    UNSUBSCRIBED: 0,
                    SOFT_BOUNCED: 0,
                    COMPLAINT: 0
                }
            };
        }
    }

    static async getCustomerDetails(accountId: string, customerId: string) {
        // 1. Fetch Basic Customer Data

        // Check if looking up by WooID (numeric) or internal UUID
        const isWooId = !isNaN(Number(customerId));
        const whereClause = isWooId
            ? { accountId, wooId: Number(customerId) }
            : { accountId, id: customerId };

        Logger.debug(`CustomerDetails lookup`, { customerId, accountId, isWooId });
        Logger.debug(`CustomerDetails whereClause`, { whereClause });

        let customer = await prisma.wooCustomer.findFirst({
            where: whereClause
        });

        // FALLBACK: If still missing in DB (Consistency Issue), try to fetch from Elastic to at least show the profile
        if (!customer) {
            Logger.debug(`CustomerDetails missing in DB, trying ES fallback`, { customerId });
            try {
                // We need to find the document in ES. If isWooId, we search by wooId field.
                const esQuery = isWooId ? { term: { wooId: Number(customerId) } } : { term: { _id: customerId } };

                const esRes = await esClient.search({
                    index: 'customers',
                    query: {
                        bool: {
                            must: [
                                { term: { accountId } },
                                esQuery
                            ]
                        }
                    }
                });

                if (esRes.hits.hits.length > 0) {
                    const source = esRes.hits.hits[0]._source as any;
                    // Map ES source to match Prisma shape approx
                    customer = {
                        id: esRes.hits.hits[0]._id,
                        accountId,
                        wooId: source.wooId || Number(customerId),
                        firstName: source.firstName,
                        lastName: source.lastName,
                        email: source.email,
                        totalSpent: source.totalSpent,
                        ordersCount: source.ordersCount,
                        dateCreated: new Date(source.dateCreated || Date.now()), // Mock if missing
                        rawData: source.rawData || {}, // Might be missing
                        // Mock other required fields
                        updatedAt: new Date(),
                        createdAt: new Date()
                    } as any;
                }
            } catch (e) {
                Logger.error('CustomerDetails ES Fallback failed', { error: e });
            }
        }

        if (!customer) {
            Logger.debug('CustomerDetails not found in DB or ES');
            return null;
        }

        // 2. Related entities
        const normalizedEmail = customer.email.trim().toLowerCase();
        const [orders, orderStats, automationEnrollments, activitySessions, suppression, inboxConversations] = await Promise.all([
            prisma.wooOrder.findMany({
                where: {
                    accountId,
                    rawData: {
                        path: ['customer_id'],
                        equals: customer.wooId
                    }
                },
                select: {
                    id: true,
                    wooId: true,
                    number: true,
                    status: true,
                    total: true,
                    currency: true,
                    dateCreated: true
                },
                orderBy: { dateCreated: 'desc' },
                take: 10
            }),
            prisma.wooOrder.aggregate({
                where: {
                    accountId,
                    rawData: {
                        path: ['customer_id'],
                        equals: customer.wooId
                    }
                },
                _count: {
                    id: true
                },
                _sum: {
                    total: true
                }
            }),
            prisma.automationEnrollment.findMany({
                where: {
                    automation: { accountId },
                    email: customer.email
                },
                include: {
                    automation: { select: { name: true } }
                },
                orderBy: { createdAt: 'desc' },
                take: 20
            }),
            prisma.analyticsSession.findMany({
                where: {
                    accountId,
                    OR: [
                        { wooCustomerId: customer.wooId },
                        { email: customer.email }
                    ]
                },
                select: {
                    id: true,
                    visitorId: true,
                    currentPath: true,
                    referrer: true,
                    lastActiveAt: true,
                    country: true,
                    city: true,
                    deviceType: true,
                    events: {
                        select: {
                            id: true,
                            type: true,
                            url: true,
                            createdAt: true
                        },
                        orderBy: { createdAt: 'desc' },
                        take: 5
                    }
                },
                orderBy: { lastActiveAt: 'desc' },
                take: 5
            }),
            prisma.emailUnsubscribe.findFirst({
                where: {
                    accountId,
                    email: { equals: normalizedEmail, mode: 'insensitive' }
                },
                select: { scope: true }
            }),
            prisma.conversation.findMany({
                where: {
                    accountId,
                    channel: 'EMAIL',
                    mergedIntoId: null,
                    OR: [
                        { wooCustomerId: customer.id },
                        { guestEmail: { equals: normalizedEmail, mode: 'insensitive' } }
                    ]
                },
                select: {
                    id: true,
                    title: true,
                    guestEmail: true,
                    updatedAt: true,
                    status: true,
                    messages: {
                        where: { senderType: 'CUSTOMER', isInternal: false },
                        select: { id: true, content: true, createdAt: true },
                        orderBy: { createdAt: 'desc' },
                        take: 1
                    }
                },
                orderBy: { updatedAt: 'desc' },
                take: 8
            })
        ]);

        const automationIds = [...new Set(automationEnrollments.map((enrollment) => enrollment.automationId))];
        const firstEnrollmentAt = automationEnrollments.reduce<Date | null>((earliest, enrollment) => {
            const enteredAt = enrollment.enteredAt || enrollment.createdAt;
            if (!earliest || enteredAt < earliest) return enteredAt;
            return earliest;
        }, null);
        const automationEmailLogs = automationIds.length > 0 && firstEnrollmentAt
            ? await prisma.emailLog.findMany({
                where: {
                    accountId,
                    source: 'AUTOMATION',
                    sourceId: { in: automationIds },
                    to: { equals: customer.email, mode: 'insensitive' },
                    createdAt: { gte: firstEnrollmentAt }
                },
                select: {
                    id: true,
                    sourceId: true,
                    to: true,
                    subject: true,
                    status: true,
                    errorMessage: true,
                    messageId: true,
                    firstOpenedAt: true,
                    openCount: true,
                    canRetry: true,
                    emailBodyExpiresAt: true,
                    createdAt: true
                },
                orderBy: { createdAt: 'desc' },
                take: 100
            })
            : [];

        const now = new Date();
        const automationEmailLogsByEnrollment = new Map<string, Array<(typeof automationEmailLogs)[number] & { canResend: boolean }>>();
        for (const enrollment of automationEnrollments) {
            const startedAt = enrollment.enteredAt || enrollment.createdAt;
            const endedAt = enrollment.completedAt || enrollment.cancelledAt || null;
            const matchingLogs = automationEmailLogs.filter((log) => {
                if (log.sourceId !== enrollment.automationId) return false;
                if (log.createdAt < startedAt) return false;
                if (endedAt && log.createdAt > endedAt) return false;
                return true;
            }).map((log) => ({
                ...log,
                canResend: log.status === 'FAILED'
                    ? log.canRetry
                    : Boolean(log.emailBodyExpiresAt && log.emailBodyExpiresAt > now)
            }));
            automationEmailLogsByEnrollment.set(enrollment.id, matchingLogs);
        }

        // Compute stats from all local orders as fallback when WooCommerce reports 0
        const dbTotalSpent = Number(customer.totalSpent);
        const computedTotalSpent = Number(orderStats._sum.total || 0);
        const effectiveTotalSpent = dbTotalSpent > 0 ? dbTotalSpent : computedTotalSpent;
        const effectiveOrdersCount = customer.ordersCount > 0 ? customer.ordersCount : (orderStats._count.id || 0);

        const persistedStatus = normalizeContactStatus((customer.rawData as Record<string, unknown> | null)?.contactStatus);
        const contactStatus: ContactStatus = suppression?.scope === 'ALL'
            ? 'COMPLAINT'
            : suppression?.scope === 'MARKETING'
                ? (persistedStatus === 'SUBSCRIBED' ? 'UNSUBSCRIBED' : persistedStatus)
                : persistedStatus;

        return {
            customer: {
                ...customer,
                totalSpent: effectiveTotalSpent,
                ordersCount: effectiveOrdersCount,
                contactStatus
            },
            orders,
            automations: automationEnrollments.map((enrollment) => ({
                ...enrollment,
                emailLogs: automationEmailLogsByEnrollment.get(enrollment.id) || []
            })),
            activity: activitySessions,
            sendingMethods: CONTACT_STATUS_METHODS[contactStatus],
            inboxConversations: inboxConversations.map((conversation) => ({
                id: conversation.id,
                title: conversation.title,
                guestEmail: conversation.guestEmail,
                status: conversation.status,
                updatedAt: conversation.updatedAt,
                lastInboundMessage: conversation.messages[0]
                    ? {
                        id: conversation.messages[0].id,
                        content: conversation.messages[0].content,
                        createdAt: conversation.messages[0].createdAt
                    }
                    : null
            }))
        };
    }

    static async updateContactStatus(accountId: string, customerId: string, nextStatus: ContactStatus) {
        const customer = await prisma.wooCustomer.findFirst({ where: { accountId, id: customerId } });
        if (!customer) return null;

        const existingRawData = (customer.rawData as Record<string, unknown> | null) ?? {};
        const normalizedEmail = customer.email.trim().toLowerCase();

        await prisma.wooCustomer.update({
            where: { id: customer.id },
            data: {
                rawData: {
                    ...existingRawData,
                    contactStatus: nextStatus
                }
            }
        });

        if (nextStatus === 'SUBSCRIBED') {
            await prisma.emailUnsubscribe.deleteMany({
                where: {
                    accountId,
                    email: { equals: normalizedEmail, mode: 'insensitive' }
                }
            });
        } else if (nextStatus === 'BOUNCED' || nextStatus === 'COMPLAINT') {
            await prisma.emailUnsubscribe.upsert({
                where: { accountId_email: { accountId, email: normalizedEmail } },
                create: {
                    accountId,
                    email: normalizedEmail,
                    scope: 'ALL',
                    reason: nextStatus === 'COMPLAINT' ? 'Marked as complaint in customer profile' : 'Marked as hard bounce in customer profile'
                },
                update: {
                    scope: 'ALL',
                    reason: nextStatus === 'COMPLAINT' ? 'Marked as complaint in customer profile' : 'Marked as hard bounce in customer profile'
                }
            });
        } else {
            await prisma.emailUnsubscribe.upsert({
                where: { accountId_email: { accountId, email: normalizedEmail } },
                create: {
                    accountId,
                    email: normalizedEmail,
                    scope: 'MARKETING',
                    reason: `Marked as ${nextStatus.toLowerCase().replace('_', ' ')} in customer profile`
                },
                update: {
                    scope: 'MARKETING',
                    reason: `Marked as ${nextStatus.toLowerCase().replace('_', ' ')} in customer profile`
                }
            });
        }

        return {
            contactStatus: nextStatus,
            sendingMethods: CONTACT_STATUS_METHODS[nextStatus]
        };
    }

    /**
     * Find potential duplicate customers by email or phone.
     */
    static async findDuplicates(accountId: string, customerId: string) {
        // Get the target customer first
        const isWooId = !isNaN(Number(customerId));
        const whereClause = isWooId
            ? { accountId, wooId: Number(customerId) }
            : { accountId, id: customerId };

        const customer = await prisma.wooCustomer.findFirst({ where: whereClause });
        if (!customer) return { duplicates: [] };

        const email = customer.email;

        // Find other customers with matching email
        const duplicates = await prisma.wooCustomer.findMany({
            where: {
                accountId,
                id: { not: customer.id },
                email: email
            },
            select: {
                id: true,
                wooId: true,
                firstName: true,
                lastName: true,
                email: true,
                ordersCount: true,
                totalSpent: true
            }
        });

        return {
            target: {
                id: customer.id,
                wooId: customer.wooId,
                firstName: customer.firstName,
                lastName: customer.lastName,
                email: customer.email,
                ordersCount: customer.ordersCount,
                totalSpent: customer.totalSpent
            },
            duplicates
        };
    }

    /**
     * Merge source customer into target customer.
     * Transfers orders, conversations, automation enrollments, then deletes source.
     */
    static async mergeCustomers(accountId: string, targetId: string, sourceId: string) {
        Logger.info(`Merging customer ${sourceId} into ${targetId}`, { accountId });

        // Get both customers before entering the transaction
        const target = await prisma.wooCustomer.findFirst({ where: { accountId, id: targetId } });
        const source = await prisma.wooCustomer.findFirst({ where: { accountId, id: sourceId } });

        if (!target || !source) {
            throw new Error('Customer not found');
        }

        // Fetch orders to update before the transaction (read-only, no lock needed)
        const sourceOrders = await prisma.wooOrder.findMany({
            where: {
                accountId,
                rawData: { path: ['customer_id'], equals: source.wooId }
            },
            select: { id: true, rawData: true }
        });

        // All writes are atomic — if any step fails the whole merge rolls back.
        // Why: a crash between steps would leave a partially-merged record.
        // timeout: 30s — customers with large order histories can have 50+ concurrent
        // order updates inside the transaction; the default 5s is too tight.
        const result = await prisma.$transaction(async (tx) => {
            // 1. Transfer Orders (unique rawData per order — parallel within transaction)
            const orderUpdates = sourceOrders.map(order => {
                const rawData = order.rawData as any;
                rawData.customer_id = target.wooId;
                return tx.wooOrder.update({
                    where: { id: order.id },
                    data: { rawData }
                });
            });
            await Promise.all(orderUpdates);

            // 2. Transfer Conversations
            await tx.conversation.updateMany({
                where: { accountId, wooCustomerId: source.id },
                data: { wooCustomerId: target.id }
            });

            // 3. Transfer Automation Enrollments
            await tx.automationEnrollment.updateMany({
                where: { email: source.email },
                data: { email: target.email }
            });

            // 4. Update target totals
            const newTotalSpent = Number(target.totalSpent) + Number(source.totalSpent);
            await tx.wooCustomer.update({
                where: { id: target.id },
                data: {
                    ordersCount: target.ordersCount + source.ordersCount,
                    totalSpent: newTotalSpent
                }
            });

            // 5. Delete source customer
            await tx.wooCustomer.delete({ where: { id: source.id } });

            return sourceOrders.length;
        }, {
            // Default Prisma interactive tx timeout is 5s — too tight for customers with
            // 50+ orders doing parallel updates inside the transaction.
            timeout: 30_000
        });


        Logger.info(`Customer merge complete`, {
            targetId,
            sourceId,
            ordersTransferred: result
        });

        return {
            success: true,
            ordersTransferred: result,
            targetId
        };
    }
}
