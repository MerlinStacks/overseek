export type ContactStatus = 'UNVERIFIED' | 'SUBSCRIBED' | 'BOUNCED' | 'UNSUBSCRIBED' | 'SOFT_BOUNCED' | 'COMPLAINT';

export interface ContactSuppression {
    scope: string;
    contactStatus?: string | null;
}

export function normalizeContactStatus(value: unknown, fallback: ContactStatus = 'UNVERIFIED'): ContactStatus {
    const status = String(value || '').trim().toUpperCase();
    switch (status) {
        case 'UNVERIFIED': case 'SUBSCRIBED': case 'BOUNCED':
        case 'UNSUBSCRIBED': case 'SOFT_BOUNCED': case 'COMPLAINT':
            return status;
        default: return fallback;
    }
}

/** Scope controls suppression, not its cause. Never infer a complaint from ALL. */
export function resolveContactStatus(
    rawStatus: unknown,
    suppression?: ContactSuppression | null,
    fallback: ContactStatus = 'UNVERIFIED'
): ContactStatus {
    const persisted = normalizeContactStatus(rawStatus, fallback);
    if (!suppression || !['ALL', 'MARKETING'].includes(suppression.scope)) return persisted;
    const explicit = normalizeContactStatus(suppression.contactStatus, 'SUBSCRIBED');
    if (explicit !== 'SUBSCRIBED') return explicit;
    // Legacy records may predate classification. Preserve explicit delivery failures,
    // but an unknown suppression is an opt-out, not evidence of a spam report.
    if (['COMPLAINT', 'BOUNCED', 'SOFT_BOUNCED'].includes(persisted)) return persisted;
    return 'UNSUBSCRIBED';
}

export function strongestContactSuppression<T extends ContactSuppression>(rows: T[]): T | undefined {
    const statusPriority: Record<string, number> = { COMPLAINT: 3, BOUNCED: 2, SOFT_BOUNCED: 1 };
    const priority = (row: T) => (row.scope === 'ALL' ? 10 : 0)
        + (statusPriority[row.contactStatus || ''] || 0);
    return rows.filter(row => row.scope === 'ALL' || row.scope === 'MARKETING')
        .reduce<T | undefined>((best, row) => !best || priority(row) > priority(best) ? row : best, undefined);
}
