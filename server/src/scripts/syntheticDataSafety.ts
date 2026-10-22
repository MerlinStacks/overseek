import crypto from 'node:crypto';
import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
const uuid = z.string().uuid();
const schema = z.object({ accountId: uuid, database: z.string().min(1).max(300), userId: uuid.optional(), email: z.string().email().max(200).optional(), at: z.string().datetime().optional(), products: z.number().int().min(1).max(200).default(12), customers: z.number().int().min(1).max(200).default(8), orders: z.number().int().min(0).max(200).default(20) }).strict();
export type SyntheticOptions = z.input<typeof schema>;
type Task = 'setup' | 'seed' | 'reset';
const hash = (value: unknown) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const marker = (accountId: string) => `overseek-synthetic-v1:${accountId}`;
function destination(expected: string) {
    const url = new URL(process.env.DATABASE_URL || '');
    if (!['development', 'test'].includes(process.env.NODE_ENV || '') || !['postgres:', 'postgresql:'].includes(url.protocol) || `${url.host}${url.pathname}` !== expected || !/(?:^|[_-])(test|dev|mock)(?:[_-]|$)/i.test(url.pathname.slice(1))) throw new Error('Explicit development/test database destination required');
}
async function assertSynthetic(db: PrismaClient, accountId: string) {
    const [claim, account] = await Promise.all([db.scopedOperation.findUnique({ where: { id: marker(accountId) } }), db.account.findUnique({ where: { id: accountId } })]);
    const proof = object(claim?.result);
    if (!claim || claim.accountId !== accountId || claim.kind !== 'synthetic-account' || proof.marker !== marker(accountId) || !account || account.domain !== `mock-${accountId}.invalid` || account.wooUrl !== '' || account.wooConsumerKey !== '' || account.wooConsumerSecret !== '' || account.autoSendInvoiceOnNewOrder || !account.wooNeedsReconnect) throw new Error('Refusing to adopt a non-synthetic or connected account');
    const memberships = await db.accountUser.findMany({ where: { accountId }, take: 2, select: { userId: true, role: true } });
    if (memberships.length !== 1 || memberships[0].userId !== proof.userId || memberships[0].role !== 'OWNER') throw new Error('Synthetic membership changed; review manually');
    return hash([proof, account.updatedAt]);
}
function rowId(accountId: string, kind: string, index: number) {
    const value = hash([accountId, kind, index]); return `${value.slice(0, 8)}-${value.slice(8, 12)}-4${value.slice(13, 16)}-a${value.slice(17, 20)}-${value.slice(20, 32)}`;
}
export async function planSyntheticData(task: Task, db: PrismaClient, input: SyntheticOptions) {
    z.enum(['setup', 'seed', 'reset']).parse(task);
    const options = schema.parse(input); destination(options.database);
    if (task === 'setup') {
        if (!options.userId || !options.email?.endsWith('@example.invalid')) throw new Error('New UUID user and synthetic @example.invalid email required');
        if (await db.account.findUnique({ where: { id: options.accountId } }) || await db.user.findFirst({ where: { OR: [{ id: options.userId }, { email: options.email }] } })) throw new Error('Refusing to adopt an existing account or user');
        const contents = { task, options, proof: 'new-isolated-synthetic-account', records: [] as Array<{ kind: string; id: string; version: string; fingerprint: string }> };
        return { ...contents, digest: hash(contents) };
    }
    const proof = await assertSynthetic(db, options.accountId);
    const [products, customers, orders] = await Promise.all([
        db.wooProduct.findMany({ where: { accountId: options.accountId }, orderBy: { id: 'asc' }, take: 201, include: { _count: true } }),
        db.wooCustomer.findMany({ where: { accountId: options.accountId }, orderBy: { id: 'asc' }, take: 201, include: { _count: true } }),
        db.wooOrder.findMany({ where: { accountId: options.accountId }, orderBy: { id: 'asc' }, take: 201 }),
    ]);
    if ([products, customers, orders].some(rows => rows.length > 200 || rows.some(row => object(row.rawData)._overseekSynthetic !== marker(options.accountId)))) throw new Error('Mixed/oversized account data; no reset or overwrite permitted');
    if ([...products, ...customers].some(row => !row._count || Object.values(row._count).some(value => value > 0))) throw new Error('Synthetic rows have dependent records; cascading cleanup is not permitted');
    if (task === 'seed' && (products.length || customers.length || orders.length)) throw new Error('Seed requires an empty synthetic dataset; no upsert/overwrite is allowed');
    if (task === 'seed' && (!options.at || Date.parse(options.at) > Date.now())) throw new Error('Seed requires an explicit nonfuture --at UTC timestamp');
    // Refuse destructive resets when fixtures have acquired real operational dependencies.
    const dependencies = await Promise.all([db.wooReview.count({ where: { accountId: options.accountId } }), db.conversation.count({ where: { accountId: options.accountId } }), db.invoiceArtifact.count({ where: { accountId: options.accountId } }), db.automationEnrollment.count({ where: { accountId: options.accountId } }), db.emailLog.count({ where: { accountId: options.accountId } }), db.bOM.count({ where: { product: { accountId: options.accountId } } })]);
    if (dependencies.some(value => value > 0)) throw new Error('Synthetic data has operational dependencies; reconcile explicitly instead of cascading deletion');
    const records = [...products.map(row => ({ kind: 'product', row })), ...customers.map(row => ({ kind: 'customer', row })), ...orders.map(row => ({ kind: 'order', row }))].map(({ kind, row }) => ({ kind, id: row.id, version: row.updatedAt.toISOString(), fingerprint: hash(row) }));
    const contents = { task, options, proof, records };
    return { ...contents, digest: hash(contents) };
}
export async function applySyntheticPlan(db: PrismaClient, plan: Awaited<ReturnType<typeof planSyntheticData>>, approvedDigest: string, password?: string) {
    z.enum(['setup', 'seed', 'reset']).parse(plan.task);
    schema.parse(plan.options);
    destination(plan.options.database);
    const { digest, ...contents } = plan;
    if (digest !== approvedDigest || hash(contents) !== digest) throw new Error('Approved plan contents changed');
    return db.$transaction(async tx => {
        const operationId = hash(['synthetic-operation', plan.task, plan.options.accountId, digest]);
        await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${marker(plan.options.accountId)}, 0))`;
        const receipt = await tx.scopedOperation.findUnique({ where: { id: operationId } });
        if (receipt) return receipt.result;
        const fresh = await planSyntheticData(plan.task as Task, tx as PrismaClient, plan.options);
        if (fresh.digest !== digest) throw new Error('Dataset changed; review a new dry-run plan');
        const { accountId } = plan.options;
        if (plan.task === 'setup') {
            if (!password || password.length < 20 || password.length > 200) throw new Error('Supply a new 20–200 character secret through MOCK_NEW_PASSWORD; it is never logged or returned');
            const argon2 = await import('argon2');
            const passwordHash = await argon2.hash(password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
            await tx.user.create({ data: { id: plan.options.userId!, email: plan.options.email!, fullName: 'Synthetic fixture owner', passwordHash, isSuperAdmin: false } });
            await tx.account.create({ data: { id: accountId, name: 'Synthetic fixtures (disconnected)', domain: `mock-${accountId}.invalid`, wooUrl: '', wooConsumerKey: '', wooConsumerSecret: '', wooNeedsReconnect: true, autoSendInvoiceOnNewOrder: false, users: { create: { userId: plan.options.userId!, role: 'OWNER' } } } });
            await tx.scopedOperation.create({ data: { id: marker(accountId), accountId, kind: 'synthetic-account', result: { marker: marker(accountId), userId: plan.options.userId!, email: plan.options.email! } } });
        } else if (plan.task === 'reset') {
            for (const kind of ['order', 'product', 'customer']) for (const row of plan.records.filter(value => value.kind === kind)) {
                const where = { id: row.id, accountId, updatedAt: new Date(row.version), rawData: { path: ['_overseekSynthetic'], equals: marker(accountId) } };
                const result = kind === 'order' ? await tx.wooOrder.deleteMany({ where }) : kind === 'product' ? await tx.wooProduct.deleteMany({ where }) : await tx.wooCustomer.deleteMany({ where });
                if (result.count !== 1) throw new Error('Fixture changed; reset rolled back');
            }
            // No automatic reseed, index deletion, inventory operation or event emission.
        } else {
            const at = new Date(plan.options.at!), totals = Array.from({ length: plan.options.customers }, () => ({ orders: 0, cents: 0 }));
            for (let index = 1; index <= plan.options.products; index++) {
                const price = ((1900 + index * 350) / 100).toFixed(2), wooId = 90000 + index;
                await tx.wooProduct.create({ data: { id: rowId(accountId, 'product', index), accountId, wooId, name: `Synthetic product ${index}`, sku: `SYNTH-${index}`, price, stockQuantity: 10, manageStock: true, stockStatus: 'instock', rawData: { _overseekSynthetic: marker(accountId), id: wooId, name: `Synthetic product ${index}`, price, tags: [], stock_quantity: 10, manage_stock: true } } });
            }
            for (let index = 1; index <= plan.options.orders; index++) {
                const customer = (index - 1) % plan.options.customers, product = (index - 1) % plan.options.products + 1, quantity = index % 3 + 1, cents = (1900 + product * 350) * quantity;
                totals[customer].orders++; totals[customer].cents += cents;
                const wooId = 80000 + index, wooCustomerId = 70001 + customer, email = `customer${customer + 1}@example.invalid`, total = (cents / 100).toFixed(2), date = new Date(at.getTime() - index * 86400000);
                await tx.wooOrder.create({ data: { id: rowId(accountId, 'order', index), accountId, wooId, number: String(wooId), status: 'completed', total, currency: 'USD', wooCustomerId, billingEmail: email, billingCountry: 'US', dateCreated: date, dateModified: date, rawData: { _overseekSynthetic: marker(accountId), id: wooId, customer_id: wooCustomerId, currency: 'USD', total, status: 'completed', billing: { email, country: 'US' }, line_items: [{ product_id: 90000 + product, quantity, total, total_tax: '0.00' }], tags: [], date_created: date.toISOString() } } });
            }
            for (let index = 1; index <= plan.options.customers; index++) {
                const total = (totals[index - 1].cents / 100).toFixed(2), wooId = 70000 + index, email = `customer${index}@example.invalid`;
                await tx.wooCustomer.create({ data: { id: rowId(accountId, 'customer', index), accountId, wooId, email, firstName: `Synthetic ${index}`, lastName: 'Fixture', ordersCount: totals[index - 1].orders, totalSpent: total, rawData: { _overseekSynthetic: marker(accountId), id: wooId, email, contactStatus: 'UNSUBSCRIBED', orders_count: totals[index - 1].orders, total_spent: total } } });
            }
        }
        const result = { task: plan.task, accountId, digest, applied: true, searchProjection: 'not-modified', automaticReseed: false };
        await tx.scopedOperation.create({ data: { id: operationId, accountId, kind: `synthetic-${plan.task}`, result } });
        return result;
    }, { isolationLevel: 'Serializable', timeout: 30000 });
}
export async function syntheticCli(task: Task, args = process.argv.slice(2)) {
    const values: Record<string, string> = {}; let apply = false;
    for (const arg of args) { if (arg === '--apply' && !apply) { apply = true; continue; } const match = /^--(account|database|user|email|at|products|customers|orders|confirm)=(.+)$/.exec(arg); if (!match || values[match[1]]) throw new Error('Use explicit unique --key=value arguments; no implicit scope'); values[match[1]] = match[2]; }
    const number = (key: string, fallback: number) => { if (values[key] === undefined) return fallback; if (!/^\d+$/.test(values[key])) throw new Error('Counts must be bounded integers'); return Number(values[key]); };
    const options = schema.parse({ accountId: values.account, database: values.database, userId: values.user, email: values.email, at: values.at, products: number('products', 12), customers: number('customers', 8), orders: number('orders', 20) });
    destination(options.database);
    const { createPrismaClient } = await import('../utils/prisma'); const db = createPrismaClient();
    try { const plan = await planSyntheticData(task, db, options); console.info(JSON.stringify(apply ? await applySyntheticPlan(db, plan, values.confirm || '', process.env.MOCK_NEW_PASSWORD) : { dryRun: true, plan }, null, 2)); }
    finally { await db.$disconnect(); }
}
