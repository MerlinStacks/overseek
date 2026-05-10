export function getEmailAccountIdOrReply(request: any, reply: any): string | null {
    const accountId = request.accountId;
    if (!accountId) {
        reply.code(400).send({ error: 'No account selected' });
        return null;
    }
    return accountId;
}

export function parseBodyOrReply<T>(
    reply: any,
    parsed: { success: boolean; data?: T; error?: any },
): T | null {
    if (!parsed.success) {
        reply.code(400).send({ error: 'Invalid input', issues: parsed.error?.flatten?.() });
        return null;
    }
    return parsed.data as T;
}
