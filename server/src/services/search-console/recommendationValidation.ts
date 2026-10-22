import { z } from 'zod';
export const aiRecommendationsSchema = z.object({ recommendations: z.array(z.object({
    title: z.string().trim().min(1).max(200), description: z.string().trim().min(1).max(3000),
    keywords: z.array(z.string().trim().min(1).max(200)).min(1).max(10),
    priority: z.enum(['high', 'medium', 'low']), effort: z.enum(['low', 'medium', 'high']),
    expectedImpact: z.string().trim().min(1).max(1000), actionType: z.enum(['content', 'optimization', 'technical', 'trend']),
}).strict()).max(10) }).strict();
export function validQueries<T extends { query: string; clicks: number; impressions: number; position: number; ctr: number }>(rows: T[], max: number): T[] {
    if (!Array.isArray(rows) || rows.length > max || rows.some(row => !row || typeof row.query !== 'string' || !row.query.trim() || row.query.length > 1000 ||
        ![row.clicks, row.impressions, row.position, row.ctr].every(value => typeof value === 'number' && Number.isFinite(value) && value >= 0) || row.clicks > row.impressions || row.ctr > 100)) throw new Error('Invalid query observations');
    return rows;
}
export async function boundedProviderJson(response: Response): Promise<unknown> {
    if (!response.ok || Number(response.headers.get('content-length') || 0) > 65536 || !response.body) throw new Error('AI provider response unavailable');
    const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
    try { while (true) { const next = await reader.read(); if (next.done) break; size += next.value.byteLength; if (size > 65536) { await reader.cancel(); throw new Error('AI response too large'); } chunks.push(next.value); } }
    finally { reader.releaseLock(); }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
