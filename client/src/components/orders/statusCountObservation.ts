import { z } from 'zod';
export const normalizeStatus = (value: string) => value.trim().toLowerCase().replace(/^wc-/, '');
export function decodeStatusCounts(value: unknown) {
    const data = z.object({ total: z.number().int().nonnegative().safe(), counts: z.record(z.string().min(1).max(80), z.number().int().nonnegative().safe()) }).parse(value);
    const counts: Record<string, number> = Object.create(null);
    if (Object.keys(data.counts).length > 200) throw new Error('Status window exceeded');
    for (const [key, count] of Object.entries(data.counts)) {
        const status = normalizeStatus(key);
        if (!/^[a-z0-9_-]{1,80}$/.test(status) || status === 'all') throw new Error('Invalid status');
        counts[status] = (counts[status] ?? 0) + count;
    }
    if (Object.values(counts).reduce((sum, count) => sum + count, 0) !== data.total) throw new Error('Count coverage unavailable');
    return { total: data.total, counts };
}
