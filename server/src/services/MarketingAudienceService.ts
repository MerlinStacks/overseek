import { prisma } from '../utils/prisma';
import { SegmentService } from './SegmentService';

type Contact = { id: string; email: string | null; firstName?: string | null; lastName?: string | null; isSubscribed?: boolean };
type Audience = { accountId: string; segmentId: string | null; listId: string | null };
export type ExclusionReason = 'missing_email' | 'invalid_email' | 'unsubscribed' | 'suppressed' | 'unverified' | 'duplicate';

export function recipientExclusion(email: string | null, subscribed: boolean | undefined, status?: string, suppressed = false): ExclusionReason | null {
    if (!email?.trim()) return 'missing_email';
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return 'invalid_email';
    if (subscribed === false || status === 'UNSUBSCRIBED') return 'unsubscribed';
    if (suppressed || ['BOUNCED', 'COMPLAINT', 'SOFT_BOUNCED'].includes(status || '')) return 'suppressed';
    if (status === 'UNVERIFIED' && subscribed !== true) return 'unverified';
    return null;
}

export class MarketingAudienceService {
    async deliveryExclusion(accountId: string, email: string, listId?: string) {
        const membership = listId ? await prisma.emailListMember.findFirst({ where: { accountId, listId, email: { equals: email.trim(), mode: 'insensitive' } }, select: { isSubscribed: true } }) : null;
        const [reason] = await this.exclusions(accountId, [{ id: 'delivery', email, ...(listId ? { isSubscribed: membership?.isSubscribed ?? false } : {}) }]);
        return reason;
    }

    async *batches(audience: Audience, size = 500): AsyncGenerator<Contact[]> {
        const { accountId, listId, segmentId } = audience;
        if (listId) {
            if (!await prisma.emailList.findFirst({ where: { accountId, id: listId }, select: { id: true } })) throw new Error('Audience list not found');
            let cursor: string | undefined;
            while (true) {
                const rows = await prisma.emailListMember.findMany({ where: { accountId, listId }, select: { id: true, email: true, isSubscribed: true }, orderBy: { id: 'asc' }, take: size, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
                if (!rows.length) break;
                yield rows;
                if (rows.length < size) break;
                cursor = rows[rows.length - 1].id;
            }
        } else if (segmentId) {
            if (!await prisma.customerSegment.findFirst({ where: { accountId, id: segmentId }, select: { id: true } })) throw new Error('Audience segment not found');
            for await (const rows of new SegmentService().iterateCustomersInSegment(accountId, segmentId, size)) yield rows;
        } else {
            let cursor: string | undefined;
            while (true) {
                const rows = await prisma.wooCustomer.findMany({ where: { accountId }, select: { id: true, email: true, firstName: true, lastName: true }, orderBy: { id: 'asc' }, take: size, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
                if (!rows.length) break;
                yield rows;
                if (rows.length < size) break;
                cursor = rows[rows.length - 1].id;
            }
        }
    }

    async exclusions(accountId: string, contacts: Contact[]) {
        const emails = [...new Set(contacts.map(row => row.email?.trim().toLowerCase()).filter((email): email is string => !!email))];
        const [suppressions, customers] = await Promise.all([
            prisma.emailUnsubscribe.findMany({ where: { accountId, email: { in: emails, mode: 'insensitive' }, scope: { in: ['ALL', 'MARKETING'] } }, select: { email: true } }),
            prisma.wooCustomer.findMany({ where: { accountId, email: { in: emails, mode: 'insensitive' } }, select: { email: true, rawData: true } }),
        ]);
        const suppressed = new Set(suppressions.map(row => row.email.trim().toLowerCase()));
        const statuses = new Map<string, string>();
        const priority: Record<string, number> = { UNVERIFIED: 1, UNSUBSCRIBED: 2, SOFT_BOUNCED: 3, BOUNCED: 4, COMPLAINT: 5 };
        for (const customer of customers) {
            const key = customer.email?.trim().toLowerCase();
            const status = String((customer.rawData as any)?.contactStatus || '').toUpperCase();
            if (key && (!statuses.has(key) || (priority[status] || 0) > (priority[statuses.get(key)!] || 0))) statuses.set(key, status);
        }
        return contacts.map(contact => recipientExclusion(contact.email, contact.isSubscribed, statuses.get(contact.email?.trim().toLowerCase() || ''), suppressed.has(contact.email?.trim().toLowerCase() || '')));
    }

    async explain(accountId: string, campaignId: string) {
        const campaign = await prisma.marketingCampaign.findFirst({ where: { accountId, id: campaignId } });
        if (!campaign) return null;
        const excluded: Record<ExclusionReason, number> = { missing_email: 0, invalid_email: 0, unsubscribed: 0, suppressed: 0, unverified: 0, duplicate: 0 };
        const seen = new Set<string>();
        let matched = 0, eligible = 0, complete = true;
        for await (const rows of this.batches(campaign)) {
            if (matched + rows.length > 10000) { complete = false; break; }
            const reasons = await this.exclusions(accountId, rows);
            rows.forEach((row, index) => {
                matched++;
                const key = row.email?.trim().toLowerCase() || '';
                const reason = reasons[index] || (seen.has(key) ? 'duplicate' : null);
                seen.add(key);
                if (reason) excluded[reason]++; else eligible++;
            });
        }
        return { matched, eligible, excluded, complete, checkedAt: new Date(), note: 'Eligibility is rechecked at send time. Missing legacy consent classifications are not proof of consent. Frequency caps are checked at delivery, not included in this preview.' };
    }
}
