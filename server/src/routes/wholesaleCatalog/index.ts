import { FastifyPluginAsync } from 'fastify';
import fs from 'fs';
import z from 'zod';
import { requireAuthFastify } from '../../middleware/auth';
import { PermissionService } from '../../services/PermissionService';
import { AuditActions, AuditService } from '../../services/AuditService';
import { WholesaleCatalogService, WholesaleConflictError, catalogInputSchema } from '../../services/wholesale/catalogs';
import { WholesaleNotFoundError, WholesaleProductService, WholesaleValidationError } from '../../services/wholesale/products';
import { WholesaleSettingsService, brandingSchema, defaultsSchema } from '../../services/wholesale/settings';
import { productSettingsSchema } from '../../services/wholesale/validation';
import { WholesaleGenerationService } from '../../services/wholesale/generations';
import { isAccountFeatureEnabled } from '../../utils/accountFeatures';
import { Logger } from '../../utils/logger';
import { WholesaleShareService } from '../../services/wholesale/shares';
import { prisma } from '../../utils/prisma';
import { hasWholesaleAccountMembership, isWholesaleDefaultsApprover } from '../../services/wholesale/authorization';
import { WholesaleBrandingImportService } from '../../services/wholesale/brandingImport';
import { WholesaleTermsSummaryService } from '../../services/wholesale/termsSummary';
import { WooService } from '../../services/woo';

const idParamsSchema = z.object({ catalogId: z.string().uuid() });
const productParamsSchema = z.object({ productId: z.string().uuid() });
const revisionParamsSchema = z.object({ catalogId: z.string().uuid(), revisionId: z.string().uuid() });
const generationParamsSchema = z.object({ generationId: z.string().uuid() });
const shareParamsSchema = z.object({ shareId: z.string().uuid() });
const catalogShareParamsSchema = z.object({ catalogId: z.string().uuid() });
const customerSearchSchema = z.object({ q: z.string().trim().min(1).max(200) });
const sharePrepareSchema = z.object({ customerId: z.string().uuid(), expiresAt: z.iso.datetime() }).strict();
const shareActivateSchema = z.object({ password: z.string().max(200).optional(), subject: z.string().trim().min(1).max(300).optional(), introduction: z.string().trim().min(1).max(3000).optional() }).strict();
const shareExpirySchema = z.object({ expiresAt: z.iso.datetime() }).strict();
const shareNotificationsSchema = z.object({ muted: z.boolean() }).strict();
const sharePasswordSchema = z.object({ password: z.string().max(200).optional() }).strict();
const generationCreateSchema = z.object({ validUntil: z.string() }).strict();
const generationApproveSchema = z.object({ note: z.string().trim().max(2000).optional() }).strict();
const validityExtensionSchema = z.object({ validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict();
const termsSummarySchema = z.object({
    heading: z.string().trim().min(1).max(160),
    content: z.string().trim().min(20).max(5000),
    targetReduction: z.number().int().min(5).max(80),
}).strict();
const pageQuerySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    search: z.string().trim().max(200).optional(),
});
const productQuerySchema = pageQuerySchema.extend({
    eligibleOnly: z.enum(['true', 'false']).default('true').transform(value => value === 'true'),
});
const catalogQuerySchema = pageQuerySchema.extend({ status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']).optional() });
const reconciliationSchema = z.object({ productIds: z.array(z.string().uuid()).max(500) }).strict();

async function requirePermission(request: any, reply: any, permission: string) {
    const accountId = request.accountId;
    const userId = request.user?.id;
    if (!accountId || !userId) return reply.code(401).send({ error: 'Authentication and account context required' });
    if (!await PermissionService.hasPermission(userId, accountId, permission)) {
        return reply.code(403).send({ error: 'Insufficient wholesale catalog permission' });
    }
    return null;
}

function sendError(reply: any, error: any) {
    if (error instanceof WholesaleNotFoundError) return reply.code(404).send({ error: error.message });
    if (error instanceof WholesaleValidationError) return reply.code(400).send({ error: error.message, details: error.details });
    if (error instanceof WholesaleConflictError) return reply.code(409).send({ error: error.message });
    Logger.error('[WholesaleCatalogRoutes] Request failed', { error: error?.message || error });
    return reply.code(500).send({ error: 'Wholesale catalog request failed' });
}

const wholesaleCatalogRoutes: FastifyPluginAsync = async fastify => {
    fastify.addHook('preHandler', requireAuthFastify);
    fastify.addHook('preHandler', async (request, reply) => {
        if (!request.accountId) return reply.code(400).send({ error: 'Account context required' });
        if (!request.user?.id || !await hasWholesaleAccountMembership(request.user.id, request.accountId)) {
            return reply.code(403).send({ error: 'Wholesale catalog access requires account membership' });
        }
        if (!await isAccountFeatureEnabled(request.accountId, 'WHOLESALE_CATALOG', false)) {
            return reply.code(403).send({ error: 'Wholesale catalog feature is disabled for this account' });
        }
    });

    fastify.get('/defaults', async (request, reply) => {
        const denied = await requirePermission(request, reply, 'view_wholesale_catalog');
        if (denied) return denied;
        try { return { defaults: await WholesaleSettingsService.getDefaults(request.accountId!) }; }
        catch (error) { return sendError(reply, error); }
    });

    fastify.put('/defaults', async (request, reply) => {
        const denied = await requirePermission(request, reply, 'edit_wholesale_catalog');
        if (denied) return denied;
        const parsed = defaultsSchema.safeParse(request.body);
        if (!parsed.success) return reply.code(400).send({ error: 'Invalid defaults payload', details: parsed.error.flatten() });
        try {
            const defaults = await WholesaleSettingsService.saveDefaults(request.accountId!, request.user!.id, parsed.data);
            await AuditService.log(request.accountId!, request.user!.id, AuditActions.WHOLESALE_DEFAULTS_UPDATED, 'WHOLESALE_DEFAULTS', defaults.id || request.accountId!, {
                version: defaults.version, termsHash: defaults.termsHash, sectionCount: parsed.data.termsDocument.sections.length,
            });
            return { defaults };
        } catch (error) { return sendError(reply, error); }
    });

    fastify.post('/defaults/import-tax', async (request, reply) => {
        const denied = await requirePermission(request, reply, 'edit_wholesale_catalog');
        if (denied) return denied;
        try {
            const woo = await WooService.forAccount(request.accountId!);
            return { candidate: await woo.getWholesaleTaxSettings() };
        } catch {
            Logger.warn('[WholesaleCatalogRoutes] WooCommerce tax import could not be prepared', { accountId: request.accountId });
            return reply.code(502).send({ error: 'Unable to import WooCommerce tax settings' });
        }
    });

    fastify.post('/defaults/approve', async (request, reply) => {
        const membership = await (prisma as any).accountUser.findUnique({
            where: { userId_accountId: { userId: request.user!.id, accountId: request.accountId! } }, select: { role: true },
        });
        if (!isWholesaleDefaultsApprover(membership?.role)) return reply.code(403).send({ error: 'Defaults approval requires an account owner or admin' });
        try {
            const defaults = await WholesaleSettingsService.approveDefaults(request.accountId!, request.user!.id);
            await AuditService.log(request.accountId!, request.user!.id, 'WHOLESALE_DEFAULTS_APPROVED', 'WHOLESALE_DEFAULTS', defaults.id, {
                version: defaults.version, termsHash: defaults.termsHash,
            });
            return { defaults };
        } catch (error) { return sendError(reply, error); }
    });

    fastify.get('/branding', async (request, reply) => {
        const denied = await requirePermission(request, reply, 'view_wholesale_catalog');
        if (denied) return denied;
        try { return { branding: await WholesaleSettingsService.getBranding(request.accountId!) }; }
        catch (error) { return sendError(reply, error); }
    });

    fastify.put('/branding', async (request, reply) => {
        const denied = await requirePermission(request, reply, 'edit_wholesale_catalog');
        if (denied) return denied;
        const parsed = brandingSchema.safeParse(request.body);
        if (!parsed.success) return reply.code(400).send({ error: 'Invalid branding payload', details: parsed.error.flatten() });
        try {
            const branding = await WholesaleSettingsService.saveBranding(request.accountId!, parsed.data);
            await AuditService.log(request.accountId!, request.user!.id, AuditActions.WHOLESALE_BRANDING_UPDATED, 'WHOLESALE_BRANDING', branding.id, {
                hasLogo: !!branding.logoUrl, hasPrimaryColor: !!branding.primaryColor, hasAccentColor: !!branding.accentColor,
            });
            return { branding };
        } catch (error) { return sendError(reply, error); }
    });

    fastify.post('/branding/import', async (request, reply) => {
        const denied = await requirePermission(request, reply, 'edit_wholesale_catalog');
        if (denied) return denied;
        try { return await WholesaleBrandingImportService.importCandidates(request.accountId!); }
        catch (error) { return sendError(reply, error); }
    });

    fastify.post('/terms/summarize', async (request, reply) => {
        const denied = await requirePermission(request, reply, 'edit_wholesale_catalog');
        if (denied) return denied;
        const parsed = termsSummarySchema.safeParse(request.body);
        if (!parsed.success) return reply.code(400).send({ error: 'Invalid terms summary payload', details: parsed.error.flatten() });
        try { return await WholesaleTermsSummaryService.suggest(request.accountId!, parsed.data); }
        catch (error) { return sendError(reply, error); }
    });

    fastify.get('/generations', async (request, reply) => {
        const denied = await requirePermission(request, reply, 'view_wholesale_catalog');
        if (denied) return denied;
        try { return { generations: await WholesaleGenerationService.list(request.accountId!) }; }
        catch (error) { return sendError(reply, error); }
    });

    fastify.get('/customers/search', async (request, reply) => {
        const denied = await requirePermission(request, reply, 'share_wholesale_catalog');
        if (denied) return denied;
        const parsed = customerSearchSchema.safeParse(request.query);
        if (!parsed.success) return reply.code(400).send({ error: 'Invalid customer search' });
        try { return { customers: await WholesaleShareService.searchCustomers(request.accountId!, parsed.data.q) }; }
        catch (error) { return sendError(reply, error); }
    });

    fastify.post('/generations/:generationId/shares/prepare', async (request, reply) => {
        const denied = await requirePermission(request, reply, 'share_wholesale_catalog');
        if (denied) return denied;
        const params = generationParamsSchema.safeParse(request.params);
        const parsed = sharePrepareSchema.safeParse(request.body);
        if (!params.success || !parsed.success) return reply.code(400).send({ error: 'Invalid share preparation payload' });
        try { return reply.code(202).send({ share: await WholesaleShareService.prepare(request.accountId!, request.user!.id, params.data.generationId, parsed.data.customerId, parsed.data.expiresAt) }); }
        catch (error) { return sendError(reply, error); }
    });

    fastify.get('/catalog/:catalogId/shares', async (request, reply) => {
        const denied = await requirePermission(request, reply, 'share_wholesale_catalog');
        if (denied) return denied;
        const params = catalogShareParamsSchema.safeParse(request.params);
        if (!params.success) return reply.code(400).send({ error: 'Invalid catalog id' });
        try { return { shares: await WholesaleShareService.list(request.accountId!, params.data.catalogId) }; }
        catch (error) { return sendError(reply, error); }
    });

    fastify.get('/shares/:shareId', async (request, reply) => {
        const denied = await requirePermission(request, reply, 'share_wholesale_catalog');
        if (denied) return denied;
        const params = shareParamsSchema.safeParse(request.params);
        if (!params.success) return reply.code(400).send({ error: 'Invalid share id' });
        try { return await WholesaleShareService.detail(request.accountId!, params.data.shareId, true); }
        catch (error) { return sendError(reply, error); }
    });

    fastify.post('/shares/:shareId/activate', async (request, reply) => {
        const denied = await requirePermission(request, reply, 'share_wholesale_catalog');
        if (denied) return denied;
        const params = shareParamsSchema.safeParse(request.params); const parsed = shareActivateSchema.safeParse(request.body || {});
        if (!params.success || !parsed.success) return reply.code(400).send({ error: 'Invalid activation payload' });
        try { return await WholesaleShareService.activate(request.accountId!, request.user!.id, params.data.shareId, parsed.data); }
        catch (error) { return sendError(reply, error); }
    });

    fastify.post('/shares/:shareId/resend', async (request, reply) => {
        const denied = await requirePermission(request, reply, 'share_wholesale_catalog');
        if (denied) return denied;
        const params = shareParamsSchema.safeParse(request.params); const parsed = shareActivateSchema.safeParse(request.body || {});
        if (!params.success || !parsed.success) return reply.code(400).send({ error: 'Invalid resend payload' });
        try { return await WholesaleShareService.resend(request.accountId!, request.user!.id, params.data.shareId, parsed.data); }
        catch (error) { return sendError(reply, error); }
    });

    fastify.post('/shares/:shareId/rotate-password', async (request, reply) => {
        const denied = await requirePermission(request, reply, 'share_wholesale_catalog');
        if (denied) return denied;
        const params = shareParamsSchema.safeParse(request.params); const parsed = sharePasswordSchema.safeParse(request.body || {});
        if (!params.success || !parsed.success) return reply.code(400).send({ error: 'Invalid password rotation payload' });
        try { return await WholesaleShareService.rotatePassword(request.accountId!, request.user!.id, params.data.shareId, parsed.data); }
        catch (error) { return sendError(reply, error); }
    });

    fastify.patch('/shares/:shareId/notifications', async (request, reply) => {
        const denied = await requirePermission(request, reply, 'share_wholesale_catalog');
        if (denied) return denied;
        const params = shareParamsSchema.safeParse(request.params); const parsed = shareNotificationsSchema.safeParse(request.body);
        if (!params.success || !parsed.success) return reply.code(400).send({ error: 'Invalid notification preference payload' });
        try { return { share: await WholesaleShareService.setNotificationsMuted(request.accountId!, params.data.shareId, parsed.data.muted) }; }
        catch (error) { return sendError(reply, error); }
    });

    fastify.post('/shares/:shareId/revoke', async (request, reply) => {
        const denied = await requirePermission(request, reply, 'share_wholesale_catalog');
        if (denied) return denied;
        const params = shareParamsSchema.safeParse(request.params); if (!params.success) return reply.code(400).send({ error: 'Invalid share id' });
        try { await WholesaleShareService.revoke(request.accountId!, request.user!.id, params.data.shareId); return { revoked: true }; }
        catch (error) { return sendError(reply, error); }
    });

    fastify.patch('/shares/:shareId/expiry', async (request, reply) => {
        const denied = await requirePermission(request, reply, 'share_wholesale_catalog');
        if (denied) return denied;
        const params = shareParamsSchema.safeParse(request.params); const parsed = shareExpirySchema.safeParse(request.body);
        if (!params.success || !parsed.success) return reply.code(400).send({ error: 'Invalid expiry payload' });
        try { return { expiresAt: await WholesaleShareService.changeExpiry(request.accountId!, request.user!.id, params.data.shareId, parsed.data.expiresAt) }; }
        catch (error) { return sendError(reply, error); }
    });

    fastify.get('/shares/:shareId/download', async (request, reply) => {
        let denied = await requirePermission(request, reply, 'share_wholesale_catalog');
        if (denied) return denied;
        denied = await requirePermission(request, reply, 'generate_wholesale_catalog');
        if (denied) return denied;
        const params = shareParamsSchema.safeParse(request.params); if (!params.success) return reply.code(400).send({ error: 'Invalid share id' });
        try {
            const { share, filePath, fileName } = await WholesaleShareService.readablePdf(request.accountId!, params.data.shareId);
            reply.header('Warning', '299 Overseek "Customer-specific confidential catalog"').type('application/pdf').header('Content-Disposition', `attachment; filename="${fileName}"`);
            await AuditService.log(request.accountId!, request.user!.id, AuditActions.WHOLESALE_SHARE_DOWNLOADED, 'WHOLESALE_CATALOG_SHARE', share.id, { warning: true });
            return reply.send(fs.createReadStream(filePath));
        } catch (error) { return sendError(reply, error); }
    });

    fastify.get('/generations/:generationId', async (request, reply) => {
        const denied = await requirePermission(request, reply, 'view_wholesale_catalog');
        if (denied) return denied;
        const params = generationParamsSchema.safeParse(request.params);
        if (!params.success) return reply.code(400).send({ error: 'Invalid generation id' });
        try {
            return { generation: await WholesaleGenerationService.getPublic(request.accountId!, params.data.generationId) };
        } catch (error) { return sendError(reply, error); }
    });

    fastify.post('/generations/:generationId/cancel', async (request, reply) => {
        const denied = await requirePermission(request, reply, 'generate_wholesale_catalog');
        if (denied) return denied;
        const params = generationParamsSchema.safeParse(request.params);
        if (!params.success) return reply.code(400).send({ error: 'Invalid generation id' });
        try { return { generation: await WholesaleGenerationService.cancel(request.accountId!, params.data.generationId, request.user!.id) }; }
        catch (error) { return sendError(reply, error); }
    });

    fastify.post('/generations/:generationId/retry', async (request, reply) => {
        const denied = await requirePermission(request, reply, 'generate_wholesale_catalog');
        if (denied) return denied;
        const params = generationParamsSchema.safeParse(request.params);
        if (!params.success) return reply.code(400).send({ error: 'Invalid generation id' });
        try { return reply.code(202).send({ generation: await WholesaleGenerationService.retry(request.accountId!, params.data.generationId, request.user!.id) }); }
        catch (error) { return sendError(reply, error); }
    });

    fastify.post('/generations/:generationId/approve', async (request, reply) => {
        const denied = await requirePermission(request, reply, 'generate_wholesale_catalog');
        if (denied) return denied;
        const params = generationParamsSchema.safeParse(request.params);
        const parsed = generationApproveSchema.safeParse(request.body || {});
        if (!params.success) return reply.code(400).send({ error: 'Invalid generation id' });
        if (!parsed.success) return reply.code(400).send({ error: 'Invalid approval payload', details: parsed.error.flatten() });
        try { return { generation: await WholesaleGenerationService.approve(request.accountId!, params.data.generationId, request.user!.id, parsed.data.note) }; }
        catch (error) { return sendError(reply, error); }
    });

    fastify.post('/generations/:generationId/extend-validity', async (request, reply) => {
        const denied = await requirePermission(request, reply, 'generate_wholesale_catalog');
        if (denied) return denied;
        const params = generationParamsSchema.safeParse(request.params);
        const parsed = validityExtensionSchema.safeParse(request.body);
        if (!params.success || !parsed.success) return reply.code(400).send({ error: 'Invalid validity extension payload' });
        try {
            return reply.code(202).send({ generation: await WholesaleGenerationService.extendValidity(request.accountId!, params.data.generationId, request.user!.id, parsed.data.validUntil) });
        } catch (error) { return sendError(reply, error); }
    });

    const sendGenerationPdf = async (request: any, reply: any, disposition: 'inline' | 'attachment') => {
        const denied = await requirePermission(request, reply, 'generate_wholesale_catalog');
        if (denied) return denied;
        const params = generationParamsSchema.safeParse(request.params);
        if (!params.success) return reply.code(400).send({ error: 'Invalid generation id' });
        try {
            const { generation, filePath } = await WholesaleGenerationService.readableFile(request.accountId, params.data.generationId);
            const warning = generation.staleAt ? 'Catalog is stale' : generation.validUntil <= new Date() ? 'Catalog validity has expired'
                : generation.status !== 'APPROVED' ? 'Catalog has not been approved' : null;
            if (warning) reply.header('Warning', `299 Overseek "${warning}"`);
            reply.header('Content-Type', 'application/pdf');
            reply.header('Content-Disposition', `${disposition}; filename="wholesale-catalog-v${generation.versionNumber || 'preview'}.pdf"`);
            await AuditService.log(request.accountId, request.user.id, AuditActions.WHOLESALE_GENERATION_DOWNLOADED, 'WHOLESALE_CATALOG_GENERATION', generation.id, { disposition, warning });
            return reply.send(fs.createReadStream(filePath));
        } catch (error) { return sendError(reply, error); }
    };

    fastify.get('/generations/:generationId/preview', (request, reply) => sendGenerationPdf(request, reply, 'inline'));
    fastify.get('/generations/:generationId/download', (request, reply) => sendGenerationPdf(request, reply, 'attachment'));

    fastify.get('/products', async (request, reply) => {
        const denied = await requirePermission(request, reply, 'view_wholesale_catalog');
        if (denied) return denied;
        const parsed = productQuerySchema.safeParse(request.query);
        if (!parsed.success) return reply.code(400).send({ error: 'Invalid product query', details: parsed.error.flatten() });
        try { return await WholesaleProductService.list(request.accountId!, { ...parsed.data, eligibleOnly: parsed.data.eligibleOnly ?? true }); }
        catch (error) { return sendError(reply, error); }
    });

    fastify.get('/products/:productId', async (request, reply) => {
        const denied = await requirePermission(request, reply, 'view_wholesale_catalog');
        if (denied) return denied;
        const params = productParamsSchema.safeParse(request.params);
        if (!params.success) return reply.code(400).send({ error: 'Invalid product id' });
        try { return await WholesaleProductService.get(request.accountId!, params.data.productId); }
        catch (error) { return sendError(reply, error); }
    });

    fastify.get('/products/:productId/history', async (request, reply) => {
        const denied = await requirePermission(request, reply, 'view_wholesale_catalog');
        if (denied) return denied;
        const params = productParamsSchema.safeParse(request.params); const query = pageQuerySchema.safeParse(request.query);
        if (!params.success || !query.success) return reply.code(400).send({ error: 'Invalid product history query' });
        try { return await WholesaleProductService.history(request.accountId!, params.data.productId, query.data.page, query.data.limit); }
        catch (error) { return sendError(reply, error); }
    });

    fastify.put('/products/:productId', async (request, reply) => {
        const denied = await requirePermission(request, reply, 'edit_wholesale_catalog');
        if (denied) return denied;
        const params = productParamsSchema.safeParse(request.params);
        const parsed = productSettingsSchema.safeParse(request.body);
        if (!params.success) return reply.code(400).send({ error: 'Invalid product id' });
        if (!parsed.success) return reply.code(400).send({ error: 'Invalid pricing profile', details: parsed.error.flatten() });
        try {
            const previous = await WholesaleProductService.get(request.accountId!, params.data.productId);
            const profile = await WholesaleProductService.save(request.accountId!, params.data.productId, parsed.data);
            await AuditService.log(request.accountId!, request.user!.id, AuditActions.WHOLESALE_PRODUCT_UPDATED, 'WHOLESALE_PRODUCT', params.data.productId, {
                old: WholesaleProductService.auditSnapshot(previous.profile, previous.product.baseTurnaroundDays),
                new: WholesaleProductService.auditSnapshot(profile, parsed.data.baseTurnaroundDays),
                priceSetVersion: profile.priceSetVersion,
            });
            return { profile };
        } catch (error) { return sendError(reply, error); }
    });

    fastify.get('/', async (request, reply) => {
        const denied = await requirePermission(request, reply, 'view_wholesale_catalog');
        if (denied) return denied;
        const parsed = catalogQuerySchema.safeParse(request.query);
        if (!parsed.success) return reply.code(400).send({ error: 'Invalid catalog query', details: parsed.error.flatten() });
        try { return await WholesaleCatalogService.list(request.accountId!, parsed.data); }
        catch (error) { return sendError(reply, error); }
    });

    fastify.post('/', async (request, reply) => {
        const denied = await requirePermission(request, reply, 'edit_wholesale_catalog');
        if (denied) return denied;
        const parsed = catalogInputSchema.safeParse(request.body);
        if (!parsed.success) return reply.code(400).send({ error: 'Invalid catalog payload', details: parsed.error.flatten() });
        try {
            const catalog = await WholesaleCatalogService.create(request.accountId!, request.user!.id, parsed.data);
            await auditCatalog(request, AuditActions.WHOLESALE_CATALOG_CREATED, catalog, { status: catalog.status });
            return reply.code(201).send({ catalog });
        } catch (error) { return sendError(reply, error); }
    });

    fastify.post('/:catalogId/generations', async (request, reply) => {
        const denied = await requirePermission(request, reply, 'generate_wholesale_catalog');
        if (denied) return denied;
        const params = idParamsSchema.safeParse(request.params);
        const parsed = generationCreateSchema.safeParse(request.body);
        if (!params.success) return reply.code(400).send({ error: 'Invalid catalog id' });
        if (!parsed.success) return reply.code(400).send({ error: 'Invalid generation payload', details: parsed.error.flatten() });
        try {
            const generation = await WholesaleGenerationService.create(request.accountId!, params.data.catalogId, request.user!.id, parsed.data.validUntil);
            return reply.code(202).send({ generation });
        } catch (error) { return sendError(reply, error); }
    });

    fastify.post('/:catalogId/apply-default-terms', async (request, reply) => {
        const denied = await requirePermission(request, reply, 'edit_wholesale_catalog');
        if (denied) return denied;
        const params = idParamsSchema.safeParse(request.params);
        if (!params.success) return reply.code(400).send({ error: 'Invalid catalog id' });
        try {
            const catalog = await WholesaleCatalogService.applyDefaultTerms(request.accountId!, params.data.catalogId, request.user!.id);
            await auditCatalog(request, AuditActions.WHOLESALE_CATALOG_UPDATED, catalog, { appliedDefaultTerms: true, defaultsVersion: catalog.defaultsVersion });
            return { catalog };
        } catch (error) { return sendError(reply, error); }
    });

    fastify.get('/:catalogId', async (request, reply) => {
        const denied = await requirePermission(request, reply, 'view_wholesale_catalog');
        if (denied) return denied;
        const params = idParamsSchema.safeParse(request.params);
        if (!params.success) return reply.code(400).send({ error: 'Invalid catalog id' });
        try { return { catalog: await WholesaleCatalogService.get(request.accountId!, params.data.catalogId) }; }
        catch (error) { return sendError(reply, error); }
    });

    fastify.put('/:catalogId', async (request, reply) => {
        const denied = await requirePermission(request, reply, 'edit_wholesale_catalog');
        if (denied) return denied;
        const params = idParamsSchema.safeParse(request.params);
        const parsed = catalogInputSchema.safeParse(request.body);
        if (!params.success) return reply.code(400).send({ error: 'Invalid catalog id' });
        if (!parsed.success) return reply.code(400).send({ error: 'Invalid catalog payload', details: parsed.error.flatten() });
        try {
            const catalog = await WholesaleCatalogService.update(request.accountId!, params.data.catalogId, request.user!.id, parsed.data);
            await auditCatalog(request, AuditActions.WHOLESALE_CATALOG_UPDATED, catalog, { status: catalog.status });
            return { catalog };
        } catch (error) { return sendError(reply, error); }
    });

    fastify.put('/:catalogId/products', async (request, reply) => {
        const denied = await requirePermission(request, reply, 'edit_wholesale_catalog');
        if (denied) return denied;
        const params = idParamsSchema.safeParse(request.params);
        const parsed = reconciliationSchema.safeParse(request.body);
        if (!params.success) return reply.code(400).send({ error: 'Invalid catalog id' });
        if (!parsed.success) return reply.code(400).send({ error: 'Invalid product reconciliation payload', details: parsed.error.flatten() });
        try {
            const catalog = await WholesaleCatalogService.reconcileProducts(request.accountId!, params.data.catalogId, request.user!.id, parsed.data.productIds);
            await auditCatalog(request, AuditActions.WHOLESALE_CATALOG_PRODUCTS_UPDATED, catalog, { productCount: catalog.products.length });
            return { catalog };
        } catch (error) { return sendError(reply, error); }
    });

    fastify.post('/:catalogId/duplicate', async (request, reply) => {
        const denied = await requirePermission(request, reply, 'edit_wholesale_catalog');
        if (denied) return denied;
        const params = idParamsSchema.safeParse(request.params);
        if (!params.success) return reply.code(400).send({ error: 'Invalid catalog id' });
        try {
            const catalog = await WholesaleCatalogService.duplicate(request.accountId!, params.data.catalogId, request.user!.id);
            await auditCatalog(request, AuditActions.WHOLESALE_CATALOG_CREATED, catalog, { duplicatedFrom: params.data.catalogId });
            return reply.code(201).send({ catalog });
        } catch (error) { return sendError(reply, error); }
    });

    fastify.delete('/:catalogId', async (request, reply) => {
        const denied = await requirePermission(request, reply, 'edit_wholesale_catalog');
        if (denied) return denied;
        const params = idParamsSchema.safeParse(request.params);
        if (!params.success) return reply.code(400).send({ error: 'Invalid catalog id' });
        try {
            await WholesaleCatalogService.remove(request.accountId!, params.data.catalogId);
            await AuditService.log(request.accountId!, request.user!.id, AuditActions.WHOLESALE_CATALOG_DELETED, 'WHOLESALE_CATALOG', params.data.catalogId, {});
            return reply.code(204).send();
        } catch (error) { return sendError(reply, error); }
    });

    fastify.get('/:catalogId/revisions', async (request, reply) => {
        const denied = await requirePermission(request, reply, 'view_wholesale_catalog');
        if (denied) return denied;
        const params = idParamsSchema.safeParse(request.params);
        if (!params.success) return reply.code(400).send({ error: 'Invalid catalog id' });
        try { return { revisions: await WholesaleCatalogService.revisions(request.accountId!, params.data.catalogId) }; }
        catch (error) { return sendError(reply, error); }
    });

    fastify.post('/:catalogId/revisions/:revisionId/restore', async (request, reply) => {
        const denied = await requirePermission(request, reply, 'edit_wholesale_catalog');
        if (denied) return denied;
        const params = revisionParamsSchema.safeParse(request.params);
        if (!params.success) return reply.code(400).send({ error: 'Invalid revision path' });
        try {
            const catalog = await WholesaleCatalogService.restore(request.accountId!, params.data.catalogId, params.data.revisionId, request.user!.id);
            await auditCatalog(request, AuditActions.WHOLESALE_CATALOG_RESTORED, catalog, { revisionId: params.data.revisionId });
            return { catalog };
        } catch (error) { return sendError(reply, error); }
    });
};

async function auditCatalog(request: any, action: string, catalog: any, details: Record<string, unknown>) {
    await AuditService.log(request.accountId, request.user.id, action, 'WHOLESALE_CATALOG', catalog.id, details);
}

export default wholesaleCatalogRoutes;
