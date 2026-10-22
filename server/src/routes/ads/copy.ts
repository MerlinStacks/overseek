import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireAuthFastify } from '../../middleware/auth';
import { PermissionService } from '../../services/PermissionService';
import { prisma } from '../../utils/prisma';
import { AdCopyGenerator, AdCopyContext } from '../../services/tools/AdCopyGenerator';
import { claimAdCopyGeneration } from '../../services/tools/AdCopyQuota';

const id = z.string().trim().min(1).max(200), tone = z.enum(['professional', 'playful', 'urgent', 'luxury']), platform = z.enum(['google', 'meta', 'both']);
const custom = z.object({ brandVoice: z.string().trim().max(1000).optional(), categories: z.array(z.string().trim().min(1).max(100)).max(10).optional() }).strict();
const singleSchema = z.object({ productId: id.optional(), productName: z.string().trim().min(1).max(500).optional(), tonePreset: tone.default('professional'), platform: platform.default('google'), customContext: custom.optional() }).strict().refine(value => !(value.productId && value.productName), 'Choose a product ID or name, not both');
const bulkSchema = z.object({ tonePreset: tone, platform, productIds: z.array(id).min(1).max(10).refine(ids => new Set(ids).size === ids.length).optional(), maxProducts: z.number().int().min(1).max(10).default(5) }).strict();
const copySchema = z.object({ headlines: z.array(z.string().min(1).max(40)).min(1).max(15), descriptions: z.array(z.string().min(1).max(90)).max(4), primaryTexts: z.array(z.string().min(1).max(125)).max(3).optional(), source: z.enum(['ai', 'template']), platform: platform.optional(), notes: z.array(z.string().max(1000)).max(20).optional() }).strict();
export const adCopyRoutes: FastifyPluginAsync = async fastify => {
    fastify.addHook('preHandler', requireAuthFastify);
    fastify.addHook('preHandler', async (request, reply) => {
        if (!request.accountId || !request.user?.id) return reply.code(400).send({ error: 'Select an account' });
        if (!await PermissionService.hasPermission(request.user.id, request.accountId, request.method === 'GET' ? 'view_marketing' : 'manage_marketing')) return reply.code(403).send({ error: 'Marketing permission required' });
    });
    for (const bulk of [false, true]) fastify.post(bulk ? '/bulk-generate' : '/generate', async (request, reply) => {
        const parsed = bulk ? bulkSchema.safeParse(request.body) : singleSchema.safeParse(request.body);
        if (!parsed.success) return reply.code(400).send({ error: 'Invalid bounded generation options' });
        const input = parsed.data, accountId = request.accountId!;
        let release: (() => Promise<void>) | undefined;
        const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 120000);
        try {
            const selection = bulk ? bulkSchema.parse(input) : singleSchema.parse(input);
            const productIds = 'productIds' in selection ? selection.productIds : 'productId' in selection && selection.productId ? [selection.productId] : undefined;
            const max = bulk ? bulkSchema.parse(input).maxProducts : 1;
            if (productIds && productIds.length > max) return reply.code(400).send({ error: 'Product IDs exceed requested work limit' });
            release = await claimAdCopyGeneration(accountId, max * (input.platform === 'both' ? 2 : 1));
            const account = await prisma.account.findUnique({ where: { id: accountId }, select: { name: true, wooUrl: true } });
            if (!account) return reply.code(404).send({ error: 'Account not found' });
            const products = await prisma.wooProduct.findMany({ where: { accountId, ...(productIds ? { id: { in: productIds } } : {}) }, select: { id: true, name: true, sku: true }, orderBy: { id: 'asc' }, take: bulk ? max : productIds ? 1 : 5 });
            if (productIds && products.length !== productIds.length) return reply.code(404).send({ error: 'Product not found in account' });
            const generate = async (names: { name: string; sku?: string | null }[]) => {
                controller.signal.throwIfAborted();
                if (!await PermissionService.hasPermission(request.user!.id, accountId, 'manage_marketing')) throw new Error('Permission changed');
                const context: AdCopyContext = { storeName: account.name.slice(0, 200), storeUrl: account.wooUrl || '', topProducts: names.map(p => ({ name: p.name.slice(0, 500), sku: p.sku?.slice(0, 200) })), avgOrderValue: null,
                    tonePreset: input.tonePreset, platform: input.platform, ...('customContext' in input ? input.customContext : {}), signal: controller.signal };
                const value = input.platform === 'meta' ? await AdCopyGenerator.generateForMeta(accountId, context) : input.platform === 'both' ? await AdCopyGenerator.generateForBothPlatforms(accountId, context) : await AdCopyGenerator.generate(accountId, context);
                controller.signal.throwIfAborted();
                const copy = copySchema.parse(value);
                if (copy.headlines.some(headline => headline.length > (input.platform === 'meta' ? 40 : 30)) || input.platform === 'meta' && (copy.headlines.length > 5 || copy.descriptions.some(description => description.length > 30))) throw new Error('Copy exceeds platform limits');
                return copy;
            };
            if (!bulk) return { success: true, data: await generate('productName' in input && input.productName ? [{ name: input.productName }] : products), provenance: { productSelection: productIds ? 'explicit-account-products' : 'deterministic-catalog-sample', avgOrderValue: 'unavailable' } };
            const generated = [], failed = [];
            for (const product of products) {
                controller.signal.throwIfAborted();
                try { generated.push({ productId: product.id, productName: product.name, copy: await generate([product]) }); }
                catch { if (controller.signal.aborted) throw new Error('Deadline'); failed.push({ productId: product.id, productName: product.name, error: 'Generation unavailable' }); }
            }
            return { success: true, data: { generated, failed, totalProducts: products.length, successCount: generated.length, failedCount: failed.length }, coverage: { limit: max, selection: 'explicit-or-deterministic-sample-not-top-sellers' } };
        } catch (error) { return reply.code((error as { statusCode?: number }).statusCode === 429 ? 429 : 503).send({ error: 'Generation unavailable or work limit reached; no automatic retry was made' }); }
        finally { clearTimeout(timer); if (release) await release().catch(() => {}); }
    });
    fastify.get('/tone-presets', async () => ({ success: true, data: ['professional', 'playful', 'urgent', 'luxury'].map(id => ({ id, name: id.charAt(0).toUpperCase() + id.slice(1), description: 'Style preference only; do not invent offers or claims.' })) }));
    fastify.get('/platforms', async () => ({ success: true, data: [{ id: 'google', name: 'Google Ads' }, { id: 'meta', name: 'Meta Ads' }, { id: 'both', name: 'Both Platforms' }] }));
};
export default adCopyRoutes;
