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

export interface ParsedFilterCondition {
    field: string;
    operator: string;
    value: string;
}

export interface ParsedFilterGroup {
    combinator: 'AND' | 'OR';
    conditions: ParsedFilterCondition[];
}

export function parseAdvancedFilters(rawFilters?: string): ParsedFilterGroup[] {
    if (!rawFilters) return [];

    try {
        const raw = JSON.parse(rawFilters) as unknown;
        if (!Array.isArray(raw)) return [];

        return raw
            .map<ParsedFilterGroup>((group) => {
                const g = group as { combinator?: string; conditions?: unknown };
                const conditions = Array.isArray(g.conditions) ? g.conditions : [];
                return {
                    combinator: g.combinator === 'OR' ? 'OR' : 'AND',
                    conditions: conditions
                        .map((condition) => condition as { field?: unknown; operator?: unknown; value?: unknown })
                        .map<ParsedFilterCondition>((condition) => ({
                            field: String(condition.field || ''),
                            operator: String(condition.operator || ''),
                            value: String(condition.value || '')
                        }))
                        .filter((condition) => condition.field.length > 0)
                };
            })
            .filter((group) => group.conditions.length > 0);
    } catch {
        return [];
    }
}
