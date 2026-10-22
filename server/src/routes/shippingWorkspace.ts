import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../utils/prisma';
import { PermissionService } from '../services/PermissionService';
import { writeShippingCatalog } from '../services/shipping/ShippingCatalogWrite';
import { runWorkspaceAction, shippingWorkspaceActionSchema } from '../services/shipping/ShippingWorkspaceAction';
import { shippingService } from '../services/shipping/ShippingService';
function publicPolicy(config: unknown) {
    if (!config || typeof config !== 'object' || Array.isArray(config)) return {};
    const record = config as Record<string, unknown>;
    return Object.fromEntries(['wooFulfillmentBehavior', 'printDeliveryMethod', 'defaultPrintStationId'].filter(key => Object.prototype.hasOwnProperty.call(record, key)).map(key => [key, record[key] == null ? null : typeof record[key] === 'string' && record[key].length <= 200 ? record[key] : 'unknown']));
}
export const shippingWorkspaceRoutes: FastifyPluginAsync = async app => {
    app.addHook('preHandler', async (request, reply) => {
        if (!request.accountId || !request.user?.id || !await PermissionService.hasPermission(request.user.id, request.accountId, 'view_shipping')) return reply.code(403).send({ error: 'Shipping read access required' });
    });
    app.get('/workspace/policy', async request => {
        const settings = await shippingService.getSafeSettings(request.accountId!);
        return { accountId: request.accountId!, carrierAccount: settings.carrierAccount ? { config: publicPolicy(settings.carrierAccount.config) } : null };
    });
    app.get('/workspace/operations', async request => {
        const accountId = request.accountId!;
        const [jobs, stations, audit] = await Promise.all([
            prisma.shippingPrintJob.findMany({ where: { accountId }, orderBy: [{ requestedAt: 'desc' }, { id: 'asc' }], take: 101, select: { id: true, accountId: true, updatedAt: true, status: true, attempts: true, printStationId: true, labelId: true, requestedAt: true, printedAt: true, errorMessage: true } }),
            prisma.shippingPrintStation.findMany({ where: { accountId }, orderBy: { id: 'asc' }, take: 101, select: { id: true, name: true, status: true, lastSeenAt: true } }),
            prisma.shippingAuditEvent.findMany({ where: { accountId }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], take: 101, select: { id: true, eventType: true, createdAt: true, labelId: true, userId: true } }),
        ]);
        return { accountId, jobs: jobs.slice(0, 100), stations: stations.slice(0, 100), audit: audit.slice(0, 100), partial: jobs.length > 100 || stations.length > 100 || audit.length > 100, observedAt: new Date().toISOString() };
    });
    app.get('/workspace/dispatch', async request => {
        const accountId = request.accountId!;
        const settings = await shippingService.getSafeSettings(accountId);
        const raw = (settings.carrierAccount?.config as any)?.dispatchStatus;
        if (raw != null && raw !== '' && (typeof raw !== 'string' || !raw.trim() || raw.length > 80)) throw new Error('Dispatch policy observation unavailable');
        const dispatchStatus = typeof raw === 'string' && raw.trim() && raw.length <= 80 ? raw.trim() : 'In Dispatch';
        const slug = dispatchStatus.toLowerCase().replace(/^wc-/, '').replace(/\s+/g, '-');
        const orders = await prisma.wooOrder.findMany({ where: { accountId, status: { in: [dispatchStatus, dispatchStatus.toLowerCase(), slug, `wc-${slug}`] } }, orderBy: [{ dateCreated: 'asc' }, { id: 'asc' }], take: 101, select: { id: true, wooId: true, accountId: true, updatedAt: true, number: true, status: true, total: true, currency: true, dateCreated: true } });
        const drafts = await prisma.shippingShipmentDraft.findMany({ where: { accountId, wooOrderId: { in: orders.slice(0, 100).map(order => order.wooId) } }, select: { id: true, accountId: true, wooOrderId: true, updatedAt: true, readinessStatus: true, addressValidationStatus: true, correctedAddress: true, selectedPackagePresetId: true, selectedPrintStationId: true, selectedServiceCode: true, manualOuterLengthMm: true, manualOuterWidthMm: true, manualOuterHeightMm: true, manualWeightGrams: true } });
        return { accountId, dispatchStatus, basis: raw ? 'configured status' : 'server default status', policy: settings.carrierAccount ? { updatedAt: settings.carrierAccount.updatedAt, config: publicPolicy(settings.carrierAccount.config) } : null, partial: orders.length > 100, orders: orders.slice(0, 100).map(order => ({ order, draft: drafts.find(draft => draft.wooOrderId === order.wooId) ?? null })) };
    });
    app.post('/workspace/action', async (request, reply) => {
        const body = shippingWorkspaceActionSchema.safeParse(request.body);
        if (!body.success) return reply.code(400).send({ error: 'Invalid reviewed action' });
        const permission = ['retry', 'reassign'].includes(body.data.action) ? 'print_shipping_labels' : 'create_shipping_labels';
        if (!await PermissionService.hasPermission(request.user!.id, request.accountId!, permission) || body.data.action === 'create' && !await PermissionService.hasPermission(request.user!.id, request.accountId!, 'print_shipping_labels')) return reply.code(403).send({ error: 'Current action permission required' });
        try {
            const value = await runWorkspaceAction(request.accountId!, request.user!.id, body.data) as Record<string, unknown>;
            return { accountId: request.accountId!, operationId: body.data.operationId, value: { id: value?.id, accountId: value?.accountId, updatedAt: value?.updatedAt } };
        }
        catch (error) { return reply.code((error as Error)?.name === 'ZodError' ? 400 : 409).send({ error: 'Action invalid, conflicted or uncertain; reconcile original operation before retrying' }); }
    });
    app.get('/workspace/catalog', async (request, reply) => {
        if (!request.accountId || !request.user?.id || !await PermissionService.hasPermission(request.user.id, request.accountId, 'view_shipping')) return reply.code(403).send({ error: 'Shipping read permission required' });
        const accountId = request.accountId;
        const [packages, overrides] = await Promise.all([prisma.shippingPackagePreset.findMany({ where: { accountId }, orderBy: { id: 'asc' }, take: 1001 }), prisma.shippingItemOverride.findMany({ where: { accountId }, orderBy: { id: 'asc' }, take: 1001 })]);
        return { accountId, packages: packages.slice(0, 1000), overrides: overrides.slice(0, 1000), partial: packages.length > 1000 || overrides.length > 1000 };
    });
    app.post('/workspace/catalog-write', async (request, reply) => {
        if (!request.accountId || !request.user?.id || !await PermissionService.hasPermission(request.user.id, request.accountId, 'manage_shipping_packages')) return reply.code(403).send({ error: 'Shipping catalog management required' });
        try { return { accountId: request.accountId, snapshot: await writeShippingCatalog(request.accountId, request.user.id, request.body), operationId: (request.body as { operationId: string }).operationId }; }
        catch (error) { return reply.code((error as Error)?.name === 'ZodError' ? 400 : 409).send({ error: 'Catalog write invalid/conflicted or unacknowledged. Preserve draft and reconcile original operation.' }); }
    });
};
