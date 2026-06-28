export interface InvoiceGenerationIssue {
    orderId: number;
    statusCode: number;
    status?: string;
    message: string;
    invoiceRef?: string;
    retryAfterSeconds?: number;
}

export interface InvoiceGenerationResult {
    downloadUrl: string;
}

interface InvoiceGenerationPayload {
    artifact_download_url?: string;
    error?: string;
    status?: string;
    invoice_ref?: string;
    retry_after_seconds?: number;
}

export class InvoiceGenerationError extends Error {
    issue: InvoiceGenerationIssue;

    constructor(issue: InvoiceGenerationIssue) {
        super(issue.message);
        this.name = 'InvoiceGenerationError';
        this.issue = issue;
    }
}

export async function generateCanonicalInvoice(params: {
    orderId: number;
    token: string;
    accountId: string;
    forceRegenerate?: boolean;
    regenerateAttempt?: boolean;
}): Promise<InvoiceGenerationResult> {
    const res = await fetch(`/api/invoices/orders/${encodeURIComponent(String(params.orderId))}/generate`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${params.token}`,
            'X-Account-ID': params.accountId,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            forceRegenerate: params.forceRegenerate === true,
            regenerateAttempt: params.regenerateAttempt === true,
        })
    });

    const payload = await res.json().catch(() => null) as InvoiceGenerationPayload | null;
    if (!res.ok) {
        const retryAfterHeader = Number(res.headers.get('Retry-After'));
        throw new InvoiceGenerationError({
            orderId: params.orderId,
            statusCode: res.status,
            status: payload?.status,
            message: payload?.error || 'Failed to generate invoice',
            invoiceRef: payload?.invoice_ref,
            retryAfterSeconds: Number.isFinite(retryAfterHeader)
                ? retryAfterHeader
                : payload?.retry_after_seconds,
        });
    }

    const downloadUrl = String(payload?.artifact_download_url || '');
    if (!downloadUrl) {
        throw new InvoiceGenerationError({
            orderId: params.orderId,
            statusCode: res.status,
            status: payload?.status,
            message: 'Canonical invoice download URL missing',
            invoiceRef: payload?.invoice_ref,
        });
    }

    return { downloadUrl };
}
