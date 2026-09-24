/** Wire contract: docs/delivery-launch-api.md and server/routes/deliveryEstimates.ts. */
export interface DeliveryReadiness {
    estimateMode?: 'production' | 'inventory';
    ready: boolean;
    mode: 'LEGACY' | 'GUARDED';
    active: boolean;
    desiredActive: boolean;
    cutoverState: 'legacy' | 'legacy_review' | 'baseline' | 'guarded';
    revalidationRequested: boolean;
    actions: { legacyReview: string | null; revalidateActivation: string | null; resumeCutover?: string | null };
    freshnessPrerequisite?: { ready: boolean; version: string; missing: string[]; diagnostic: string | null } | null;
    inventoryCompatibility?: { ready: boolean; blockedCount: number; targets: { productWooId: number; variationWooId: number | null; reason: string }[] } | null;
    receivingFrozen: boolean;
    epoch: string | null;
    revision: string;
    acknowledgedRevision: string;
    work: { action: 'cutover' | 'activate' | 'disable' | null; attempts: number; lastError: string | null; nextAttemptAt: string | null };
    blockers: string[];
    warnings: string[];
    unresolvedReceipts: number;
    unresolvedLegacyJobs: number;
    pendingInputs: number;
    configuredCount: number;
    freshness: { stale: number; unverified: number };
    providerSupport: { supportedMethodIds: string[]; configuredSupported: number };
    sync: { capability: string; inboundCapability: string; resyncRequested: boolean; inboundRequested: boolean; lastError: string | null };
    plugin: null | { schemaVersion: 1; protocolVersion: 1; wooVersion: string | null; blockers: string[];
        environmentFingerprint?: string; presentation?: 'classic' | 'blocks' | 'unknown';
        state: { revision: number; mode: string; epoch: string | null; active: boolean; settingsRevision?: number; identity?: string } };
}
export interface Receipt {
    operationId: string; accountId: string; purchaseOrderId: string; productId: string;
    stockOwnerWooId: number; sequence: string; delta: number; state: string;
    attempts: number; lastError: string | null;
    reconciliation?: unknown;
    cycleId?: string; sourceType?: string; sourceId?: string | null;
    productWooId?: number; variationWooId?: number | null;
    cascadeState?: string; cascadeAttempts?: number; cascadeNextAttemptAt?: string | null;
    cascadeError?: string | null; cascadeCompletedAt?: string | null; cascadeRetryPath?: string | null;
}
export interface ReceiptCycle {
    id: string; accountId: string; purchaseOrderId: string; active: boolean; createdAt: string;
    skippedLines: { lineId: string | null; productId: string | null; variationWooId: number | null; quantity: number; reason: string }[];
}
export interface ReceiptCyclePage { cycles: ReceiptCycle[]; nextCursor: string | null }
export function operationSource(source: string | undefined, delta?: number) {
    if (source === 'purchase_order') return delta !== undefined && delta < 0 ? 'Purchase order reversal' : 'Purchase order receipt';
    if (source === 'purchase_order_reversal') return 'Historical purchase order reversal';
    if (source === 'bom_consumption') return 'BOM consumption';
    if (source === 'bom_reversal') return 'BOM cancellation / restock';
    return `Unknown source (${source ?? 'not supplied'})`;
}
export const purchaseOrderHref = (id: string) => `/inventory/purchase-orders/${encodeURIComponent(id)}`;
export interface ReceiptPage {
    receipts: Receipt[]; nextCursor: string | null;
    legacyJobs: { id: string; accountId: string; purchaseOrderId: string; state: string; createdAt: string }[];
}
export interface Observation {
    schemaVersion: 1; operationId: string; stockQuantity: number; observationToken: string; expiresAt: string;
}
export interface Attestation {
    actionId: string; observationToken: string; observedStockQuantity: number;
    reason: string; correctedCountIncludesOperation: true;
}
export interface LegacyJob {
    id: string; accountId: string; purchaseOrderId: string; state: string;
    targets: { productWooId: number; variationWooId?: number | null; stock?: number }[] | null;
    originalTargetsAvailable: boolean; attempts: number; lastError: string | null; createdAt: string;
    reconciliation?: unknown;
    sourceType?: string; sourceId?: string | null;
}
export interface LegacyPage { jobs: LegacyJob[]; nextCursor: string | null }
export interface LegacyObservation {
    schemaVersion: 1; jobId: string; sourceIncomplete: boolean;
    owners: { stockOwnerWooId: number; stockQuantity: number }[];
    unobservable: ({ target: { productWooId: number; variationWooId: number | null }; reason: string } | { stockOwnerWooId: number; reason: string })[];
    observationToken: string; expiresAt: string;
}
export interface LegacyAttestation {
    receivingPaused: true; workersRestarted: true; actionId: string; observationToken: string;
    reason: string; correctedInventoryIncludesLegacyWork: true; acknowledgeUnobservableTargets: boolean;
    legacyReceiptReversalConfirmed?: true;
}
/** Only the immutable request fields are replayed, never server actor/operation or inventory metadata. */
export function priorAttestation(value: unknown): Attestation | null {
    if (!value || typeof value !== 'object') return null;
    const data = value as Record<string, unknown>;
    if (typeof data.actionId !== 'string' || typeof data.observationToken !== 'string' || typeof data.reason !== 'string'
        || !Number.isSafeInteger(data.observedStockQuantity) || data.correctedCountIncludesOperation !== true) return null;
    return { actionId: data.actionId, observationToken: data.observationToken, reason: data.reason,
        observedStockQuantity: data.observedStockQuantity as number, correctedCountIncludesOperation: true };
}
export function priorLegacyAttestation(value: unknown): LegacyAttestation | null {
    if (!value || typeof value !== 'object') return null;
    const data = value as Record<string, unknown>;
    if (typeof data.actionId !== 'string' || typeof data.observationToken !== 'string' || typeof data.reason !== 'string'
        || data.receivingPaused !== true || data.workersRestarted !== true || data.correctedInventoryIncludesLegacyWork !== true
        || typeof data.acknowledgeUnobservableTargets !== 'boolean') return null;
    return { actionId: data.actionId, observationToken: data.observationToken, reason: data.reason, receivingPaused: true,
        workersRestarted: true, correctedInventoryIncludesLegacyWork: true, acknowledgeUnobservableTargets: data.acknowledgeUnobservableTargets,
        ...(data.legacyReceiptReversalConfirmed === true ? { legacyReceiptReversalConfirmed: true } : {}) };
}
export const staleObservation = (error: string | null) => /stale|expir|observation.*reject/i.test(error ?? '');
export class LaunchApiError extends Error {
    constructor(message: string, public status: number) { super(message); }
}
export const recoverableReceipt = (state: string) => ['parked', 'uncertain', 'reconciliation_failed'].includes(state);
export const pendingReceipt = (receipt: Receipt) => (['pending', 'prepared', 'reconciling'].includes(receipt.state) && receipt.attempts < 8)
    || (['applied', 'reconciled'].includes(receipt.state) && receipt.cascadeState === 'pending');
export function knownControl(data: DeliveryReadiness) {
    return typeof data.ready === 'boolean' && typeof data.active === 'boolean' && typeof data.desiredActive === 'boolean' && typeof data.receivingFrozen === 'boolean'
        && typeof data.revision === 'string' && typeof data.acknowledgedRevision === 'string'
        && ['LEGACY', 'GUARDED'].includes(data.mode) && ['legacy', 'legacy_review', 'baseline', 'guarded'].includes(data.cutoverState)
        && [null, 'cutover', 'activate', 'disable'].includes(data.work?.action)
        && /^\d+$/.test(data.revision) && /^\d+$/.test(data.acknowledgedRevision);
}
export function canActivate(data: DeliveryReadiness | null) {
    return !!data && knownControl(data) && data.ready === true && (data.estimateMode === 'production' || (data.mode === 'GUARDED' && data.cutoverState === 'guarded'))
        && data.receivingFrozen === false && data.blockers.length === 0
        && (data.work.action === null || (data.work.action === 'activate' && data.work.attempts >= 8));
}

export const isCutoverRecovery = (data: DeliveryReadiness | null) => !!data
    && (data.receivingFrozen || data.cutoverState === 'legacy_review' || data.cutoverState === 'baseline');

// These diagnostics can be resolved by/after private preparation. Every other
// blocker (including future plugin diagnostics) fails closed before freezing stock.
const preparationWorkflowBlockers = new Set([
    'feature_disabled', 'cutover_required', 'receiving_frozen', 'inputs_pending',
    'settings_not_synced_or_invalid', 'no_supported_enabled_shipping_mapping',
    'no_configured_products', 'no_eligible_configured_products', 'inbound_missing',
    'inbound_stale', 'inbound_unverified', 'inbound_unverified_or_unsupported', 'plugin_epoch_mismatch',
]);
export function preparationBlockReason(data: DeliveryReadiness | null): string | null {
    if (!data || !knownControl(data)) return 'Refresh readiness before preparing or resuming cutover.';
    const plugin = data.plugin;
    if (!plugin || plugin.schemaVersion !== 1 || plugin.protocolVersion !== 1 || !Array.isArray(plugin.blockers)
        || !plugin.blockers.every(code => typeof code === 'string') || typeof plugin.wooVersion !== 'string'
        || !/^[a-f0-9]{64}$/.test(plugin.environmentFingerprint ?? '') || !['classic', 'blocks'].includes(plugin.presentation ?? '')
        || !plugin.state || !Number.isInteger(plugin.state.revision) || typeof plugin.state.active !== 'boolean'
        || typeof plugin.state.mode !== 'string' || !['legacy', 'baseline', 'guarded'].includes(plugin.state.mode.toLowerCase())
        || !(plugin.state.epoch === null || typeof plugin.state.epoch === 'string')) {
        return 'Preparation unavailable: update or reconnect the companion plugin and obtain a valid Woo/presentation diagnostic before freezing receiving.';
    }
    if (data.freshnessPrerequisite?.ready !== true || data.blockers.includes('freshness_sql_prerequisite_missing')) {
        return 'Preparation unavailable: the server must verify the delivery SQL prerequisites. Ask your deployment operator to resolve the diagnostic, then refresh.';
    }
    if (data.inventoryCompatibility?.ready !== true) return 'Preparation unavailable: resolve the inventory compatibility diagnostic, then refresh.';
    const incompatible = [...plugin.blockers, ...data.blockers.filter(code => !preparationWorkflowBlockers.has(code))]
        .find(code => !code.startsWith('deactivate_old_delivery_plugin:'));
    if (incompatible) return `Preparation unavailable: resolve ${incompatible} before freezing or resuming receiving. Inventory review remains available below.`;
    if (data.unresolvedLegacyJobs !== 0 || data.unresolvedReceipts !== 0) return 'Resolve pending legacy review, receipts and BOM follow-up below before preparing cutover.';
    const safeResume = isCutoverRecovery(data) && data.actions?.resumeCutover === '/api/delivery-estimates/cutover';
    if ((data.work.action !== null || data.revalidationRequested) && !safeResume) {
        return 'Control work is pending. Wait and refresh; resume is available only when the server reports a safe parked retry.';
    }
    return null;
}

const guidance: Record<string, string> = {
    production_estimates_plugin_update_required: 'Update the Overseek WooCommerce plugin to use simple production and shipping estimates.',
    production_products_not_synced: 'Some product timings are still syncing or need attention. Other synced products can show estimates; you do not need to clear product or variant data to enable them.',
    no_eligible_configured_products: 'Waiting for saved product production times to publish. If none are set, add a production time to a product first.',
    plugin_control_unavailable_or_upgrade_required: 'Update the Overseek Woo companion plugin and check the store connection, then refresh readiness.',
    woocommerce_8_required: 'Upgrade WooCommerce to version 8 or newer.',
    blocks_woocommerce_9_9_required: 'Upgrade WooCommerce to 9.9 or newer for Blocks cart or checkout pages.',
    declare_classic_or_supported_blocks_checkout_pages: 'Configure both cart and checkout pages with explicit Woo classic shortcodes or supported Woo Blocks, then refresh readiness.',
    blocks_pickup_requires_verified_presentation: 'Verify supported Blocks pickup presentation before launch; review pickup configuration in WooCommerce.',
    feature_disabled: 'Ask a super admin to enable Delivery Estimates for this account. Disable and receipt recovery remain available.',
    cutover_required: 'Pause receiving, drain legacy work and restart pre-upgrade workers, then queue cutover below.',
    receiving_frozen: 'Receiving is frozen. Check cutover work and errors below; explicitly resume cutover after correcting the cause. Disable does not unfreeze receiving.',
    unresolved_receipts: 'An inventory manager must review unresolved receipts below.',
    legacy_jobs_not_drained: 'Review unfinished legacy jobs below. Pause receiving, drain/restart workers, verify corrected inventory and dependent BOM work, then submit an observation-backed attestation. Resume cutover once drained.',
    inputs_pending: 'Wait for queued settings, production and inbound inputs to sync, then refresh.',
    settings_not_synced_or_invalid: 'Save valid delivery settings and sync them using the sync panel.',
    no_supported_enabled_shipping_mapping: 'Configure an enabled supported shipping mapping. WBS/WBSNG needs exact or explicitly confirmed provider-wide mappings.',
    no_configured_products: 'Set production times on the products you want to show delivery estimates for.',
    inbound_missing: 'Sync production and supplier inputs, then refresh readiness.',
    inbound_stale: 'Refresh supplier inputs using the sync panel, then check freshness again.',
    inbound_unverified_or_unsupported: 'Resolve receipt work and certify supported stock owners. Unsupported products remain excluded.',
    plugin_epoch_mismatch: 'Check the store/account connection and cutover error, then explicitly resume cutover.',
    configured_products_excluded_unsupported_or_BOM: 'Unsupported products and BOM configurations are excluded from estimates; review product inventory ownership.',
    unsupported_shipping_mappings_excluded: 'Unsupported shipping mappings are excluded. Unmapped offered rates remain blank; review the shipping grid.',
    product_page_default_method_not_configured: 'Choose a product-page default shipping method if you want product-page estimates.',
};
export function launchGuidance(code: string) {
    if (code.startsWith('deactivate_old_delivery_plugin:')) return `Deactivate the old delivery plugin in WordPress: ${code.slice('deactivate_old_delivery_plugin:'.length)}. Then refresh readiness.`;
    return guidance[code] ?? 'Review this server diagnostic with your operator, then refresh. It cannot be bypassed here.';
}
