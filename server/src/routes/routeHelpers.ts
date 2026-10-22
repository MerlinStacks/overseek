import { z } from 'zod';
import { ValidationError } from '../utils/errors';

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

const condition = z.object({ field: z.enum(['Name', 'Email', 'Contact Status', 'Total Spent', 'Orders']), operator: z.enum(['is', 'is not', 'contains', 'greater than', 'less than']), value: z.union([z.string().trim().min(1).max(1000), z.number().finite(), z.boolean()]).transform(value => String(value)) }).strict().superRefine((value, ctx) => {
    const numeric = ['Total Spent', 'Orders'].includes(value.field);
    if (numeric && (value.operator === 'contains' || !/^\d+(?:\.\d+)?$/.test(value.value) || !Number.isFinite(Number(value.value)) || Number(value.value) > 1e12 || value.field === 'Orders' && !Number.isSafeInteger(Number(value.value))) || !numeric && ['greater than', 'less than'].includes(value.operator) || value.field === 'Contact Status' && (!['UNVERIFIED', 'SUBSCRIBED', 'BOUNCED', 'UNSUBSCRIBED', 'SOFT_BOUNCED', 'COMPLAINT', 'BLOCKED'].includes(value.value.toUpperCase()) || value.operator === 'contains')) ctx.addIssue({ code: 'custom', message: 'Unsupported field/operator/value' });
});
const filtersSchema = z.array(z.object({ combinator: z.enum(['AND', 'OR']), conditions: z.array(condition).min(1).max(20) }).strict()).max(10);
export function parseAdvancedFilters(rawFilters?: string): ParsedFilterGroup[] {
    if (rawFilters === undefined) return [];
    if (typeof rawFilters !== 'string' || rawFilters.length > 20000 || !rawFilters.trim()) throw new ValidationError('Invalid filters');
    try { return filtersSchema.parse(JSON.parse(rawFilters)).map(group => ({ ...group, conditions: group.conditions.map(row => ({ ...row, value: z.string().parse(row.value) })) })); }
    catch { throw new ValidationError('Invalid filters: use supported fields/operators and bounded nonempty groups'); }
}
