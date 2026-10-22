import { randomUUID } from 'crypto';
import { prisma } from '../utils/prisma';
import { z } from 'zod';
export const scopeId = z.string().trim().min(1).max(200);
/** Admission is charged even on failure: provider cost/acknowledgement may be ambiguous. */
export async function claimProviderWork(accountId: string, namespace: 'chat' | 'embedding' | 'email-test', units: number) {
    scopeId.parse(accountId);
    if (!Number.isInteger(units) || units < 1 || units > 100) throw new Error('Invalid work units');
    const id = `provider-budget:${namespace}:${accountId}`, owner = randomUUID(), now = Date.now(), window = Math.floor(now / 3600000);
    await prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${id}, 0))`;
        const row = await tx.scopedOperation.findUnique({ where: { id } });
        const previous = row?.result as { window?: number; units?: number; until?: number } | undefined;
        const used = previous?.window === window ? previous.units ?? 1000 : 0;
        if ((previous?.until ?? 0) > now || used + units > 100) throw Object.assign(new Error('Provider work busy or hourly limit reached'), { statusCode: 429 });
        const result = { window, units: used + units, owner, until: now + 120000 };
        await tx.scopedOperation.upsert({ where: { id }, create: { id, accountId, kind: `provider-budget-${namespace}`, result }, update: { result } });
    });
    return async () => { await prisma.$executeRaw`UPDATE "ScopedOperation" SET result = jsonb_set(result, '{until}', '0'::jsonb) WHERE id = ${id} AND result->>'owner' = ${owner}`; };
}

/** Response body and deadline remain bounded through consumption, not only response headers. */
export async function providerJson(url: string, init: RequestInit, maxBytes = 1048576, signal?: AbortSignal): Promise<unknown> {
    const deadline = AbortSignal.timeout(20000);
    const response = await fetch(url, { ...init, redirect: 'error', signal: signal ? AbortSignal.any([signal, deadline]) : deadline });
    if (!response.ok || !response.headers.get('content-type')?.includes('application/json') || !response.body) {
        await response.body?.cancel().catch(() => undefined);
        throw new Error('Provider response unavailable');
    }
    const reader = response.body.getReader(); let length = 0; const chunks: Uint8Array[] = [];
    try { while (true) { const { done, value } = await reader.read(); if (done) break; length += value.byteLength; if (length > maxBytes) throw new Error('Provider response exceeds bounds'); chunks.push(value); } }
    catch (error) { await reader.cancel().catch(() => undefined); throw error; } finally { reader.releaseLock(); }
    const bytes = Buffer.concat(chunks); return JSON.parse(bytes.toString('utf8'));
}
