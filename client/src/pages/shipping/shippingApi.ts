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
    const baseMessage = body.error || body.message || fallback;
    const details = body.details;
    if (!details) return baseMessage;

    const fieldMessages = Object.entries(details.fieldErrors || {})
        .flatMap(([field, messages]) => (messages || []).map((message) => `${field}: ${message}`));
    const formMessages = details.formErrors || [];
    const allMessages = [...formMessages, ...fieldMessages].filter(Boolean);
    if (allMessages.length === 0) return baseMessage;

    return `${baseMessage}. ${allMessages.join('; ')}`;
}

export async function shippingFetch<T>(path: string, token: string, accountId: string, options: RequestInit = {}): Promise<T> {
    const res = await fetch(`/api/shipping${path}`, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
            'X-Account-ID': accountId,
            ...(options.headers || {}),
        },
    });

    if (!res.ok) {
        const contentType = (res.headers.get('content-type') || '').toLowerCase();
        let body: ShippingErrorBody = {};
        let textBody = '';

        if (contentType.includes('application/json')) {
            body = await res.json().catch(() => ({} as ShippingErrorBody));
        } else {
            textBody = (await res.text().catch(() => '')).trim();
            if (textBody) {
                try {
                    body = JSON.parse(textBody) as ShippingErrorBody;
                } catch {
                    // Keep plain text fallback.
                }
            }
        }

        const fallback = res.statusText || `Request failed (${res.status})`;
        const parsedMessage = formatShippingError(body, fallback);
        const finalMessage = (parsedMessage === 'Bad Request' || parsedMessage === fallback) && textBody
            ? textBody
            : parsedMessage;

        throw new Error(finalMessage || `Request failed (${res.status})`);
    }

    const ct = res.headers.get('content-type');
    if (ct && ct.includes('application/json')) return res.json();
    return {} as T;
}

export async function openShippingLabelPdf(labelId: string, token: string, accountId: string): Promise<() => void> {
    const res = await fetch(`/api/shipping/labels/${labelId}/pdf`, {
        headers: {
            Authorization: `Bearer ${token}`,
            'X-Account-ID': accountId,
        },
    });
    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to open label PDF');
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank', 'noopener,noreferrer');
    return () => URL.revokeObjectURL(url);
}

export const mmToCm = (value: number | null | undefined) => value != null ? value / 10 : '';
export const gramsToKg = (value: number | null | undefined) => value != null ? value / 1000 : '';
export const cmToMm = (value: string) => {
    const trimmed = value.trim();
    if (trimmed === '') return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? Math.ceil(n * 10) : null;
};
export const kgToGrams = (value: string) => {
    const trimmed = value.trim();
    if (trimmed === '') return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? Math.ceil(n * 1000) : null;
};
