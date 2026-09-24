import { randomUUID } from 'node:crypto';
import { Prisma, ReceiptAccount } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../utils/prisma';
import { WooService } from '../woo';
import { configuredInboundProducts, dirtyInbound, lockDeliveryAccount } from './intents';
import { buildCutoverBatch, cutoverBatchStillCurrent, cutoverProgress, controlBytes, object, CONTROL_MAX_BYTES, CUTOVER_SOURCE_REBUILDS, DeliveryControlCommand } from './cutoverBatch';
import { settingsSchema } from './validation';
import { isAccountFeatureEnabled } from '../../utils/accountFeatures';
import { checkFreshnessPrerequisite } from './freshnessPrerequisite';
import { queueDeliveryDisable } from './controlIntents';
import { checkInventoryCompatibility } from './inventoryCompatibility';
import { materializeLegacyBomReviews } from './bomStockTransport';

export class LaunchConflict extends Error { statusCode = 409; }
export const cutoverSchema = z.object({ receivingPaused: z.literal(true), legacyJobsDrained: z.literal(true), preupgradeWorkersRestarted: z.literal(true) }).strict();
export const activationSchema = z.object({ active: z.boolean() }).strict();
const pluginSchema = z.object({ schemaVersion: z.literal(1), protocolVersion: z.literal(1), productionEstimates: z.boolean().optional(), blockers: z.array(z.string()), wooVersion: z.string().nullable(), environmentFingerprint: z.string().regex(/^[a-f0-9]{64}$/), presentation: z.enum(['classic', 'blocks', 'unknown']), state: z.object({ revision: z.number().int(), active: z.boolean(), mode: z.string(), epoch: z.string().nullable() }).passthrough() });
const inventoryPluginBlockers = new Set(['woocommerce_native_stock_management_required', 'guarded_receipts_native_stock_store_required', 'transactional_native_stock_storage_required']);
const productionSettings = (payload: unknown) => object(object(payload).settings).estimateMode === 'production';
const settled = ['applied', 'reconciled'];

async function requireCutoverFreshness(db?: Prisma.TransactionClient) {
    const prerequisite = await checkFreshnessPrerequisite({ fresh: true, db });
    if (!prerequisite.ready) throw new LaunchConflict('freshness_sql_prerequisite_missing: ' +
        (prerequisite.diagnostic ?? 'Apply the reviewed delivery SQL migrations; schema push alone is insufficient. Then retry cutover.'));
}

/** Lightweight draft-response status; authoritative readiness is the dedicated diagnostic. */
export async function deliveryLocalStatus(accountId: string) {
    const [control, sync] = await Promise.all([
        prisma.receiptAccount.findUnique({ where: { accountId } }),
        prisma.deliverySyncAccount.findUnique({ where: { accountId } }),
    ]);
    return { syncStatus: sync?.capabilityStatus ?? 'not_requested', storefrontActivated: control?.active ?? false };
}

/** Readiness is a diagnostic, never inferred from a successful transport status. */
export async function deliveryReadiness(accountId: string, transportBudgetMs = 10_000) {
    const discoveryDeadline = Date.now() + transportBudgetMs;
    const [account, control, sync, settings, unresolvedReceipts, unresolvedLegacyJobs, pendingInputs, configuredCount] = await Promise.all([
        prisma.account.findUniqueOrThrow({ where: { id: accountId }, select: { receiptTransportMode: true } }),
        prisma.receiptAccount.findUnique({ where: { accountId } }),
        prisma.deliverySyncAccount.findUnique({ where: { accountId } }),
        prisma.deliveryInputSync.findUnique({ where: { accountId_scope_entityId: { accountId, scope: 'settings', entityId: 0 } } }),
        prisma.receiptOperation.count({ where: { accountId, OR: [{ state: { notIn: settled } }, { cascadeState: { not: 'done' } }] } }),
        prisma.receiptLegacyWork.count({ where: { accountId, state: { not: 'drained' } } }),
        prisma.deliveryInputSync.count({ where: { accountId, status: { not: 'synced' } } }),
        prisma.wooProduct.count({ where: { accountId, ...configuredInboundProducts } }),
    ]);
    const blockers: string[] = [];
    const warnings: string[] = [];
    const simple = productionSettings(settings?.payload);
    // Keep diagnostics available for an inventory upgrade already being recovered.
    const inventoryDiagnostics = !simple || !!control?.receivingFrozen;
    const freshnessPrerequisite = inventoryDiagnostics ? await checkFreshnessPrerequisite() : null;
    if (!simple && !freshnessPrerequisite?.ready) blockers.push('freshness_sql_prerequisite_missing');
    const inventoryCompatibility = inventoryDiagnostics ? await checkInventoryCompatibility(accountId) : null;
    if (!simple && (!inventoryCompatibility?.ready || control?.controlError?.startsWith('inventory_'))) blockers.push('inventory_compatibility_required');
    let plugin: z.infer<typeof pluginSchema> | null = null;
    try {
        if (Date.now() >= discoveryDeadline) throw new Error('Readiness discovery budget exhausted');
        plugin = pluginSchema.parse(await (await WooService.forAccount(accountId)).deliveryControl(undefined, Math.max(1, discoveryDeadline - Date.now())));
    }
    catch { blockers.push('plugin_control_unavailable_or_upgrade_required'); }
    if (plugin) {
        blockers.push(...plugin.blockers.filter(code => !simple || !inventoryPluginBlockers.has(code)));
        if (simple && plugin.productionEstimates !== true) blockers.push('production_estimates_plugin_update_required');
    }
    if (!await isAccountFeatureEnabled(accountId, 'DELIVERY_ESTIMATES')) blockers.push('feature_disabled');
    if (!simple && (account.receiptTransportMode !== 'GUARDED' || control?.cutoverState !== 'guarded')) blockers.push('cutover_required');
    if (control?.receivingFrozen) blockers.push('receiving_frozen');
    if (!simple && unresolvedReceipts) blockers.push('unresolved_receipts');
    if (!simple && unresolvedLegacyJobs) blockers.push('legacy_jobs_not_drained');
    if (!simple && (pendingInputs || sync?.resyncRequested || sync?.inboundRequested)) blockers.push('inputs_pending');
    if (!settings || settings.status !== 'synced' || settings.ackRevision !== settings.desiredRevision || !settingsSchema.safeParse((settings.payload as Prisma.JsonObject)?.settings).success) blockers.push('settings_not_synced_or_invalid');
    const parsedSettings = settingsSchema.safeParse((settings?.payload as Prisma.JsonObject | undefined)?.settings);
    const enabledMappings = parsedSettings.success ? parsedSettings.data.shippingMethods.filter(row => row.enabled) : [];
    const supportedMapping = (row: typeof enabledMappings[number]) => {
        if (!['flat_rate', 'free_shipping', 'local_pickup', 'wbs', 'wbsng'].includes(row.methodId)) return false;
        if (row.methodId === 'local_pickup' && row.fulfilmentType !== 'collection') return false;
        const kind = row.mappingKind ?? 'core_instance';
        return kind === 'exact_rate' || (kind === 'all_provider_rates' && row.allRatesConfirmed === true)
            || (kind === 'core_instance' && ['flat_rate', 'free_shipping', 'local_pickup'].includes(row.methodId));
    };
    const configuredSupported = enabledMappings.filter(supportedMapping).length;
    if (!configuredSupported) blockers.push('no_supported_enabled_shipping_mapping');
    if (enabledMappings.some(row => !supportedMapping(row))) warnings.push('unsupported_shipping_mappings_excluded');
    if (parsedSettings.success && !parsedSettings.data.defaultMethod) warnings.push('product_page_default_method_not_configured');
    if (!configuredCount) blockers.push('no_configured_products');
    // Indexed account-scoped SQL aggregates avoid loading a catalogue in a request.
    type ProofCounts = { stale: bigint; unverified: bigint; excluded: bigint; eligible: bigint; total: bigint; excludedProductWooIds: number[] | null };
    // A stale catalogue entry must not prevent other products from going live.
    // The storefront validates each requested product/variation against live Woo data.
    const proofCounts = simple ? await prisma.$queryRaw<ProofCounts[]>`
        SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE i.status = 'synced' AND i."ackRevision" = i."desiredRevision") AS eligible,
          0::bigint AS stale, 0::bigint AS unverified, 0::bigint AS excluded, NULL::int[] AS "excludedProductWooIds"
        FROM "WooProduct" p JOIN "DeliveryInputSync" i ON i."accountId" = p."accountId" AND i.scope = 'product' AND i."entityId" = p."wooId"
        WHERE p."accountId" = ${accountId} AND p."rawData"->>'type' IN ('simple', 'variable')
          AND p."rawData"->>'status' IS DISTINCT FROM 'trash' AND (p."productionMinDays" IS NOT NULL OR EXISTS
          (SELECT 1 FROM "ProductVariation" v WHERE v."productId" = p.id AND v."productionMinDays" IS NOT NULL))`
        : await prisma.$queryRaw<ProofCounts[]>`
        WITH configured AS (
          SELECT p.* FROM "WooProduct" p WHERE p."accountId" = ${accountId}
          AND (p."productionMinDays" IS NOT NULL OR p."productionMaxDays" IS NOT NULL OR EXISTS
            (SELECT 1 FROM "ProductVariation" v WHERE v."productId" = p.id AND (v."productionMinDays" IS NOT NULL OR v."productionMaxDays" IS NOT NULL)))
        ), classified AS (
          SELECT p."wooId", i.id AS input_id, i.payload,
            targets.eligible_targets, targets.excluded_targets, targets.invalid_targets, targets.target_count
          FROM configured p
          LEFT JOIN "DeliveryInputSync" i ON i."accountId" = p."accountId" AND i.scope = 'inbound' AND i."entityId" = p."wooId"
          CROSS JOIN LATERAL (
            SELECT COUNT(*) FILTER (WHERE t->>'state' = 'pending') AS eligible_targets,
              COUNT(*) FILTER (WHERE t->>'state' = 'unsupported') AS excluded_targets,
              COUNT(*) FILTER (WHERE t->>'state' IS NULL OR t->>'state' NOT IN ('pending', 'unsupported')) AS invalid_targets,
              COUNT(*) AS target_count
            FROM jsonb_array_elements(COALESCE(i.payload->'targets', '[]'::jsonb)) t
            WHERE (p."productionMinDays" IS NOT NULL OR p."productionMaxDays" IS NOT NULL OR EXISTS
              (SELECT 1 FROM "ProductVariation" v WHERE v."productId" = p.id AND v."wooId" = (t->>'wooId')::int
               AND (v."productionMinDays" IS NOT NULL OR v."productionMaxDays" IS NOT NULL)))
            AND NOT COALESCE((t->>'state' = 'unsupported' AND (t->>'wooId')::int = p."wooId"
              AND p."rawData"->>'type' = 'variable' AND jsonb_array_length(i.payload->'targets') > 1), false)
          ) targets
        )
        SELECT COUNT(input_id) AS total,
          COUNT(*) FILTER (WHERE eligible_targets > 0) AS eligible,
          COUNT(*) FILTER (WHERE eligible_targets > 0 AND ((payload->>'expiresAt')::timestamptz <= NOW()
            OR (payload->>'generatedAt')::timestamptz > NOW())) AS stale,
          COUNT(*) FILTER (WHERE invalid_targets > 0 OR (input_id IS NOT NULL AND target_count = 0)
            OR (eligible_targets > 0 AND (payload->>'receiptSafety' IS DISTINCT FROM 'verified'
              OR payload->'receiptProof'->>'epoch' IS DISTINCT FROM ${control?.cutoverEpoch ?? ''}))) AS unverified,
          COUNT(*) FILTER (WHERE excluded_targets > 0) AS excluded,
          (ARRAY_AGG("wooId" ORDER BY "wooId") FILTER (WHERE excluded_targets > 0))[1:100] AS "excludedProductWooIds"
        FROM classified`;
    const counts = proofCounts[0];
    if (!simple && (!counts || Number(counts.total) < configuredCount)) blockers.push('inbound_missing');
    if (simple && Number(counts?.eligible ?? 0) < configuredCount) warnings.push('production_products_not_synced');
    if (Number(counts?.stale ?? 0) > 0) blockers.push('inbound_stale');
    if (Number(counts?.unverified ?? 0) > 0) blockers.push('inbound_unverified');
    if (Number(counts?.eligible ?? 0) === 0) blockers.push('no_eligible_configured_products');
    if (Number(counts?.excluded ?? 0) > 0) warnings.push('configured_products_excluded_unsupported_or_BOM');
    if (!simple && plugin && control?.cutoverEpoch && plugin.state.epoch !== control.cutoverEpoch) blockers.push('plugin_epoch_mismatch');
    const active = !!(control?.active && plugin?.state.active && !plugin.blockers.some(code => !simple || !inventoryPluginBlockers.has(code)) && (simple ? plugin.state.estimateMode === 'production' : plugin.state.estimateMode !== 'production' && plugin.state.epoch === control.cutoverEpoch)
        && plugin.state.environmentFingerprint === plugin.environmentFingerprint && settings && settings.status === 'synced'
        && plugin.state.settingsRevision === Number(settings.ackRevision) && (settings.payload as Prisma.JsonObject).enabled === true);
    return { ready: blockers.length === 0, estimateMode: simple ? 'production' : 'inventory', mode: account.receiptTransportMode, active, acknowledgedActive: control?.active ?? false,
        desiredActive: control?.desiredActive ?? false, cutoverState: control?.cutoverState ?? 'legacy', receivingFrozen: control?.receivingFrozen ?? false,
        revalidationRequested: control?.revalidationRequested ?? false,
        actions: { legacyReview: unresolvedLegacyJobs > 0 ? '/api/delivery-estimates/receipts/legacy' : null,
            resumeCutover: control?.receivingFrozen && !unresolvedLegacyJobs && !unresolvedReceipts &&
                (control.cutoverState === 'legacy_review' || (control.cutoverState === 'baseline' && control.controlAttempts >= 8)) ? '/api/delivery-estimates/cutover' : null,
            revalidateActivation: control?.desiredActive && ((control.controlAttempts >= 8) || plugin?.environmentFingerprint !== plugin?.state.environmentFingerprint) ? '/api/delivery-estimates/activation' : null },
        epoch: control?.cutoverEpoch ?? null, revision: String(control?.controlRevision ?? 0), acknowledgedRevision: String(control?.controlAckRevision ?? 0),
        work: { action: control?.controlAction ?? null, attempts: control?.controlAttempts ?? 0, lastError: control?.controlError ?? null, nextAttemptAt: control?.controlNextAttemptAt?.toISOString() ?? null,
            progress: { ...cutoverProgress(control?.pluginReadiness, control?.controlCursor), cursor: control?.controlCursor ?? null,
                pendingCursor: object(control?.controlPayload).cursor ?? null,
                pendingProducts: object(object(control?.controlPayload).page).productCount ?? 0,
                pendingOwners: Array.isArray(object(control?.controlPayload).owners) ? (object(control?.controlPayload).owners as unknown[]).length : 0 } },
        blockers, warnings, unresolvedReceipts, unresolvedLegacyJobs, pendingInputs, configuredCount, plugin, freshnessPrerequisite, inventoryCompatibility,
        eligibleConfiguredCount: Number(counts?.eligible ?? 0), excludedConfiguredCount: Number(counts?.excluded ?? 0), excludedProductWooIds: counts?.excludedProductWooIds ?? [],
        providerSupport: { supportedMethodIds: ['flat_rate', 'free_shipping', 'local_pickup', 'wbs', 'wbsng'], configuredSupported },
        sync: { capability: sync?.capabilityStatus ?? 'unknown', inboundCapability: sync?.inboundCapabilityStatus ?? 'unknown',
            resyncRequested: sync?.resyncRequested ?? false, inboundRequested: sync?.inboundRequested ?? false,
            lastError: sync?.lastError ?? sync?.inboundLastError ?? sync?.buildLastError ?? null },
        freshness: { stale: Number(counts?.stale ?? 0), unverified: Number(counts?.unverified ?? 0) } };
}

/** Only durable intent is created in the request; receiving freezes under the same lock as PO mutations. */
export async function requestCutover(accountId: string, userId: string, certify = false) {
    const result = await prisma.$transaction(async tx => {
        await lockDeliveryAccount(tx, accountId);
        // Also diagnose an idempotent already-guarded request; do not upsert, freeze
        // receiving or create review/control work when reviewed SQL is absent.
        await requireCutoverFreshness(tx);
        const control = await tx.receiptAccount.upsert({ where: { accountId }, create: { accountId }, update: {} });
        if (control.cutoverState === 'guarded' && !certify) return { accepted: true, revision: String(control.controlRevision), epoch: control.cutoverEpoch };
        await materializeLegacyBomReviews(tx, accountId);
        if (await tx.receiptLegacyWork.count({ where: { accountId, state: { not: 'drained' } } })) {
            await tx.receiptAccount.update({ where: { accountId }, data: { receivingFrozen: true, cutoverState: 'legacy_review', workersRestartedBy: userId, workersRestartedAt: new Date(),
                controlAction: 'disable', controlRevision: { increment: 1 }, controlPayload: Prisma.DbNull, controlAttempts: 0, controlNextAttemptAt: new Date(), revalidationRequested: false,
                controlError: 'Legacy review required: use the receipt legacy observation/reconcile API, then resume cutover.' } });
            return { reviewRequired: true as const };
        }
        const inventory = await checkInventoryCompatibility(accountId, tx);
        if (!inventory.ready) throw new LaunchConflict('Inventory compatibility required before cutover: ' + inventory.targets.map(t => `${t.productWooId}${t.variationWooId ? '/' + t.variationWooId : ''}: ${t.reason}`).join(', '));
        if (await tx.receiptOperation.count({ where: { accountId, ...(control.cutoverState === 'legacy_review' ? { sourceType: 'purchase_order' } : {}),
            OR: [{ state: { notIn: settled } }, { cascadeState: { not: 'done' } }] } })) throw new LaunchConflict('Drain tracked legacy jobs and resolve receipts/cascades before cutover.');
        const epoch = control.cutoverEpoch ?? randomUUID();
        const next = await tx.receiptAccount.update({ where: { accountId }, data: {
            cutoverEpoch: epoch, cutoverState: 'baseline', receivingFrozen: true, workersRestartedBy: userId, workersRestartedAt: new Date(),
            ...(certify && control.cutoverState === 'guarded' ? { controlCursor: null } : {}),
            pluginReadiness: { ...object(control.pluginReadiness), cutoverProgress: certify && control.cutoverState === 'guarded'
                ? cutoverProgress(null, null) : { ...cutoverProgress(control.pluginReadiness, control.controlCursor), pageRebuilds: 0 } } as Prisma.InputJsonValue,
            controlAction: 'cutover', controlRevision: { increment: 1 }, controlPayload: Prisma.DbNull, controlAttempts: 0, controlError: null, controlNextAttemptAt: new Date(),
        } });
        return { accepted: true, revision: String(next.controlRevision), epoch };
    });
    if ('reviewRequired' in result) throw new LaunchConflict('Drain tracked legacy jobs through /api/delivery-estimates/receipts/legacy; receiving is frozen for operator review.');
    return result;
}

export async function requestActivation(accountId: string, active: boolean) {
    if (active) { const readiness = await deliveryReadiness(accountId); if (!readiness.ready) throw new LaunchConflict(readiness.blockers.join(', ')); }
    return prisma.$transaction(async tx => {
        await lockDeliveryAccount(tx, accountId);
        if (!active) {
            const next = await queueDeliveryDisable(tx, accountId);
            return { accepted: true, revision: String(next.controlRevision), desiredActive: false };
        }
        const current = await tx.receiptAccount.upsert({ where: { accountId }, create: { accountId }, update: {} });
        const settings = await tx.deliveryInputSync.findUnique({ where: { accountId_scope_entityId: { accountId, scope: 'settings', entityId: 0 } } });
        if (active && (current.receivingFrozen || (!productionSettings(settings?.payload) && current.cutoverState !== 'guarded'))) throw new LaunchConflict('Cutover is not complete.');
        const next = await tx.receiptAccount.update({ where: { accountId }, data: { desiredActive: active, revalidationRequested: false, controlAction: active ? 'activate' : 'disable', controlRevision: { increment: 1 }, controlPayload: Prisma.DbNull, controlAttempts: 0, controlError: null, controlNextAttemptAt: new Date() } });
        return { accepted: true, revision: String(next.controlRevision), desiredActive: active };
    });
}

export const CONTROL_DRAIN_ROUNDS = 8;
export const CONTROL_DRAIN_MAX_COMMANDS = 40;
export const CONTROL_DRAIN_BUDGET_MS = 8_000;
const MIN_CONTROL_SEND_MS = 750;
const controlTransaction = <T>(work: (tx: Prisma.TransactionClient) => Promise<T>) => prisma.$transaction(async tx => {
    await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '3000ms'");
    await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '1000ms'");
    return work(tx);
}, { maxWait: 1000, timeout: 5000 });

/** Re-select each slot so a newly queued disable preempts further catalogue pages.
 * One normal page per account per round, bounded rounds/dispatches/wall-time.
 */
export async function drainDeliveryControls(options: { maxRounds?: number; maxCommands?: number; budgetMs?: number } = {}) {
    const deadline = Date.now() + Math.min(CONTROL_DRAIN_BUDGET_MS, Math.max(1, options.budgetMs ?? CONTROL_DRAIN_BUDGET_MS));
    const rounds = Math.min(CONTROL_DRAIN_ROUNDS, Math.max(1, options.maxRounds ?? CONTROL_DRAIN_ROUNDS));
    const cap = Math.min(CONTROL_DRAIN_MAX_COMMANDS, Math.max(1, options.maxCommands ?? CONTROL_DRAIN_MAX_COMMANDS));
    const attempted: { accountId: string; controlRevision: bigint }[] = [];
    for (let round = 0; round < rounds && attempted.length < cap; round++) {
        const served: string[] = []; let worked = false;
        for (let slot = 0; slot < 5 && attempted.length < cap; slot++) {
            if (Date.now() + MIN_CONTROL_SEND_MS >= deadline) return;
            const now = new Date();
            const due = { controlAttempts: { lt: 8 }, controlNextAttemptAt: { lte: now }, OR: [{ controlLeaseExpiresAt: null }, { controlLeaseExpiresAt: { lte: now } }],
                ...(attempted.length ? { NOT: { OR: attempted } } : {}) };
            const query = { take: 1, orderBy: [{ controlNextAttemptAt: 'asc' as const }, { accountId: 'asc' as const }] };
            let candidate = (await prisma.receiptAccount.findMany({ ...query, where: { ...due, controlAction: 'disable' } }))[0];
            if (!candidate) candidate = (await prisma.receiptAccount.findMany({ ...query, where: { ...due, controlAction: { in: ['cutover', 'activate'] }, accountId: { notIn: served } } }))[0];
            if (!candidate || Date.now() + MIN_CONTROL_SEND_MS >= deadline) break;
            attempted.push({ accountId: candidate.accountId, controlRevision: candidate.controlRevision });
            served.push(candidate.accountId); worked = true;
            await dispatchDeliveryControl(candidate, deadline);
        }
        if (!worked) return;
    }
}

/** Exactly one immutable command per lease. The drain may fairly revisit the next revision. */
export async function dispatchDeliveryControl(candidate: ReceiptAccount, deadline = Date.now() + 30_000) {
        const token = randomUUID();
        const fence = { accountId: candidate.accountId, controlRevision: candidate.controlRevision, controlLeaseToken: token };
        const claimed = await prisma.receiptAccount.updateMany({ where: { accountId: candidate.accountId, controlRevision: candidate.controlRevision, controlAction: candidate.controlAction,
            controlAttempts: { lt: 8 }, controlNextAttemptAt: { lte: new Date() }, OR: [{ controlLeaseExpiresAt: null }, { controlLeaseExpiresAt: { lte: new Date() } }] },
            data: { controlLeaseToken: token, controlLeaseExpiresAt: new Date(Date.now() + 120_000), controlAttempts: { increment: 1 } } });
        if (!claimed.count) return;
        const waitForReadiness = async (message: string) => prisma.receiptAccount.updateMany({ where: fence, data: {
            controlAttempts: candidate.controlAttempts, controlNextAttemptAt: new Date(Date.now() + (candidate.controlError === message ? 300_000 : 30_000)), controlError: message,
        } });
        try {
            // Previously queued cutovers must not bypass a subsequently damaged schema.
            // Disable/recovery commands deliberately do not depend on this prerequisite.
            if (candidate.controlAction === 'cutover') await requireCutoverFreshness();
            if (candidate.controlAction === 'activate' && candidate.revalidationRequested) {
                const settings = await prisma.deliveryInputSync.findUnique({ where: { accountId_scope_entityId: { accountId: candidate.accountId, scope: 'settings', entityId: 0 } } });
                if (!settings || settings.status !== 'synced' || settings.ackRevision !== settings.desiredRevision) {
                    await waitForReadiness('Waiting for settings synchronization before automatic revalidation.');
                    return;
                }
            }
            if (!Number.isSafeInteger(Number(candidate.controlRevision))) throw new LaunchConflict('Control revision exhausted.');
            const woo = await WooService.forAccount(candidate.accountId);
            if (Date.now() + MIN_CONTROL_SEND_MS >= deadline) {
                await prisma.receiptAccount.updateMany({ where: fence, data: { controlAttempts: candidate.controlAttempts, controlNextAttemptAt: new Date() } });
                return;
            }
            const plugin = candidate.controlAction === 'disable' ? null : pluginSchema.parse(await woo.deliveryControl(undefined, Math.max(1, deadline - Date.now())));
            // Private cutover preparation stays inactive, so the merchant may retain
            // the old display until inputs are ready. No other compatibility waiver.
            const preparation = candidate.controlAction === 'cutover' && (!candidate.controlPayload || ['baseline', 'guarded'].includes(String(object(candidate.controlPayload).action)));
            const activationSettings = candidate.controlAction === 'activate' ? await prisma.deliveryInputSync.findUnique({ where: { accountId_scope_entityId: { accountId: candidate.accountId, scope: 'settings', entityId: 0 } } }) : null;
            const simple = candidate.controlAction === 'activate' && productionSettings(activationSettings?.payload);
            const pluginBlockers = (plugin?.blockers ?? []).filter(blocker => !(preparation && blocker.startsWith('deactivate_old_delivery_plugin:')) && !(simple && inventoryPluginBlockers.has(blocker)));
            if (pluginBlockers.length) {
                if (candidate.revalidationRequested) { await waitForReadiness('Automatic revalidation waiting: ' + pluginBlockers.join(', ')); return; }
                throw new LaunchConflict(pluginBlockers.join(', '));
            }
            const progress = cutoverProgress(candidate.pluginReadiness, candidate.controlCursor);
            let envelope = candidate.controlPayload as unknown as DeliveryControlCommand | null;
            if (candidate.controlAction === 'cutover' && !envelope) {
                envelope = await controlTransaction(async tx => {
                    await lockDeliveryAccount(tx, candidate.accountId);
                    if (!await tx.receiptAccount.findFirst({ where: { ...fence, controlLeaseExpiresAt: { gt: new Date() } } })) return null;
                    return buildCutoverBatch(tx, candidate.accountId, candidate.controlRevision, candidate.cutoverEpoch, candidate.controlCursor, progress);
                });
                if (!envelope) return;
            }
            const action = envelope?.action ?? candidate.controlAction!;
            if (action === 'activate') {
                const ready = await deliveryReadiness(candidate.accountId, Math.max(1, deadline - Date.now()));
                if (Date.now() + MIN_CONTROL_SEND_MS >= deadline) {
                    await prisma.receiptAccount.updateMany({ where: fence, data: { controlAttempts: candidate.controlAttempts, controlNextAttemptAt: new Date() } });
                    return;
                }
                if (!ready.ready) {
                    if (candidate.revalidationRequested) {
                        await waitForReadiness('Automatic revalidation waiting: ' + ready.blockers.join(', '));
                        return;
                    }
                    throw new LaunchConflict(ready.blockers.join(', '));
                }
            }
            if (action === 'guarded') {
                if (await prisma.receiptLegacyWork.count({ where: { accountId: candidate.accountId, state: { not: 'drained' } } })) {
                    await waitForReadiness('Waiting for legacy inventory review before cutover.'); return;
                }
                if (await prisma.receiptOperation.count({ where: { accountId: candidate.accountId, OR: [{ state: { notIn: settled } }, { cascadeState: { not: 'done' } }] } })) {
                    await waitForReadiness('Waiting for guarded inventory operations and cascades to settle before cutover.'); return;
                }
                const inventory = await checkInventoryCompatibility(candidate.accountId);
                if (!inventory.ready) throw new LaunchConflict('inventory_compatibility_required: ' + inventory.targets.map(t => `${t.productWooId}: ${t.reason}`).join(', '));
            }
            const settings = action === 'activate' ? await prisma.deliveryInputSync.findUnique({ where: { accountId_scope_entityId: { accountId: candidate.accountId, scope: 'settings', entityId: 0 } } }) : null;
            envelope ??= { schemaVersion: 1, revision: Number(candidate.controlRevision), action, epoch: candidate.cutoverEpoch, owners: [], cursor: null, ...(settings ? { settingsRevision: Number(settings.ackRevision), ...(productionSettings(settings.payload) ? { estimateMode: 'production' as const } : {}) } : {}) };
            const { owners } = envelope; const cursor = envelope.cursor ?? null;
            if (owners.length > 1001 || controlBytes(envelope) > CONTROL_MAX_BYTES) throw new LaunchConflict('Control command exceeds the owner/64 KiB envelope bound.');
            const reserved = await prisma.receiptAccount.updateMany({ where: { ...fence, controlLeaseExpiresAt: { gt: new Date() } }, data: { controlPayload: envelope } });
            if (!reserved.count) return;
            if (Date.now() + MIN_CONTROL_SEND_MS >= deadline) {
                await prisma.receiptAccount.updateMany({ where: fence, data: { controlAttempts: candidate.controlAttempts, controlNextAttemptAt: new Date() } });
                return; // Keep the immutable reserved command for the next bounded tick.
            }
            const ack = await woo.deliveryControl(envelope, Math.max(1, deadline - Date.now())) as { schemaVersion?: number; revision?: number; state?: { active?: boolean; epoch?: string; mode?: string; estimateMode?: string } };
            if (ack?.schemaVersion !== 1 || ack.revision !== envelope.revision || !ack.state || ack.state.active !== (action === 'activate') || (envelope.estimateMode === 'production' ? ack.state.estimateMode !== 'production' : action !== 'disable' && (ack.state.epoch !== candidate.cutoverEpoch || ack.state.mode !== (action === 'baseline' ? 'baseline' : 'guarded')))) throw new Error('Invalid control acknowledgement');
            await controlTransaction(async tx => {
                await lockDeliveryAccount(tx, candidate.accountId);
                if (!await tx.receiptAccount.findFirst({ where: { ...fence, controlLeaseExpiresAt: { gt: new Date() } } })) return;
                if (action === 'guarded') await requireCutoverFreshness(tx);
                if (action === 'guarded' && !(await checkInventoryCompatibility(candidate.accountId, tx)).ready) {
                    throw new LaunchConflict('inventory_compatibility_required: catalogue changed during cutover; fix the listed inventory targets and restart cutover.');
                }
                if (action === 'guarded' && await tx.receiptOperation.count({ where: { accountId: candidate.accountId, OR: [{ state: { notIn: settled } }, { cascadeState: { not: 'done' } }] } })) {
                    throw new LaunchConflict('receipt_work_pending: inventory operations arrived during the final handshake; waiting for settlement.');
                }
                if (action === 'guarded' && await tx.receiptLegacyWork.count({ where: { accountId: candidate.accountId, state: { not: 'drained' } } })) {
                    throw new LaunchConflict('receipt_work_pending: legacy inventory review arrived during the final handshake.');
                }
                const page = envelope!.page;
                if (action === 'baseline' && page && !await cutoverBatchStillCurrent(tx, candidate.accountId, page)) {
                    const retries = progress.pageRebuilds + 1;
                    await tx.receiptAccount.updateMany({ where: fence, data: { controlAckRevision: candidate.controlRevision, controlRevision: { increment: 1 }, controlPayload: Prisma.DbNull,
                        controlAttempts: retries >= CUTOVER_SOURCE_REBUILDS ? 8 : 0, controlNextAttemptAt: new Date(),
                        controlError: 'Catalogue ownership changed during baseline ACK; complete page rebuild required.',
                        pluginReadiness: { ...object(candidate.pluginReadiness), ...(plugin ?? {}), cutoverProgress: { ...progress, sourceRebuilds: progress.sourceRebuilds + 1, pageRebuilds: retries } } as Prisma.InputJsonValue,
                    } });
                    return; // Never certify or advance past an altered/incomplete prefix.
                }
                if (owners.length && !(action === 'baseline' && !page)) {
                    await tx.receiptOwner.createMany({ data: owners.map(stockOwnerWooId => ({ accountId: candidate.accountId, stockOwnerWooId, certifiedEpoch: candidate.cutoverEpoch })), skipDuplicates: true });
                    await tx.receiptOwner.updateMany({ where: { accountId: candidate.accountId, stockOwnerWooId: { in: owners } }, data: { certifiedEpoch: candidate.cutoverEpoch } });
                }
                const more = candidate.controlAction === 'cutover' && action === 'baseline';
                const nextProgress = more ? { ...progress, baselineEstablished: true, pageRebuilds: 0, pagesAcknowledged: progress.pagesAcknowledged + 1,
                    productsProcessed: progress.productsProcessed + (page?.productCount ?? 0), ownerCertifications: progress.ownerCertifications + (page ? owners.length : 0),
                    lastPageProducts: page?.productCount ?? 0, lastPageOwners: owners.length } : progress;
                await tx.receiptAccount.updateMany({ where: fence, data: { controlAckRevision: candidate.controlRevision, active: action === 'activate', revalidationRequested: false, controlError: null, controlAttempts: 0,
                    pluginReadiness: { ...object(candidate.pluginReadiness), ...(plugin ?? {}), cutoverProgress: nextProgress } as Prisma.InputJsonValue,
                    // Pre-batching commands lack a source fence. ACK them unchanged,
                    // then re-read from the last acknowledged cursor with a new revision.
                    ...(more ? { controlCursor: page ? cursor : candidate.controlCursor, controlPayload: Prisma.DbNull, controlRevision: { increment: 1 }, controlNextAttemptAt: new Date() } : { controlAction: null, controlPayload: Prisma.DbNull }),
                    ...(action === 'guarded' ? { cutoverState: 'guarded', receivingFrozen: false } : {}),
                    ...(action === 'guarded' && candidate.desiredActive ? { controlAction: 'activate', controlRevision: { increment: 1 }, revalidationRequested: true, controlNextAttemptAt: new Date() } : {}),
                } });
                if (action === 'guarded') {
                    await tx.account.update({ where: { id: candidate.accountId }, data: { receiptTransportMode: 'GUARDED' } });
                    await dirtyInbound(tx, candidate.accountId);
                }
            });
        } catch (error) {
            const responseMessage = (error as { response?: { data?: { message?: unknown } } } | null)?.response?.data?.message;
            const message = typeof responseMessage === 'string' ? responseMessage : error instanceof Error ? error.message : 'Control unavailable';
            if (message.startsWith('receipt_work_pending:')) { await waitForReadiness(message); return; }
            await prisma.receiptAccount.updateMany({ where: fence, data: { controlError: message.slice(0, 1000), controlNextAttemptAt: new Date(Date.now() + Math.min(3_600_000, 30_000 * 2 ** candidate.controlAttempts)),
                ...(message.startsWith('inventory_') ? { controlAttempts: 8, controlCursor: null, controlPayload: Prisma.DbNull,
                    pluginReadiness: { ...object(candidate.pluginReadiness), cutoverProgress: cutoverProgress(null, null) } as Prisma.InputJsonValue } : {}),
            } });
        } finally {
            await prisma.receiptAccount.updateMany({ where: { accountId: candidate.accountId, controlLeaseToken: token }, data: { controlLeaseToken: null, controlLeaseExpiresAt: null } });
        }
}
