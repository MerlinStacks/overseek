import { readBoundedBytes } from '../../utils/boundedResponse';
export interface ShippingPackagePreset {
    id: string;
    name: string;
    type: string;
    innerLengthMm: number | null;
    innerWidthMm: number | null;
    innerHeightMm: number | null;
    outerLengthMm: number;
    outerWidthMm: number;
    outerHeightMm: number;
    fallbackItemWeightGrams: number | null;
    forcedPackageWeightGrams: number | null;
    packagingWeightGrams: number;
    maxWeightGrams: number | null;
    selectionPriority: number;
    carrierProductCode: string | null;
    isDefault: boolean;
    isActive: boolean;
}

export interface ShippingSettingsResponse {
    credentialsConfigured: boolean;
    carrierAccount: null | {
        id: string;
        carrier: string;
        displayName: string;
        isEnabled: boolean;
        config?: Record<string, unknown>;
        senderAddress?: Record<string, unknown>;
        lastTestedAt?: string | null;
        lastTestStatus?: string | null;
    };
}

export interface ShippingItemOverride {
    id: string;
    wooProductId: number;
    wooVariationId: number | null;
    packagePresetId: string | null;
    weightGrams: number | null;
    lengthMm: number | null;
    widthMm: number | null;
    heightMm: number | null;
    packingMode: string;
    dangerousGoods: boolean;
    fragile: boolean;
    customsDescription: string | null;
    countryOfOrigin: string | null;
    hsCode: string | null;
    notes: string | null;
    packagePreset?: { id: string; name: string } | null;
}

export interface ShippingLabelRecord {
    id: string;
    wooOrderId: number;
    carrier: string;
    trackingNumber: string | null;
    trackingSyncedAt?: string | null;
    serviceName: string | null;
    status: string;
    labelFormat: string;
    labelFilePath?: string | null;
    labelStoredUntil: string | null;
    costAmount: string | number | null;
    costCurrency: string | null;
    printedAt: string | null;
    cancelledAt: string | null;
    errorMessage?: string | null;
    createdAt: string;
}

export interface ShippingCarrierTransaction {
    id: string;
    carrier: string;
    transactionId: string;
    transactionDate: string;
    reference: string | null;
    trackingNumber: string | null;
    serviceCode: string | null;
    serviceName: string | null;
    amount: string | number | null;
    taxAmount: string | number | null;
    currency: string | null;
    paymentMethod: string | null;
    status: string | null;
}

export interface ShippingPrintJobRecord {
    id: string;
    labelId: string;
    printStationId: string;
    printerName: string | null;
    status: string;
    attempts: number;
    errorMessage: string | null;
    requestedAt: string;
    pickedUpAt: string | null;
    printedAt: string | null;
    label?: { id: string; wooOrderId: number; trackingNumber: string | null; serviceName: string | null; labelStoredUntil: string | null };
    printStation?: { id: string; name: string; status: string; defaultPrinterName: string | null };
    reassignedFromStation?: { id: string; name: string } | null;
}

export interface ShippingAuditEventRecord {
    id: string;
    orderId: string | null;
    labelId: string | null;
    draftId: string | null;
    userId: string | null;
    eventType: string;
    beforeSnapshot?: Record<string, unknown> | null;
    afterSnapshot?: Record<string, unknown> | null;
    metadata?: Record<string, unknown> | null;
    createdAt: string;
    label?: { id: string; wooOrderId: number; trackingNumber: string | null } | null;
}

export interface ShippingPrintStation {
    id: string;
    name: string;
    status: string;
    agentVersion?: string | null;
    minimumSupportedVersion?: string | null;
    lastSeenAt?: string | null;
    lastErrorCode?: string | null;
    lastErrorMessage?: string | null;
    defaultPrinterName?: string | null;
}

export interface ShippingHubSummary {
    dispatchStatus: string;
    counts: {
        drafts: number;
        labels: number;
        packages: number;
        printStations: number;
    };
}

export interface ShippingMethodCandidatesResponse {
    shippingMethods: string[];
    sampledOrders: number;
}

export interface AusPostServiceCatalogResponse {
    services: Array<{ code: string; label: string }>;
    updatedAt: string;
    source?: 'live_account' | 'live_account_cached' | 'static_fallback';
    warning?: string;
}

export interface ShippingTrackingHealthSummary {
    status: 'healthy' | 'degraded' | 'attention';
    windowHours: number;
    activeTrackedLabels: number;
    staleTrackedLabels: number;
    recentPollFailures: number;
    recentAdapterUnavailable: number;
}

export interface ShippingDispatchOrder {
    order: {
        id: string;
        wooId: number;
        number: string;
        status: string;
        dateCreated: string;
        total: string | number;
        currency: string;
        customerName: string;
        email: string | null;
        itemCount: number;
        shipping: Record<string, string>;
        items?: Array<{
            id: number | null;
            name: string;
            sku: string | null;
            productId: number | null;
            variationId: number | null;
            quantity: number;
            total: string | null;
            metadata: Array<{ key: string; value: unknown }>;
        }>;
    };
    draft: {
        id: string;
        readinessStatus: string;
        readinessErrors?: Array<{ field: string; message: string }>;
        addressValidationStatus: string;
        addressValidationErrors: Array<{ field: string; message: string }>;
        correctedAddress?: Record<string, string> | null;
        selectedPackagePresetId?: string | null;
        manualOuterLengthMm?: number | null;
        manualOuterWidthMm?: number | null;
        manualOuterHeightMm?: number | null;
        manualWeightGrams?: number | null;
        selectedServiceCode?: string | null;
        selectedPrintStationId?: string | null;
        lastRateRequest?: Record<string, unknown> | null;
        lastRateResponse?: Record<string, unknown> | null;
        packageSelectionConfidence: string | null;
        packageSelectionReason: string | null;
    };
}

export interface ShippingBulkLabelResult {
    requested: number;
    succeeded: number;
    failed: number;
    results: Array<{ wooOrderId: number; ok: boolean; label?: ShippingLabelRecord; error?: string }>;
}

interface ShippingErrorDetails {
    fieldErrors?: Record<string, string[] | undefined>;
    formErrors?: string[];
}

interface ShippingErrorBody {
    error?: string;
    message?: string;
    details?: ShippingErrorDetails;
}

function formatShippingError(body: ShippingErrorBody, fallback: string): string {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return fallback;
    const baseMessage = body.error === 'Bad Request' && body.message
        ? body.message
        : body.error || body.message || fallback;
    const details = body && typeof body === 'object' && body.details && typeof body.details === 'object' ? body.details : undefined;
    if (!details) return baseMessage;

    const fieldMessages = Object.entries(details.fieldErrors || {})
        .slice(0, 20).flatMap(([field, messages]) => Array.isArray(messages) ? messages.filter(message => typeof message === 'string').slice(0, 5).map((message) => `${field}: ${message.slice(0, 200)}`) : []);
    const formMessages = Array.isArray(details.formErrors) ? details.formErrors.filter(message => typeof message === 'string').slice(0, 10) : [];
    const allMessages = [...formMessages, ...fieldMessages].filter(Boolean);
    if (allMessages.length === 0) return baseMessage;

    return `${baseMessage}. ${allMessages.join('; ')}`;
}

export class ShippingRequestError extends Error {
    constructor(message: string, public statusCode: number, public uncertain: boolean) { super(message); this.name = 'ShippingRequestError'; }
}
export async function shippingFetch<T>(path: string, token: string, accountId: string, options: RequestInit = {}): Promise<T> {
    try { return await shippingRequest<T>(path, token, accountId, options); }
    catch (error) {
        const status = typeof (error as { statusCode?: number })?.statusCode === 'number' ? (error as { statusCode: number }).statusCode : 0;
        const message = (error as Error)?.message;
        const safeMessage = typeof message === 'string' && (status !== 0 || /^(Invalid shipping request scope|Shipping authority headers cannot be overridden|Shipping JSON acknowledgement unavailable)$/.test(message)) ? message.slice(0, 1000) : 'Shipping JSON/transport acknowledgement unavailable';
        throw new ShippingRequestError(safeMessage, status, !!options.method && !['GET', 'HEAD'].includes(options.method.toUpperCase()) && ![400, 401, 403, 404, 410, 422].includes(status));
    }
}
async function shippingRequest<T>(path: string, token: string, accountId: string, options: RequestInit = {}): Promise<T> {
    if (!/^\/[a-zA-Z0-9/_?=&%.-]*$/.test(path) || path.startsWith('//') || path.includes('..') || /%2[fFeE]|%5[cC]/i.test(path) || !token || !accountId) throw new Error('Invalid shipping request scope');
    const headers = new Headers(options.headers);
    if (headers.has('Authorization') || headers.has('X-Account-ID')) throw new Error('Shipping authority headers cannot be overridden');
    const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000);
    const hasBody = options.body != null;
    const res = await fetch(`/api/shipping${path}`, {
        ...options,
        signal,
        redirect: 'error',
        headers: {
            Authorization: `Bearer ${token}`,
            'X-Account-ID': accountId,
            ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
            ...Object.fromEntries(headers.entries()),
        },
    });

    if (!res.ok) {
        const contentType = (res.headers.get('content-type') || '').toLowerCase();
        let body: ShippingErrorBody = {};
    const textBody = '';

        if (contentType.includes('application/json')) {
            try { body = JSON.parse(new TextDecoder().decode(await readBoundedBytes(res, 64000))); } catch { body = {}; }
        } else {
            await res.body?.cancel().catch(() => undefined);
        }

        const fallback = res.statusText || `Request failed (${res.status})`;
        const parsedMessage = formatShippingError(body, fallback);
        const finalMessage = (parsedMessage === 'Bad Request' || parsedMessage === fallback) && textBody
            ? textBody
            : parsedMessage;

        throw Object.assign(new Error(typeof finalMessage === 'string' ? finalMessage.slice(0, 1000) : `Request failed (${res.status})`), { statusCode: res.status, uncertain: options.method !== undefined && !['GET', 'HEAD'].includes(options.method.toUpperCase()) });
    }

    const ct = res.headers.get('content-type');
    if (!ct?.includes('application/json')) { await res.body?.cancel().catch(() => undefined); throw new Error('Shipping JSON acknowledgement unavailable'); }
    return JSON.parse(new TextDecoder().decode(await readBoundedBytes(res, 4 * 1024 * 1024))) as T;
}

export async function openShippingLabelPdf(labelId: string, token: string, accountId: string): Promise<() => void> {
    if (!/^[a-zA-Z0-9-]{1,200}$/.test(labelId) || !token || !accountId) throw new Error('Invalid label scope');
    const res = await fetch(`/api/shipping/labels/${labelId}/pdf`, {
        signal: AbortSignal.timeout(30000), redirect: 'error',
        headers: {
            Authorization: `Bearer ${token}`,
            'X-Account-ID': accountId,
        },
    });
    if (!res.ok) {
        await res.body?.cancel().catch(() => undefined);
        throw new Error('Label PDF request was not acknowledged');
    }
    if (!res.headers.get('content-type')?.toLowerCase().startsWith('application/pdf')) { await res.body?.cancel().catch(() => undefined); throw new Error('PDF type unavailable'); }
    const bytes = await readBoundedBytes(res, 10 * 1024 * 1024);
    if (new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-') throw new Error('PDF signature unavailable');
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    // Deliberate review/save panel instead of a post-fetch popup or automatic print.
    const panel = document.createElement('section'); panel.setAttribute('role', 'status');
    panel.style.cssText = 'position:fixed;bottom:1rem;left:1rem;right:1rem;z-index:9999;background:#0f172a;color:white;padding:1rem';
    const link = document.createElement('a'); link.href = url; link.download = `shipping-label-${labelId}.pdf`; link.textContent = 'Save prepared label PDF (no print requested)';
    const close = document.createElement('button'); close.type = 'button'; close.textContent = 'Dismiss PDF';
    let disposed = false;
    const dispose = () => { if (disposed) return; disposed = true; clearTimeout(timer); window.removeEventListener('pagehide', dispose); panel.remove(); URL.revokeObjectURL(url); };
    close.onclick = dispose; panel.append(link, close); document.body.appendChild(panel); window.addEventListener('pagehide', dispose, { once: true }); const timer = setTimeout(dispose, 120000);
    return dispose;
}

export const mmToCm = (value: number | null | undefined) => value == null ? '' : Number.isSafeInteger(value) && value >= 0 && value <= 10000000 ? value / 10 : (() => { throw new Error('Invalid stored millimetres'); })();
export const gramsToKg = (value: number | null | undefined) => value == null ? '' : Number.isSafeInteger(value) && value >= 0 && value <= 10000000 ? value / 1000 : (() => { throw new Error('Invalid stored grams'); })();
export const cmToMm = (value: string) => {
    const trimmed = value.trim();
    if (trimmed === '') return null;
    if (!/^\d+(?:\.\d)?$/.test(trimmed) || Number(trimmed) > 1000000) throw new Error('Use nonnegative centimetres with at most one decimal');
    return Math.round(Number(trimmed) * 10);
};
export const kgToGrams = (value: string) => {
    const trimmed = value.trim();
    if (trimmed === '') return null;
    if (!/^\d+(?:\.\d{1,3})?$/.test(trimmed) || Number(trimmed) > 10000) throw new Error('Use nonnegative kilograms with at most three decimals');
    return Math.round(Number(trimmed) * 1000);
};
