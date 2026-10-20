import { prisma } from '../../utils/prisma';
import { Prisma } from '@prisma/client';
import { dateKeyInTimezone, normalizeTimezone, startOfDateInTimezone } from '../../utils/timezone';
import { getWeekStart } from '../analytics/utils/dateRangeUtils';

const BATCH_SIZE = 1000;
type Page = { take: number; cursor?: { id: string }; skip?: number };
async function* pages<T extends { id: string }>(fetch: (page: Page) => Promise<T[]>) {
    let cursor: string | undefined;
    while (true) {
        const rows = await fetch({ take: BATCH_SIZE, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
        if (rows.length) yield rows;
        if (rows.length < BATCH_SIZE) return;
        cursor = rows[rows.length - 1].id;
    }
}
function record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function text(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }
function amount(value: unknown): number | null {
    if (Prisma.Decimal.isDecimal(value)) {
        const n = value.toNumber();
        return Number.isFinite(n) && n >= 0 ? n : null;
    }
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    if (typeof value === 'string' && !/^\d+(?:\.\d+)?$/.test(value.trim())) return null;
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : null;
}
function positiveId(value: unknown): number | null {
    const id = amount(value);
    return id != null && Number.isSafeInteger(id) && id > 0 ? id : null;
}
function shiftDay(key: string, days: number): string {
    const date = new Date(`${key}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
}
function weekKey(date: Date, timezone: string): string {
    return dateKeyInTimezone(getWeekStart(date, timezone), timezone);
}
function weeksBetween(start: string, end: string): number {
    return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / (7 * 86400000));
}

/** Sessions are unique per account/visitor, so createdAt is the persisted first-seen date. */
export async function getCohorts(accountId: string) {
    if (!text(accountId)) throw new Error('Account ID required');
    const account = await prisma.account.findUnique({ where: { id: accountId }, select: { timezone: true } });
    if (!account) throw new Error('Account not found');
    const timezone = normalizeTimezone(account.timezone);
    const now = new Date();
    const currentWeek = weekKey(now, timezone);
    const cutoff = startOfDateInTimezone(shiftDay(currentWeek, -49), timezone);
    const cohorts = new Map<string, { total: number; retained: Map<number, number> }>();
    for await (const sessions of pages(page => prisma.analyticsSession.findMany({
        ...page, where: { accountId, createdAt: { gte: cutoff, lte: now } }, orderBy: { id: 'asc' },
        select: { id: true, visitorId: true, createdAt: true, lastActiveAt: true },
    }))) {
        const visitors = new Map(sessions.map(session => [session.id, { start: session.createdAt, week: weekKey(session.createdAt, timezone), active: new Set([0]) }]));
        const mark = (sessionId: string, when: Date) => {
            const visitor = visitors.get(sessionId);
            if (!visitor || !(when instanceof Date) || !Number.isFinite(when.getTime()) || when < visitor.start || when > now) return;
            const week = weeksBetween(visitor.week, weekKey(when, timezone));
            if (week >= 0 && week <= 7) visitor.active.add(week);
        };
        // Endpoints are observations, not evidence of activity in every intervening week.
        for (const session of sessions) mark(session.id, session.lastActiveAt);
        for await (const events of pages(page => prisma.analyticsEvent.findMany({
            ...page, where: { session: { accountId }, sessionId: { in: sessions.map(s => s.id) }, occurredAt: { gte: cutoff, lte: now } },
            orderBy: { id: 'asc' }, select: { id: true, sessionId: true, occurredAt: true },
        }))) for (const event of events) mark(event.sessionId, event.occurredAt);
        for (const visitor of visitors.values()) {
            const cohort = cohorts.get(visitor.week) || { total: 0, retained: new Map<number, number>() };
            cohort.total++;
            for (const week of visitor.active) cohort.retained.set(week, (cohort.retained.get(week) || 0) + 1);
            cohorts.set(visitor.week, cohort);
        }
    }
    return {
        timezone, activityBasis: 'Recorded session endpoints and event timestamps; missing weeks are not inferred active',
        cohorts: [...cohorts].sort(([a], [b]) => a.localeCompare(b)).map(([week, data]) => ({
            week, totalVisitors: data.total,
            retention: Array.from({ length: Math.min(7, weeksBetween(week, currentWeek)) + 1 }, (_, index) => ({
                week: index, count: data.retained.get(index) || 0, rate: Math.round((data.retained.get(index) || 0) / data.total * 100),
            })),
        })),
    };
}

interface CustomerTotals { revenue: number; orders: number; }
function summarize(totals: Map<string, CustomerTotals>) {
    const customers = [...totals.entries()];
    const repeat = customers.filter(([, value]) => value.orders > 1).length;
    const revenue = customers.reduce((sum, [, value]) => sum + value.revenue, 0);
    if (!Number.isFinite(revenue)) throw new Error('Invalid LTV aggregate');
    return {
        avgLTV: customers.length ? Number((revenue / customers.length).toFixed(2)) : 0,
        totalCustomers: customers.length, repeatCustomers: repeat,
        repeatRate: customers.length ? Math.round(repeat / customers.length * 1000) / 10 : 0,
        topCustomers: customers.map(([id, value]) => ({ customerId: id.slice(id.indexOf(':') + 1), ltv: Number(value.revenue.toFixed(2)), orders: value.orders }))
            .sort((a, b) => b.ltv - a.ltv || a.customerId.localeCompare(b.customerId)).slice(0, 10),
    };
}

/** Identified-buyer LTV in the store currency; other currencies are never summed into it. */
export async function getLTV(accountId: string) {
    if (!text(accountId)) throw new Error('Account ID required');
    const account = await prisma.account.findUnique({ where: { id: accountId }, select: { currency: true } });
    if (!account) throw new Error('Account not found');
    const primary = text(account.currency).toUpperCase();
    if (!/^[A-Z]{3}$/.test(primary)) throw new Error('Invalid account currency');
    const currencies = new Map<string, Map<string, CustomerTotals>>();
    const emailIds = new Map<string, Set<number>>();
    const seen = new Set<string>();
    let duplicatePurchaseEvents = 0;
    let excludedUnidentifiedEvents = 0;
    let excludedInvalidEvents = 0;
    let purchasesWithoutOrderId = 0;
    let currencyInferredPurchases = 0;
    const now = new Date();
    for await (const events of pages(page => prisma.analyticsEvent.findMany({
        ...page, where: { session: { accountId }, type: 'purchase', createdAt: { lte: now } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { id: true, orderId: true, payload: true, session: { select: { wooCustomerId: true, email: true } } },
    }))) {
        for (const event of events) {
            const payload = record(event.payload);
            const total = amount(payload.total);
            const rawCurrency = text(payload.currency).toUpperCase();
            const currency = rawCurrency || primary;
            if (total == null || !/^[A-Z]{3}$/.test(currency)) { excludedInvalidEvents++; continue; }
            // Purchase-time identity wins over mutable visitor/session identity, including explicit guest ID=0.
            const id = positiveId(Object.hasOwn(payload, 'customerId') ? payload.customerId : event.session?.wooCustomerId);
            const rawEmail = text(Object.hasOwn(payload, 'email') ? payload.email : event.session?.email).toLowerCase();
            const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail) ? rawEmail : '';
            if (email && id) {
                const ids = emailIds.get(email) || new Set<number>(); ids.add(id); emailIds.set(email, ids);
            }
            const identity = id ? `id:${id}` : email ? `email:${email}` : '';
            if (!identity) { excludedUnidentifiedEvents++; continue; }
            const orderId = positiveId(event.orderId) || positiveId(payload.orderId) || positiveId(payload.order_id);
            const eventId = text(payload.eventId);
            const dedupKey = orderId ? `order:${orderId}` : eventId ? `event:${eventId}` : `row:${event.id}`;
            if (seen.has(dedupKey)) { duplicatePurchaseEvents++; continue; }
            seen.add(dedupKey);
            if (!orderId) purchasesWithoutOrderId++;
            if (!rawCurrency) currencyInferredPurchases++;
            const customers = currencies.get(currency) || new Map<string, CustomerTotals>();
            const customer = customers.get(identity) || { revenue: 0, orders: 0 };
            if (!Number.isFinite(customer.revenue + total)) throw new Error('Invalid LTV aggregate');
            customer.revenue += total; customer.orders++;
            customers.set(identity, customer); currencies.set(currency, customers);
        }
    }
    // Merge email-only purchases only when that email unambiguously belongs to one known customer ID.
    for (const customers of currencies.values()) {
        for (const [email, ids] of emailIds) {
            const guest = customers.get(`email:${email}`);
            if (!guest || ids.size !== 1) continue;
            const key = `id:${[...ids][0]}`;
            const customer = customers.get(key) || { revenue: 0, orders: 0 };
            if (!Number.isFinite(customer.revenue + guest.revenue)) throw new Error('Invalid LTV aggregate');
            customer.revenue += guest.revenue; customer.orders += guest.orders;
            customers.set(key, customer); customers.delete(`email:${email}`);
        }
    }
    return {
        ...summarize(currencies.get(primary) || new Map()), currency: primary, identifiedOnly: true,
        byCurrency: Object.fromEntries([...currencies].map(([currency, customers]) => [currency, summarize(customers)])),
        duplicatePurchaseEvents, excludedUnidentifiedEvents, excludedInvalidEvents, purchasesWithoutOrderId, currencyInferredPurchases,
    };
}

/** Purchase likelihood heuristic with bounded, finite inputs and output. */
export function calculatePurchaseIntent(session: unknown): number {
    const data = record(session);
    const visits = amount(data.totalVisits) || 0;
    const cart = amount(data.cartValue) || 0;
    let score = Math.min(visits * 2, 20) + (cart > 0 ? 30 : 0) + Math.min(cart / 10, 20);
    if (data.isReturning === true) score += 15;
    if (typeof data.currentPath === 'string' && /(?:^|\/)checkout(?:\/|[?#]|$)/i.test(data.currentPath)) score += 15;
    return Math.max(0, Math.min(Math.round(score), 100));
}
