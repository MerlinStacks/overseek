export function getAdsAccountIdOrReply(request: any, reply: any): string | null {
    const accountId = request.accountId;
    if (!accountId) {
        reply.code(400).send({ error: 'No account selected' });
        return null;
    }
    return accountId;
}

export function parsePositiveInt(value: string | undefined, fallback: number): number {
    const parsed = Number.parseInt(value || String(fallback), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
