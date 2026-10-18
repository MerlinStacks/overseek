import { Prisma } from '@prisma/client';
import { prisma } from '../../utils/prisma';
import { behaviourPredicate } from '../segments/behaviourPredicate';
import { rollingFields, validateCriteria, type SegmentCriteria, type SegmentRule } from '../segments/criteria';
import type { AdvertisingProfile } from '../SegmentService';

function rulePredicate(rule: SegmentRule): Prisma.Sql {
    if (rollingFields.includes(rule.field)) return behaviourPredicate(rule);
    const columns: Record<string, Prisma.Sql> = {
        email: Prisma.sql`c.email`, firstName: Prisma.sql`c."firstName"`, lastName: Prisma.sql`c."lastName"`,
        totalSpent: Prisma.sql`c."totalSpent"`, ordersCount: Prisma.sql`c."ordersCount"`,
    };
    const column = columns[rule.field];
    if (['totalSpent', 'ordersCount'].includes(rule.field)) {
        const operators: Record<string, Prisma.Sql> = { gt: Prisma.sql`>`, lt: Prisma.sql`<`, gte: Prisma.sql`>=`, lte: Prisma.sql`<=`, eq: Prisma.sql`=` };
        return Prisma.sql`${column} ${operators[rule.operator]} ${Number(rule.value)}`;
    }
    // Escape LIKE metacharacters: rules are literal text, not SQL patterns.
    const value = String(rule.value).toLowerCase();
    if (rule.operator === 'equals') return Prisma.sql`lower(${column}) = ${value}`;
    const escaped = value.replace(/[\\%_]/g, '\\$&');
    return Prisma.sql`lower(${column}) LIKE ${rule.operator === 'contains' ? `%${escaped}%` : `${escaped}%`}`;
}

/** Explicit opt-in expansion only; never inserts synthetic WooCustomer records. */
export async function getAdvertisingSubscribers(accountId: string, criteria: SegmentCriteria): Promise<AdvertisingProfile[]> {
    const error = validateCriteria(criteria);
    if (error) throw new Error(error);
    const predicates = criteria.rules.map(rulePredicate);
    const predicate = predicates.length ? Prisma.join(predicates, criteria.type === 'OR' ? ' OR ' : ' AND ') : Prisma.sql`TRUE`;
    return prisma.$queryRaw<AdvertisingProfile[]>(Prisma.sql`
        WITH subscribers AS (
            SELECT DISTINCT lower(trim(m.email)) AS email FROM "EmailListMember" m
            JOIN "EmailList" l ON l.id = m."listId" AND l."accountId" = m."accountId"
            WHERE m."accountId" = ${accountId} AND m."isSubscribed" = true AND l."isActive" = true AND trim(m.email) <> ''
            AND NOT EXISTS (SELECT 1 FROM "WooCustomer" w WHERE w."accountId" = m."accountId" AND lower(trim(w.email)) = lower(trim(m.email)))
            AND NOT EXISTS (SELECT 1 FROM "EmailUnsubscribe" u WHERE u."accountId" = m."accountId" AND lower(trim(u.email)) = lower(trim(m.email)))
        ), c AS (
            SELECT s.email, ${accountId}::text AS "accountId", 0 AS "wooId", ''::text AS "firstName", ''::text AS "lastName",
                (SELECT count(*)::int FROM "WooOrder" o WHERE o."accountId" = ${accountId} AND lower(trim(o."billingEmail")) = s.email AND o.status IN ('processing', 'completed')) AS "ordersCount",
                (SELECT coalesce(sum(o.total), 0) FROM "WooOrder" o WHERE o."accountId" = ${accountId} AND lower(trim(o."billingEmail")) = s.email AND o.status IN ('processing', 'completed')) AS "totalSpent"
            FROM subscribers s
        ) SELECT c.email FROM c WHERE (${predicate}) ORDER BY c.email
    `);
}
