import { prisma } from '../../utils/prisma';
import { getDefaultEmailAccount } from '../../utils/getDefaultEmailAccount';
import { EmailService } from '../EmailService';
import { Logger } from '../../utils/logger';

const SOURCE = 'WHOLESALE_CATALOG_VALIDITY_REMINDER';

function localDate(value: Date, timezone: string) {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' })
        .formatToParts(value).filter(part => part.type !== 'literal');
    const values = Object.fromEntries(parts.map(part => [part.type, Number(part.value)]));
    return Date.UTC(values.year, values.month - 1, values.day);
}

export function isValidityReminderDue(validUntil: Date, now: Date, timezone: string) {
    return (localDate(validUntil, timezone) - localDate(now, timezone)) / (24 * 60 * 60 * 1000) === 2;
}

export async function sendWholesaleValidityReminders(now = new Date()) {
    const generations = await (prisma as any).wholesaleCatalogGeneration.findMany({
        where: { status: 'APPROVED', staleAt: null, validUntil: { gt: now, lte: new Date(now.getTime() + 4 * 24 * 60 * 60 * 1000) } },
        include: { account: { select: { timezone: true } }, requestedBy: { select: { email: true, fullName: true } } },
    });
    let sent = 0;
    for (const generation of generations) {
        const timezone = generation.account?.timezone || 'UTC';
        if (!isValidityReminderDue(generation.validUntil, now, timezone)) continue;
        const dedupeId = `${generation.id}:r${generation.validityRevision}`;
        const link = `/wholesale-catalog/${generation.catalogId}?validityReminder=${encodeURIComponent(dedupeId)}`;
        const existingNotification = await (prisma as any).notification.findFirst({ where: { accountId: generation.accountId, link } });
        if (!existingNotification) {
            await (prisma as any).notification.create({ data: {
                accountId: generation.accountId, title: 'Wholesale catalog validity expires in two days',
                message: 'Review, extend or replace this approved wholesale catalog before its validity ends.', type: 'WARNING', link,
            } });
        }
        const existingEmail = await (prisma as any).emailLog.findFirst({ where: { accountId: generation.accountId, source: SOURCE, sourceId: dedupeId } });
        if (!existingEmail && generation.requestedBy?.email) {
            const emailAccount = await getDefaultEmailAccount(generation.accountId);
            if (emailAccount) {
                const subject = 'Wholesale catalog validity expires in two days';
                const greeting = generation.requestedBy.fullName ? `Hi ${generation.requestedBy.fullName},` : 'Hello,';
                const html = `<p>${greeting}</p><p>Your approved wholesale catalog expires in two days. Review, extend or replace it before its validity ends.</p>`;
                try {
                    await new EmailService().sendEmail(generation.accountId, emailAccount.id, generation.requestedBy.email, subject, html, undefined, { source: SOURCE, sourceId: dedupeId, category: 'TRANSACTIONAL' });
                } catch (error) { Logger.warn('[WholesaleValidityReminder] Email failed', { generationId: generation.id, error }); }
            }
        }
        if (!existingNotification || !existingEmail) sent++;
    }
    return { processed: generations.length, sent };
}
