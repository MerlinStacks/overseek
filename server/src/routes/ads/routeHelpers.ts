import type { FastifyRequest, FastifyReply } from 'fastify';
export class InvalidPositiveInteger extends RangeError {}

export function getAdsAccountIdOrReply(request: Pick<FastifyRequest, 'accountId'>, reply: FastifyReply): string | null {
    const accountId = request.accountId;
    if (typeof accountId !== 'string' || !accountId.trim() || accountId.length > 200) {
        reply.code(400).send({ error: 'No account selected' });
        return null;
    }
    return accountId;
}

export function parsePositiveInt(value: unknown, fallback: number, maximum = 1000000): number {
    if (!Number.isSafeInteger(fallback) || fallback < 1 || fallback > maximum) throw new RangeError('Invalid integer default');
    if (value === undefined) return fallback;
    if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || value.length > 16) throw new InvalidPositiveInteger('Expected a bounded positive integer');
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed > maximum) throw new InvalidPositiveInteger('Integer exceeds allowed range');
    return parsed;
}
