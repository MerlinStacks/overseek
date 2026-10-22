export function buildContentLookupWhere(id: string, accountId: string) {
    if (typeof accountId !== 'string' || !accountId.trim() || accountId.length > 200 || typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(id)) throw Object.assign(new Error('Invalid content identifier'), { statusCode: 400 });
    if (/^-\d+$/.test(id) || /^\d+$/.test(id) && (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id)) || Number(id) > 2147483647)) throw Object.assign(new Error('Invalid numeric content identifier'), { statusCode: 400 });
    return { id, accountId };
}
/** Internal identity takes precedence; no unordered OR may choose the target of an external write. */
export async function findContentById<T>(id: string, accountId: string, find: (where: { accountId: string; id?: string; wooId?: number }) => Promise<T | null>): Promise<T | null> {
    const internal = await find(buildContentLookupWhere(id, accountId));
    if (internal || !/^\d+$/.test(id)) return internal;
    return find({ accountId, wooId: Number(id) });
}
