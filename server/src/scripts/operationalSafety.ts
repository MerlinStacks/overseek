/** Import-safe CLI parsing. No clients are constructed here. */
export interface OperationalOptions { apply: boolean; all: boolean; accountId?: string; userId?: string; before: Date; limit: number; batchSize: number; confirmation?: string }
export function safeDestination(value: string | undefined): string {
    if (!value) return 'unconfigured';
    try { const url = new URL(value); return ['postgres:', 'postgresql:', 'http:', 'https:'].includes(url.protocol) && url.host ? `${url.host}${url.pathname}` : 'invalid'; } catch { return 'invalid'; }
}
export function operationalOptions(task: string, args: string[], env: NodeJS.ProcessEnv = process.env, now = new Date()): OperationalOptions {
    const values = new Map<string, string>();
    for (const argument of args) {
        const match = /^--(account|user|before|limit|batch-size|confirm)=(.+)$/.exec(argument);
        const key = match ? match[1] : argument === '--all' ? 'all' : argument === '--apply' ? 'apply' : argument === '--dry-run' ? 'dry-run' : '';
        if (!key || values.has(key)) throw new Error('Unknown or duplicate option. Use --help.');
        values.set(key, match ? match[2] : 'true');
    }
    const accountId = values.get('account'); const userId = values.get('user'); const all = values.has('all');
    if (Number(!!accountId) + Number(!!userId) + Number(all) !== 1 || (task === 'revoke-all-sessions' ? !!accountId : !!userId)) throw new Error('Choose exactly one permitted scope: --account=ID or --all; session revocation uses --user=ID or --all.');
    if ([accountId, userId].some(value => value && !/^[a-zA-Z0-9_-]{1,128}$/.test(value))) throw new Error('Invalid scope ID');
    const number = (key: string, fallback: number, max: number) => { const value = values.get(key); if (value === undefined) return fallback; if (!/^[1-9]\d*$/.test(value) || Number(value) > max) throw new Error(`Invalid --${key}`); return Number(value); };
    const beforeValue = values.get('before'); const before = beforeValue ? new Date(beforeValue) : new Date(now);
    if (beforeValue && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(beforeValue) || !Number.isFinite(before.getTime()) || before > now || beforeValue && before.toISOString() !== (beforeValue.includes('.') ? beforeValue : beforeValue.replace('Z', '.000Z'))) throw new Error('Cutoff must be a valid UTC timestamp at or before now');
    const apply = values.has('apply');
    if (apply && values.has('dry-run')) throw new Error('Choose --apply or --dry-run, not both');
    const destination = safeDestination(env.DATABASE_URL);
    if (['invalid', 'unconfigured'].includes(destination) || !/^postgres(?:ql)?:\/\//.test(env.DATABASE_URL || '')) throw new Error('A valid explicit DATABASE_URL is required, including for dry-run');
    const scope = all ? 'ALL' : accountId ? `account:${accountId}` : `user:${userId}`;
    const expected = `${task}:${scope}:${destination}`;
    if (apply && (['invalid', 'unconfigured'].includes(destination) || values.get('confirm') !== expected)) throw new Error(`Apply requires --confirm=${expected}`);
    if (task === 'deep-diagnostic' && apply) throw new Error('Diagnostics are read-only; --apply is not supported');
    return { apply, all, accountId, userId, before, limit: number('limit', 10000, 1000000), batchSize: number('batch-size', 50, 500), confirmation: values.get('confirm') };
}
export function usage(task: string) { return `${task}: --account=ID|--all (sessions: --user=ID|--all), optional --before=UTC_TIMESTAMP --limit=N --batch-size=N. Dry-run is the default. Writes require --apply --confirm=${task}:SCOPE:DB_HOST/DB_NAME. Scope is ALL, account:ID or user:ID. Reindexing never deletes shared indices.`; }
export function assertSearchConfirmation(task: string, options: OperationalOptions, env = process.env) {
    const destination = safeDestination(env.ELASTICSEARCH_URL || 'http://localhost:9200');
    // The database confirmation is mandatory; require the search destination separately for writes.
    if (options.apply && (destination === 'invalid' || env.OPERATIONAL_SEARCH_CONFIRM !== `${task}:${destination}`)) throw new Error(`Search writes require OPERATIONAL_SEARCH_CONFIRM=${task}:${destination}`);
}
export async function closeOperationalResources(resources: Array<() => Promise<unknown>>) {
    const results = await Promise.allSettled(resources.map(close => Promise.resolve().then(close)));
    if (results.some(result => result.status === 'rejected')) throw new Error('Operational resource cleanup failed');
}
