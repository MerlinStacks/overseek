import type {
    WholesaleBranding,
    WholesaleCatalog,
    WholesaleCatalogInput,
    WholesaleDefaults,
    WholesaleCatalogGeneration,
    WholesaleProductProfile,
    WholesaleProductSummary,
    WholesaleRevision,
    WholesaleCatalogShare,
    WholesaleCustomerSearchResult,
    WholesaleShareDetail,
    WholesaleBrandingImportCandidates,
    WholesaleTermsSection,
    WholesaleTermsSummaryResult,
    WholesaleTaxImportCandidate,
    WholesaleProductHistoryPage,
} from '../types/wholesaleCatalog';

const ROOT = '/api/wholesale-catalog';

export interface WholesaleApiClient {
    get<T>(endpoint: string): Promise<T>;
    post<T>(endpoint: string, data?: unknown): Promise<T>;
    put<T>(endpoint: string, data?: unknown): Promise<T>;
    patch<T>(endpoint: string, data?: unknown): Promise<T>;
    delete<T>(endpoint: string): Promise<T>;
    token?: string | null;
    accountId?: string;
}

async function getGenerationPdf(api: WholesaleApiClient, generationId: string, disposition: 'preview' | 'download') {
    if (!api.token || !api.accountId) throw new Error('Authentication and account context are required.');
    const response = await fetch(`${ROOT}/generations/${generationId}/${disposition}`, {
        headers: { Authorization: `Bearer ${api.token}`, 'X-Account-ID': api.accountId },
    });
    if (!response.ok) {
        let message = 'Unable to retrieve generated PDF.';
        try {
            const body = await response.json() as { error?: string; message?: string };
            message = body.error || body.message || message;
        } catch { /* The PDF route can return a non-JSON proxy error. */ }
        throw new Error(message);
    }
    return response.blob();
}

async function getSharePdf(api: WholesaleApiClient, shareId: string) {
    if (!api.token || !api.accountId) throw new Error('Authentication and account context are required.');
    const response = await fetch(`${ROOT}/shares/${shareId}/download`, {
        headers: { Authorization: `Bearer ${api.token}`, 'X-Account-ID': api.accountId },
    });
    if (!response.ok) {
        let message = 'Unable to retrieve customer-specific PDF.';
        try { message = (await response.json() as { error?: string }).error || message; } catch { /* Proxy errors may not be JSON. */ }
        throw new Error(message);
    }
    return response.blob();
}

export function createWholesaleCatalogService(api: WholesaleApiClient) {
    return {
        getProduct: (productId: string) => api.get<{ product: WholesaleProductSummary; profile: WholesaleProductProfile | null; readiness: WholesaleProductSummary['readiness'] }>(`${ROOT}/products/${productId}`),
        saveProduct: (productId: string, profile: WholesaleProductProfile, baseTurnaroundDays: number | null) => api.put<{ profile: WholesaleProductProfile }>(`${ROOT}/products/${productId}`, {
            baseTurnaroundDays,
            notesDocument: profile.notesDocument,
            personalisationTypes: profile.personalisationTypes,
            priceTiers: profile.priceTiers.map(tier => ({
                minimumQuantity: tier.minimumQuantity,
                unitPrice: tier.isPoa ? null : tier.unitPrice,
                isPoa: tier.isPoa,
                leadTimeDays: tier.leadTimeDays ?? null,
            })),
        }),
        getProductHistory: (productId: string, page = 1, limit = 10) => api.get<WholesaleProductHistoryPage>(`${ROOT}/products/${productId}/history?page=${page}&limit=${limit}`),
        listProducts: (eligibleOnly = true) => api.get<{ products: WholesaleProductSummary[]; total: number }>(`${ROOT}/products?limit=100&eligibleOnly=${eligibleOnly}`),
        getDefaults: () => api.get<{ defaults: WholesaleDefaults }>(`${ROOT}/defaults`),
        saveDefaults: (defaults: WholesaleDefaults) => api.put<{ defaults: WholesaleDefaults }>(`${ROOT}/defaults`, {
            priceTaxBasis: defaults.priceTaxBasis,
            gstRate: defaults.gstRate,
            termsDocument: defaults.termsDocument,
            confidentialityNotice: defaults.confidentialityNotice,
            privacyNotice: defaults.privacyNotice,
            setupChecklist: defaults.setupChecklist,
        }),
        approveDefaults: () => api.post<{ defaults: WholesaleDefaults }>(`${ROOT}/defaults/approve`),
        importTaxDefaults: () => api.post<{ candidate: WholesaleTaxImportCandidate }>(`${ROOT}/defaults/import-tax`),
        getBranding: () => api.get<{ branding: WholesaleBranding }>(`${ROOT}/branding`),
        saveBranding: (branding: WholesaleBranding) => api.put<{ branding: WholesaleBranding }>(`${ROOT}/branding`, {
            logoUrl: branding.logoUrl || null,
            primaryColor: branding.primaryColor || null,
            accentColor: branding.accentColor || null,
            headingFont: branding.headingFont || null,
            bodyFont: branding.bodyFont || null,
            businessDetails: branding.businessDetails,
        }),
        importBranding: () => api.post<{ candidates: WholesaleBrandingImportCandidates; sourceUrls: string[] }>(`${ROOT}/branding/import`),
        summarizeTerms: (section: WholesaleTermsSection, targetReduction = 25) => api.post<WholesaleTermsSummaryResult>(`${ROOT}/terms/summarize`, {
            heading: section.heading,
            content: section.content,
            targetReduction,
        }),
        listCatalogs: () => api.get<{ catalogs: WholesaleCatalog[]; total: number }>(`${ROOT}?limit=100`),
        getCatalog: (catalogId: string) => api.get<{ catalog: WholesaleCatalog }>(`${ROOT}/${catalogId}`),
        createCatalog: (input: WholesaleCatalogInput) => api.post<{ catalog: WholesaleCatalog }>(ROOT, input),
        updateCatalog: (catalogId: string, input: WholesaleCatalogInput) => api.put<{ catalog: WholesaleCatalog }>(`${ROOT}/${catalogId}`, input),
        applyDefaultTerms: (catalogId: string) => api.post<{ catalog: WholesaleCatalog }>(`${ROOT}/${catalogId}/apply-default-terms`),
        duplicateCatalog: (catalogId: string) => api.post<{ catalog: WholesaleCatalog }>(`${ROOT}/${catalogId}/duplicate`),
        deleteCatalog: (catalogId: string) => api.delete<void>(`${ROOT}/${catalogId}`),
        reconcileProducts: (catalogId: string, productIds: string[]) => api.put<{ catalog: WholesaleCatalog }>(`${ROOT}/${catalogId}/products`, { productIds }),
        listRevisions: (catalogId: string) => api.get<{ revisions: WholesaleRevision[] }>(`${ROOT}/${catalogId}/revisions`),
        restoreRevision: (catalogId: string, revisionId: string) => api.post<{ catalog: WholesaleCatalog }>(`${ROOT}/${catalogId}/revisions/${revisionId}/restore`),
        listGenerations: () => api.get<{ generations: WholesaleCatalogGeneration[] }>(`${ROOT}/generations`),
        getGeneration: (generationId: string) => api.get<{ generation: WholesaleCatalogGeneration }>(`${ROOT}/generations/${generationId}`),
        createGeneration: (catalogId: string, validUntil: string) => api.post<{ generation: WholesaleCatalogGeneration }>(`${ROOT}/${catalogId}/generations`, { validUntil }),
        cancelGeneration: (generationId: string) => api.post<{ generation: WholesaleCatalogGeneration }>(`${ROOT}/generations/${generationId}/cancel`),
        retryGeneration: (generationId: string) => api.post<{ generation: WholesaleCatalogGeneration }>(`${ROOT}/generations/${generationId}/retry`),
        approveGeneration: (generationId: string, note?: string) => api.post<{ generation: WholesaleCatalogGeneration }>(`${ROOT}/generations/${generationId}/approve`, note?.trim() ? { note: note.trim() } : {}),
        extendGenerationValidity: (generationId: string, validUntil: string) => api.post<{ generation: WholesaleCatalogGeneration; pendingValidUntil?: string }>(`${ROOT}/generations/${generationId}/extend-validity`, { validUntil }),
        previewGeneration: (generationId: string) => getGenerationPdf(api, generationId, 'preview'),
        downloadGeneration: (generationId: string) => getGenerationPdf(api, generationId, 'download'),
        searchCustomers: (query: string) => api.get<{ customers: WholesaleCustomerSearchResult[] }>(`${ROOT}/customers/search?q=${encodeURIComponent(query)}`),
        prepareShare: (generationId: string, customerId: string, expiresAt: string) => api.post<{ share: WholesaleCatalogShare }>(`${ROOT}/generations/${generationId}/shares/prepare`, { customerId, expiresAt }),
        listShares: (catalogId: string) => api.get<{ shares: WholesaleCatalogShare[] }>(`${ROOT}/catalog/${catalogId}/shares`),
        getShare: (shareId: string) => api.get<WholesaleShareDetail>(`${ROOT}/shares/${shareId}`),
        activateShare: (shareId: string, input: { password?: string; subject?: string; introduction?: string }) => api.post<{ url: string; password: string }>(`${ROOT}/shares/${shareId}/activate`, input),
        resendShare: (shareId: string, input: { password?: string; subject?: string; introduction?: string }) => api.post<{ url: string; password: string }>(`${ROOT}/shares/${shareId}/resend`, input),
        rotateSharePassword: (shareId: string, input: { password?: string } = {}) => api.post<{ url: string; password: string }>(`${ROOT}/shares/${shareId}/rotate-password`, input),
        setShareNotificationsMuted: (shareId: string, muted: boolean) => api.patch<{ share: WholesaleCatalogShare }>(`${ROOT}/shares/${shareId}/notifications`, { muted }),
        revokeShare: (shareId: string) => api.post<{ revoked: true }>(`${ROOT}/shares/${shareId}/revoke`),
        changeShareExpiry: (shareId: string, expiresAt: string) => api.patch<{ expiresAt: string }>(`${ROOT}/shares/${shareId}/expiry`, { expiresAt }),
        downloadShare: (shareId: string) => getSharePdf(api, shareId),
    };
}
