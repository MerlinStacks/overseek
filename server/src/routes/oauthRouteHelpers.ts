export function getOauthAccountIdOrReply(request: any, reply: any): string | null {
    const accountId = request.accountId;
    if (!accountId) {
        reply.code(400).send({ error: 'No account selected' });
        return null;
    }
    return accountId;
}
