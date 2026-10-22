/** Offline review plan. Importing this module never connects or writes.
 * CLI: --account=ID --database=HOST/DATABASE [--after=REVIEW_ID] [--limit=100]
 * Application is deliberately a separate API requiring the exact reviewed plan.
 */
import crypto from 'node:crypto';
import { z } from 'zod';
import type { PrismaClient, Prisma } from '@prisma/client';
import { createPrismaClient } from '../utils/prisma';

const id = z.string().trim().min(1).max(200);
const optionsSchema = z.object({ accountId: id, database: id, after: id.optional(), limit: z.number().int().min(1).max(200).default(100) }).strict();
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const email = (value: unknown) => { const parsed = z.string().trim().email().max(320).safeParse(value); return parsed.success ? parsed.data.toLowerCase() : null; };
const fingerprint = (value: unknown) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
function assertDatabase(expected: string) {
    const url = new URL(process.env.DATABASE_URL || '');
    if (`${url.host}${url.pathname}` !== expected) throw new Error('Explicit database destination does not match DATABASE_URL');
}
export async function planReviewRematches(db: PrismaClient, input: z.input<typeof optionsSchema>) {
    const options = optionsSchema.parse(input); assertDatabase(options.database);
    const rows = await db.wooReview.findMany({ where: { accountId: options.accountId, ...(options.after ? { id: { gt: options.after } } : {}) }, orderBy: { id: 'asc' }, take: options.limit + 1 });
    const items = [];
    for (const review of rows.slice(0, options.limit)) {
        const base = { reviewId: review.id, version: review.updatedAt.toISOString(), orderId: null as string | null, orderVersion: null as string | null, evidence: fingerprint(review), reason: 'unavailable-strong-identity' };
        if (review.wooOrderId || review.matchStatus === 'matched') { items.push({ ...base, reason: 'preserved-existing-link' }); continue; }
        // Exact non-guest customer identity PLUS exact email PLUS purchased product; no names,
        // plus-address rewriting, product-only proximity or closest-date tie breaking.
        const customer = review.wooCustomerId ? await db.wooCustomer.findFirst({ where: { id: review.wooCustomerId, accountId: options.accountId } }) : null;
        const address = email(review.reviewerEmail);
        if (!customer || customer.wooId <= 0 || !address || email(customer.email) !== address) { items.push(base); continue; }
        const orders = await db.wooOrder.findMany({ where: { accountId: options.accountId, dateCreated: { gte: new Date(review.dateCreated.getTime() - 180 * 86400000), lte: review.dateCreated }, rawData: { path: ['customer_id'], equals: customer.wooId } }, orderBy: [{ dateCreated: 'asc' }, { id: 'asc' }], take: 501 });
        if (orders.length > 500) { items.push({ ...base, reason: 'candidate-limit-exceeded' }); continue; }
        const candidates = orders.filter(order => {
            const raw = object(order.rawData);
            return ['completed', 'processing'].includes(order.status) && email(object(raw.billing).email) === address && Array.isArray(raw.line_items) && raw.line_items.some(item => { const line = object(item); return line.product_id === review.productId || line.variation_id === review.productId; });
        });
        items.push(candidates.length === 1 ? { ...base, orderId: candidates[0].id, orderVersion: candidates[0].updatedAt.toISOString(), reason: 'unique-customer-email-product' } : { ...base, reason: candidates.length ? 'ambiguous-preserved' : 'no-match-preserved' });
    }
    const plan = { accountId: options.accountId, database: options.database, after: options.after, limit: options.limit, nextCursor: rows.length > options.limit ? rows[options.limit - 1].id : null, items };
    return { ...plan, digest: fingerprint(plan) };
}
export async function applyReviewRematchPlan(db: PrismaClient, approved: Awaited<ReturnType<typeof planReviewRematches>>, approvedDigest: string) {
    assertDatabase(approved.database);
    const { digest, ...contents } = approved;
    if (!/^[a-f0-9]{64}$/.test(approvedDigest) || digest !== approvedDigest || fingerprint(contents) !== approvedDigest) throw new Error('Approved plan digest does not match its contents');
    // Re-plan in a serializable transaction. Changed candidates/customer/review inputs cannot
    // be applied merely because an old proposed order ID still exists.
    return db.$transaction(async tx => {
        const claimId = fingerprint(['review-rematch-application', approved.accountId, approved.database, approvedDigest]);
        await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${claimId}, 0))`;
        const prior = await tx.scopedOperation.findUnique({ where: { id: claimId } });
        if (prior) return z.object({ digest: z.string(), results: z.array(z.object({ reviewId: z.string(), orderId: z.string(), applied: z.literal(true) })) }).parse(prior.result);
        const fresh = await planReviewRematches(tx as PrismaClient, { accountId: approved.accountId, database: approved.database, after: approved.after, limit: approved.limit });
        if (approvedDigest !== approved.digest || fresh.digest !== approvedDigest) throw new Error('Plan changed; review a new dry-run');
        const results = [];
        for (const item of fresh.items.filter(row => row.orderId)) {
            const result = await tx.wooReview.updateMany({ where: { id: item.reviewId, accountId: fresh.accountId, updatedAt: new Date(item.version), wooOrderId: null, order: { is: null } }, data: { wooOrderId: item.orderId, matchStatus: 'matched', updatedAt: new Date(Math.max(Date.now(), Date.parse(item.version) + 1)) } });
            if (result.count !== 1) throw new Error('Review changed; transaction rolled back');
            results.push({ reviewId: item.reviewId, orderId: item.orderId, applied: true });
        }
        const result = { digest: fresh.digest, results };
        await tx.scopedOperation.create({ data: { id: claimId, accountId: fresh.accountId, kind: 'review-rematch-application', result } });
        return result;
    }, { isolationLevel: 'Serializable' as Prisma.TransactionIsolationLevel, timeout: 30000 });
}
async function main() {
    const args = z.object({ account: id, database: id, after: id.optional(), limit: z.string().regex(/^[1-9]\d*$/).optional() }).strict().parse(Object.fromEntries(process.argv.slice(2).map(arg => { const match = /^--([^=]+)=(.+)$/.exec(arg); if (!match) throw new Error('Use explicit --key=value options; dry-run only'); return [match[1], match[2]]; })));
    assertDatabase(args.database);
    const db = createPrismaClient();
    try { console.log(JSON.stringify(await planReviewRematches(db, { accountId: args.account, database: args.database, after: args.after, limit: args.limit ? Number(args.limit) : 100 }), null, 2)); }
    finally { await db.$disconnect(); }
}
if (require.main === module) void main().catch(() => { console.error('Review planning failed; no changes applied. Check explicit scope/destination.'); process.exitCode = 1; });
