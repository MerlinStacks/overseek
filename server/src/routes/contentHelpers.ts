export function buildContentLookupWhere(id: string, accountId: string) {
    if (/^\d+$/.test(id)) {
        const wooId = Number.parseInt(id, 10);
        return {
            accountId,
            OR: [{ id }, { wooId }],
        };
    }

    return { id, accountId };
}
