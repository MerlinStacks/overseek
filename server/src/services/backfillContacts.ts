import { materializeContact } from './ContactMaterialization';
import { queueContactProjection } from './ContactProjection';
import { updateCustomerTotals, withOrderTotalsTransaction } from './sync/orderCustomerTotals';

export type ContactBackfillSource = 'orders' | 'enrollments';

/** One atomic, bounded page. Only advance the externally stored cursor after this resolves. */
export async function backfillContactPage(accountId: string, source: ContactBackfillSource, after?: string, limit = 100) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error('Batch size must be between 1 and 500');
    return withOrderTotalsTransaction(accountId, async tx => {
        const where = { accountId, ...(after ? { id: { gt: after } } : {}) };
        const contacts: string[] = [];
        let cursor = after;
        let count = 0;
        if (source === 'orders') {
            const rows = await tx.wooOrder.findMany({ where, orderBy: { id: 'asc' }, take: limit,
                select: { id: true, wooId: true, wooCustomerId: true, billingEmail: true, rawData: true } });
            for (const row of rows) {
                const raw = row.rawData as any;
                const contact = await materializeContact(tx, accountId, {
                    source: 'ORDER', sourceKey: `order:${row.wooId}`, wooCustomerId: row.wooCustomerId,
                    email: row.billingEmail, firstName: raw?.billing?.first_name, lastName: raw?.billing?.last_name
                });
                contacts.push(contact.id);
            }
            count = rows.length;
            cursor = rows.at(-1)?.id ?? after;
        } else {
            const rows = await tx.automationEnrollment.findMany({ where, orderBy: { id: 'asc' }, take: limit,
                select: { id: true, email: true, wooCustomerId: true } });
            for (const row of rows) {
                const contact = await materializeContact(tx, accountId, {
                    source: 'AUTOMATION', email: row.email, wooCustomerId: row.wooCustomerId,
                    sourceKey: `enrollment:${row.id}`
                });
                contacts.push(contact.id);
            }
            count = rows.length;
            cursor = rows.at(-1)?.id ?? after;
        }
        await updateCustomerTotals(tx, accountId, [], contacts);
        await queueContactProjection(tx, accountId, contacts);
        return { cursor, count, done: count < limit };
    });
}
