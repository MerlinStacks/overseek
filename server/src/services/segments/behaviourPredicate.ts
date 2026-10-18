import { Prisma } from '@prisma/client';
import type { SegmentRule } from './criteria';

/** Shared by customer segments and advertising-only subscriber expansion. c is tenant scoped. */
export function behaviourPredicate(rule: SegmentRule, now = new Date()): Prisma.Sql {
    const cutoff = new Date(now.getTime() - Number(rule.value) * 86400000);
    if (rule.field.startsWith('email') || rule.field.startsWith('notEmail')) {
        const type = rule.field.includes('Clicked') ? 'CLICK' : 'OPEN';
        const campaign = rule.campaignId ? Prisma.sql`AND l."sourceId" = ${rule.campaignId}` : Prisma.empty;
        const event = Prisma.sql`EXISTS (SELECT 1 FROM "EmailLog" l JOIN "MessageTrackingEvent" t ON t."emailLogId" = l.id
            WHERE l."accountId" = c."accountId" AND lower(trim(l."to")) = lower(trim(c.email))
            AND t."eventType" = ${type} AND t."createdAt" >= ${cutoff} AND t."createdAt" <= ${now} ${campaign})`;
        return rule.field.startsWith('notEmail') ? Prisma.sql`NOT ${event}` : event;
    }
    const orderIdentity = Prisma.sql`(o."wooCustomerId" = c."wooId" AND c."wooId" > 0 OR lower(trim(o."billingEmail")) = lower(trim(c.email)) AND trim(c.email) <> '')`;
    const purchase = Prisma.sql`EXISTS (SELECT 1 FROM "WooOrder" o WHERE o."accountId" = c."accountId" AND ${orderIdentity} AND o.status IN ('processing', 'completed') AND o."dateCreated" >= ${cutoff} AND o."dateCreated" <= ${now})`;
    if (rule.field === 'notPurchasedWithinDays') return Prisma.sql`NOT ${purchase}`;
    if (rule.field !== 'abandonedCartWithinDays') return purchase;
    const inactive = new Date(now.getTime() - 30 * 60000);
    return Prisma.sql`EXISTS (
        SELECT 1 FROM "AnalyticsSession" s WHERE s."accountId" = c."accountId"
        AND (s."wooCustomerId" = c."wooId" AND c."wooId" > 0 OR lower(trim(s.email)) = lower(trim(c.email)) AND trim(c.email) <> '')
        AND s."cartValue" > 0 AND s."lastActiveAt" >= ${cutoff} AND s."lastActiveAt" <= ${inactive}
        AND NOT EXISTS (SELECT 1 FROM "WooOrder" o WHERE o."accountId" = c."accountId" AND ${orderIdentity} AND o.status IN ('processing', 'completed') AND o."dateCreated" >= s."lastActiveAt")
        AND NOT EXISTS (SELECT 1 FROM "AnalyticsEvent" e WHERE e."sessionId" = s.id AND e.type = 'purchase' AND e."occurredAt" >= s."lastActiveAt")
    )`;
}
