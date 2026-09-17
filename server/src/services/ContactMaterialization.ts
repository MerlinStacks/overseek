import type { Prisma } from '@prisma/client';
import { queueContactKeys } from './ContactProjection';

export interface ContactIdentity {
    wooCustomerId?: number | null;
    email?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    source: 'ORDER' | 'AUTOMATION' | 'INBOX_EMAIL' | 'WOO_CUSTOMER';
    /** Stable order identity for the rare guest order without an email. */
    sourceKey?: string;
    remoteData?: Prisma.InputJsonObject;
}

const object = (value: unknown): Prisma.InputJsonObject =>
    value && typeof value === 'object' && !Array.isArray(value) ? value as Prisma.InputJsonObject : {};

/** All contact creators share this lock with order mutations. It must be the first lock taken. */
export async function lockContactAccount(tx: Prisma.TransactionClient, accountId: string) {
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${`order-totals:${accountId}`}, 0))`;
}

/** Caller owns the transaction. Never infer consent from a purchase or an enrollment. */
export async function materializeContact(tx: Prisma.TransactionClient, accountId: string, input: ContactIdentity) {
    await lockContactAccount(tx, accountId);
    const email = input.email?.trim().toLowerCase() || '';
    const wooId = Number.isInteger(input.wooCustomerId) && input.wooCustomerId! > 0 ? input.wooCustomerId! : null;
    if (!wooId && !email && !input.sourceKey) throw new Error('Contact requires a Woo ID, email or stable source key');
    let customer = wooId ? await tx.wooCustomer.findUnique({
        where: { accountId_wooId: { accountId, wooId } }
    }) : null;
    if (!customer && email) {
        // Email is not unique: never repurpose a different registered Woo identity.
        const registered = await tx.wooCustomer.findFirst({
            where: { accountId, email: { equals: email, mode: 'insensitive' }, wooId: { gt: 0 } },
            orderBy: [{ wooId: 'asc' }, { id: 'asc' }]
        });
        if (!wooId) customer = registered;
        if (!customer && !registered) customer = await tx.wooCustomer.findFirst({
            where: { accountId, email: { equals: email, mode: 'insensitive' }, wooId: { lt: 0 } },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
        });
    }
    if (!customer && input.sourceKey) customer = await tx.wooCustomer.findFirst({
        where: { accountId, wooId: { lt: 0 }, email: '', rawData: { path: ['materializationKey'], equals: input.sourceKey } }
    });

    if (customer) {
        // Profile/status editors do not all use the account advisory lock. Lock and reread
        // JSON before a remote merge; purchase/enrollment paths never rewrite it at all.
        const latest = input.remoteData ? await tx.$queryRaw<{ rawData: Prisma.JsonValue }[]>`
            SELECT "rawData" FROM "WooCustomer" WHERE "accountId" = ${accountId} AND "id" = ${customer.id} FOR UPDATE
        ` : null;
        const oldRaw = object(latest?.[0]?.rawData ?? customer.rawData);
        // Remote fields may refresh, but all local metadata (including future consent fields) wins.
        // Only the explicit Woo profile fields below are authoritative remotely.
        const rawData = input.remoteData ? { ...input.remoteData, ...oldRaw,
            ...Object.fromEntries(['billing', 'shipping', 'avatar_url', 'username']
                .filter(key => input.remoteData![key] !== undefined).map(key => [key, input.remoteData![key]]))
        } : oldRaw;
        if (wooId && customer.wooId < 0) {
            // The old key is a durable tombstone only if this promotion commits. The
            // projector rechecks the key in case another contact later reuses it.
            await queueContactKeys(tx, accountId, [customer.wooId]);
        }
        return tx.wooCustomer.update({
            where: { id: customer.id, accountId },
            data: {
                ...(wooId ? { wooId } : {}),
                // Billing/enrollment addresses must not overwrite a known customer's canonical email.
                ...(input.source === 'WOO_CUSTOMER' || !customer.email ? { email } : {}),
                ...(input.source === 'WOO_CUSTOMER'
                    ? { firstName: input.firstName, lastName: input.lastName }
                    : {
                        ...(!customer.firstName && input.firstName ? { firstName: input.firstName } : {}),
                        ...(!customer.lastName && input.lastName ? { lastName: input.lastName } : {})
                    }),
                ...(input.remoteData ? { rawData } : {})
            }
        });
    }
    const min = wooId ? null : await tx.wooCustomer.aggregate({ where: { accountId, wooId: { lt: 0 } }, _min: { wooId: true } });
    return tx.wooCustomer.create({ data: {
        accountId, wooId: wooId ?? (min!._min.wooId ?? 0) - 1, email,
        firstName: input.firstName, lastName: input.lastName, totalSpent: 0, ordersCount: 0,
        rawData: { ...input.remoteData, source: input.source, contactStatus: 'UNVERIFIED', marketingSubscribed: false,
            ...(!wooId && !email && input.sourceKey ? { materializationKey: input.sourceKey } : {}) }
    } });
}
