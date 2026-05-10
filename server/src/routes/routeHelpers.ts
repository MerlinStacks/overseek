export function getRouteAccountIdOrReply(request: any, reply: any): string | null {
    const accountId = request.accountId;
    if (!accountId) {
        reply.code(400).send({ error: 'Account context required' });
        return null;
    }
    return accountId;
}

export function getUserAccountIdOrReply(request: any, reply: any): string | null {
    const accountId = request.user?.accountId;
    if (!accountId) {
        reply.code(400).send({ error: 'Account context required' });
        return null;
    }
    return accountId;
}

export function parseFirstIssueOrReply<T>(reply: any, parsed: any): T | null {
    if (!parsed.success) {
        const issueMessage = parsed.error?.issues?.[0]?.message;
        reply.code(400).send({ error: issueMessage || parsed.error?.message || 'Invalid input' });
        return null;
    }
    return parsed.data as T;
}
