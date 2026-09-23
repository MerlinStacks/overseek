import { z } from 'zod';

/** Only constants cross the remote error boundary. Never store upstream prose. */
export const diagnosticMessages = {
    schema_invalid: 'Delivery input schema is invalid.',
    inbound_expired: 'Inbound input expired; rebuild from current sources.',
    inbound_generated_in_future: 'Inbound generation time is in the future.',
    inbound_ttl_invalid: 'Inbound freshness interval is invalid.',
    product_missing: 'The product is missing from WooCommerce.',
    product_type_unsupported: 'The product type is unsupported.',
    variation_missing: 'A variation is missing from WooCommerce.',
    variation_parent_mismatch: 'A variation belongs to a different product.',
    stock_owner_mismatch: 'The stock owner differs from WooCommerce.',
    owner_pool_batches_mismatch: 'Shared stock owner batches differ.',
    production_range_invalid: 'The production range is invalid.',
    supplier_lead_invalid: 'The supplier lead time is invalid.',
    payload_limits_exceeded: 'Delivery input exceeds payload limits.',
    variant_supplier_leads_required: 'Update the plugin to support different supplier leads sharing a stock owner.',
    inbound_capability_required: 'Update the plugin for inbound inputs.',
    configuration_capability_required: 'Update the Overseek WooCommerce plugin.',
    capabilities_invalid: 'Invalid delivery capabilities.',
    authorization_unavailable: 'Delivery authorization unavailable.',
    acknowledgement_invalid: 'Invalid delivery acknowledgement.',
    revision_conflict: 'Delivery input revision conflicts with stored input.',
    stale_proof: 'Receipt proof changed; rebuild inbound input.',
    remote_rejection: 'Delivery input was rejected.',
    transport_unavailable: 'Delivery transport unavailable.',
} as const;
type Reason = keyof typeof diagnosticMessages;
const remoteReasons = new Set<Reason>(['schema_invalid', 'inbound_expired', 'inbound_generated_in_future', 'inbound_ttl_invalid', 'product_missing', 'product_type_unsupported', 'variation_missing', 'variation_parent_mismatch', 'stock_owner_mismatch', 'owner_pool_batches_mismatch', 'production_range_invalid', 'supplier_lead_invalid', 'payload_limits_exceeded']);
const codes: Record<string, Reason | null> = {
    overseek_delivery_forbidden: 'authorization_unavailable',
    overseek_delivery_account_invalid: 'authorization_unavailable',
    overseek_delivery_account_unlinked: 'authorization_unavailable',
    overseek_delivery_woocommerce_unavailable: 'transport_unavailable',
    overseek_delivery_discovery_failed: 'transport_unavailable',
    overseek_delivery_account_required: 'authorization_unavailable',
    overseek_delivery_account_mismatch: 'authorization_unavailable',
    overseek_delivery_input_too_large: 'payload_limits_exceeded',
    // Older plugins used this for every validation failure; no precise reason is implied.
    overseek_delivery_input_invalid: null,
    overseek_delivery_revision_conflict: 'revision_conflict',
    overseek_delivery_stale_proof: 'stale_proof',
    overseek_delivery_storage_failed: 'transport_unavailable',
    rest_no_route: 'configuration_capability_required',
    rest_forbidden: 'authorization_unavailable',
    rest_not_logged_in: 'authorization_unavailable',
    rest_cookie_invalid_nonce: 'authorization_unavailable',
    woocommerce_rest_authentication_error: 'authorization_unavailable',
    woocommerce_rest_cannot_view: 'authorization_unavailable',
    woocommerce_rest_cannot_create: 'authorization_unavailable',
    woocommerce_rest_cannot_edit: 'authorization_unavailable',
    woocommerce_rest_cannot_update: 'authorization_unavailable',
};
const reasonSchema = z.enum(Object.keys(diagnosticMessages) as [Reason, ...Reason[]]);
const diagnosticSchema = z.object({
    source: z.enum(['local', 'remote']), phase: z.enum(['capabilities', 'inputs']),
    disposition: z.enum(['record_rejection', 'account_suppression']),
    attemptedRevision: z.string().regex(/^\d{1,20}$/).nullable(), occurredAt: z.string().datetime(),
    httpStatus: z.number().int().min(100).max(599).nullable(),
    code: z.string().max(100).refine(code => Object.hasOwn(codes, code)).nullable(),
    reason: reasonSchema.nullable(), message: z.string().max(200),
}).strict();
export type InputDiagnostic = z.infer<typeof diagnosticSchema>;
const suppressionMessage = (reason: Reason | null) => `Previously suppressed by an account-level decision: ${diagnosticMessages[reason ?? 'remote_rejection']}`;
export function readInputDiagnostic(value: unknown): InputDiagnostic | null {
    const result = diagnosticSchema.safeParse(value);
    if (!result.success) return null;
    const diagnostic = result.data;
    if (diagnostic.message !== diagnosticMessages[diagnostic.reason ?? 'remote_rejection'] &&
        !(diagnostic.disposition === 'account_suppression' && diagnostic.attemptedRevision === null && diagnostic.message === suppressionMessage(diagnostic.reason))) return null;
    return result.data;
}
export function historicalInputSuppression(diagnostic: InputDiagnostic): InputDiagnostic {
    return { ...diagnostic, disposition: 'account_suppression', attemptedRevision: null, message: suppressionMessage(diagnostic.reason) };
}
export function localInputDiagnostic(reason: Reason, phase: InputDiagnostic['phase'], revision: bigint | null, accountWide = false): InputDiagnostic {
    return { source: 'local', phase, disposition: accountWide ? 'account_suppression' : 'record_rejection', attemptedRevision: revision?.toString() ?? null,
        occurredAt: new Date().toISOString(), httpStatus: null, code: null, reason, message: diagnosticMessages[reason] };
}
export function remoteInputDiagnostic(error: unknown, phase: InputDiagnostic['phase'], revision: bigint, accountWide: boolean): InputDiagnostic {
    const response = (error as { response?: { status?: unknown; data?: { code?: unknown; data?: { reason?: unknown } } } })?.response;
    const rawCode = response?.data?.code;
    const code = typeof rawCode === 'string' && Object.hasOwn(codes, rawCode) ? rawCode : null;
    const rawReason = response?.data?.data?.reason;
    const httpStatus = typeof response?.status === 'number' && Number.isInteger(response.status) && response.status >= 100 && response.status <= 599 ? response.status : null;
    const reason = typeof rawReason === 'string' && remoteReasons.has(rawReason as Reason) ? rawReason as Reason : code ? codes[code] : httpStatus ? null : 'transport_unavailable';
    return { source: 'remote', phase, disposition: accountWide ? 'account_suppression' : 'record_rejection', attemptedRevision: revision.toString(), occurredAt: new Date().toISOString(),
        httpStatus, code, reason, message: diagnosticMessages[reason ?? (httpStatus ? 'remote_rejection' : 'transport_unavailable')] };
}

export function inboundExpired(scope: string, payload: unknown, now = new Date()) {
    if (scope !== 'inbound' || !payload || typeof payload !== 'object') return false;
    const expires = (payload as { expiresAt?: unknown }).expiresAt;
    return typeof expires === 'string' && Number.isFinite(Date.parse(expires)) && Date.parse(expires) <= now.getTime();
}

/** Remote freshness is evidence only for the exact attempted input revision.
 * Callers use this for explicitly requeued work; rejection itself remains blocked. */
export function inboundNeedsRebuild(row: { scope: string; payload: unknown; desiredRevision: bigint; lastDiagnostic: unknown }, now = new Date()) {
    if (inboundExpired(row.scope, row.payload, now)) return true;
    const diagnostic = readInputDiagnostic(row.lastDiagnostic);
    return row.scope === 'inbound' && diagnostic?.source === 'remote' && diagnostic.phase === 'inputs' &&
        diagnostic.disposition === 'record_rejection' && diagnostic.reason === 'inbound_expired' && diagnostic.attemptedRevision === row.desiredRevision.toString();
}

/** Suppressed siblings were not individually sent. Bind their historical account
 * decision internally to a desired revision without inventing attemptedRevision. */
export function readRowInputDiagnostic(value: unknown, revision: bigint): InputDiagnostic | null {
    const stored = z.object({ revision: z.string().regex(/^\d{1,20}$/), diagnostic: z.unknown() }).strict().safeParse(value);
    if (stored.success) {
        const diagnostic = readInputDiagnostic(stored.data.diagnostic);
        return stored.data.revision === revision.toString() && diagnostic?.disposition === 'account_suppression' && diagnostic.attemptedRevision === null ? diagnostic : null;
    }
    const diagnostic = readInputDiagnostic(value);
    return diagnostic?.attemptedRevision === revision.toString() ? diagnostic : null;
}

/** Older plugins compare supplier leads across a shared owner pool. */
export function requiresVariantSupplierLeads(payload: unknown) {
    const targets = (payload as { targets?: unknown } | null)?.targets;
    if (!Array.isArray(targets)) return false;
    const owners = new Map<number, string>();
    for (const target of targets) {
        if (!target || !Number.isSafeInteger(target.stockOwnerWooId)) continue;
        const lead = JSON.stringify(target.supplierLead == null ? null : { min: target.supplierLead.min, max: target.supplierLead.max });
        if (owners.has(target.stockOwnerWooId) && owners.get(target.stockOwnerWooId) !== lead) return true;
        owners.set(target.stockOwnerWooId, lead);
    }
    return false;
}
