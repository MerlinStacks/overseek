import { prisma } from '../../utils/prisma';
import { REVENUE_STATUSES } from '../../constants/orderStatus';

export const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
export const nonnegative = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
export function amount(value: unknown): number | null {
    if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value))) return null;
    const parsed = Number(value); return nonnegative(parsed) ? parsed : null;
}
export const currencyCode = (value: unknown): string | null => typeof value === 'string' && /^[A-Z]{3}$/.test(value) ? value : null;
export const termText = (value: unknown): string | null => typeof value === 'string' && value.length <= 200 ? value.normalize('NFKC').toLowerCase().trim().replace(/\s+/g, ' ') || null : null;
export function trustedAccount(accountId: string) { if (typeof accountId !== 'string' || !accountId.trim() || accountId.length > 200) throw new Error('Account scope required'); }
export async function boundedRead<T>(read: Promise<T>, milliseconds = 25000): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([read, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Observation deadline exceeded')), milliseconds); timer.unref?.(); })]); }
    finally { if (timer) clearTimeout(timer); }
}
export async function calendarWindow(accountId: string, days = 30) {
    trustedAccount(accountId);
    const account = await prisma.account.findUnique({ where: { id: accountId }, select: { timezone: true } });
    if (!account?.timezone) throw new Error('Account reporting timezone unavailable');
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: account.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    const part = (key: string) => parts.find(p => p.type === key)!.value;
    const today = `${part('year')}-${part('month')}-${part('day')}`;
    const shift = (date: string, delta: number) => new Date(Date.parse(`${date}T00:00:00Z`) + delta * 86400000).toISOString().slice(0, 10);
    return { startDate: shift(today, -days), endDate: shift(today, -1), today, timezone: account.timezone, days, shift };
}
/** Bounded observed-order sample, not lifetime value or complete acquisition attribution. */
export async function recentOrders(accountId: string) {
    trustedAccount(accountId);
    const end = new Date(), start = new Date(end.getTime() - 30 * 86400000);
    const found = await prisma.wooOrder.findMany({ where: { accountId, status: { in: REVENUE_STATUSES }, dateCreated: { gte: start, lt: end } }, select: { id: true, rawData: true, total: true, dateCreated: true }, orderBy: [{ dateCreated: 'desc' }, { id: 'asc' }], take: 10001 });
    return { orders: found.slice(0, 10000), coverage: { start: start.toISOString(), end: end.toISOString(), basis: 'observed-orders-rolling-30-days', limit: 10000, truncated: found.length > 10000 } };
}
