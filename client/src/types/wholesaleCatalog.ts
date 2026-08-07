export type WholesaleTaxBasis = 'INCLUSIVE' | 'EXCLUSIVE';
export type WholesaleProcess = 'ENGRAVE' | 'SUBLIMATE' | 'UV' | 'DTF' | 'EMBROIDERY';
export type WholesaleCatalogStatus = 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
export type WholesaleGenerationStatus = 'QUEUED' | 'RENDERING' | 'AWAITING_APPROVAL' | 'APPROVED' | 'FAILED' | 'CANCELLED' | 'EXPIRED';
export type WholesaleValidityArtifactStatus = 'CURRENT' | 'UPDATING' | 'FAILED';
export type WholesaleShareStatus = 'PREPARING' | 'READY' | 'ACTIVE' | 'LOCKED' | 'EXPIRED' | 'REVOKED' | 'FAILED';
export type WholesaleShareArtifactStatus = 'QUEUED' | 'RENDERING' | 'READY' | 'FAILED' | 'EXPIRED';

export interface WholesaleTermsSection {
    heading: string;
    content: string;
}

export interface WholesaleBrandingImportCandidates {
    logoUrls: string[];
    colors: string[];
    businessNames: string[];
    contactHints: string[];
}

export interface WholesaleTermsSummaryResult {
    suggestion?: WholesaleTermsSection;
    manualGuidance?: string;
}

export interface WholesalePriceTier {
    minimumQuantity: number;
    unitPrice: string | null;
    isPoa: boolean;
    rangeLabel?: string;
}

export interface WholesaleProductProfile {
    id?: string;
    notesDocument: string | null;
    personalisationTypes: WholesaleProcess[];
    imageUrl: string | null;
    priceTaxBasis: WholesaleTaxBasis;
    priceTiers: WholesalePriceTier[];
    priceSetVersion?: number;
}

export interface WholesaleReadiness {
    eligible: boolean;
    published: boolean;
    inStock: boolean;
    hasSku: boolean;
    hasImage: boolean;
    hasPriceTiers: boolean;
}

export interface WholesaleProductSummary {
    id: string;
    wooId: number;
    name: string;
    sku: string | null;
    imageUrl: string | null;
    mainImage?: string | null;
    categoryLabel?: string | null;
    rrp?: string | null;
    readiness: WholesaleReadiness;
    profile: WholesaleProductProfile | null;
}

export interface WholesaleCatalogInput {
    name: string;
    publicTitle: string;
    subtitle: string | null;
    coverText: string | null;
    pricesIncludeTax: boolean;
    supplementaryPriceNotice: string | null;
    brandingOverrides: Record<string, string | number | boolean | null | string[]>;
    paymentCallout: Record<string, string | number | boolean | null | string[]>;
    termsSections: WholesaleTermsSection[];
    footerDetails: Record<string, string | number | boolean | null | string[]>;
    status: WholesaleCatalogStatus;
}

export interface WholesaleCatalog extends WholesaleCatalogInput {
    id: string;
    defaultsVersion: string;
    createdAt: string;
    updatedAt: string;
    products?: Array<{
        id: string;
        productId: string;
        isSuspended: boolean;
        suspensionReason: string | null;
        categoryKey?: string | null;
        categoryLabel?: string | null;
        categorySortOrder?: number;
        product: WholesaleProductSummary;
    }>;
    _count?: { products: number; revisions: number; generations: number };
}

export interface WholesaleDefaults {
    id?: string | null;
    priceTaxBasis: WholesaleTaxBasis;
    gstRate: string;
    termsDocument: { sections: WholesaleTermsSection[] };
    confidentialityNotice: string;
    privacyNotice: string;
    setupChecklist: Array<{ key: string; label: string; completed: boolean }>;
    version?: string;
    approvedAt?: string | null;
    approvedById?: string | null;
}

export type WholesaleTaxImportSource = 'WOOCOMMERCE_SETTINGS' | 'WOOCOMMERCE_TAX_RATES' | 'ACCOUNT_REVENUE_TAX_SETTING' | 'DEFAULT_GST_RATE';

export interface WholesaleTaxImportCandidate {
    priceTaxBasis: WholesaleTaxBasis;
    gstRate: string;
    source: { priceTaxBasis: WholesaleTaxImportSource; gstRate: WholesaleTaxImportSource };
    warnings: string[];
}

export interface WholesaleBranding {
    id?: string | null;
    logoUrl: string | null;
    primaryColor: string | null;
    accentColor: string | null;
    headingFont: string | null;
    bodyFont: string | null;
    businessDetails: Record<string, string | number | boolean | null>;
    reviewedAt?: string | null;
}

export interface WholesaleRevision {
    id: string;
    revisionNumber: number;
    createdAt: string;
    createdById: string;
}

export interface WholesaleGenerationStaleReason {
    code: string;
    resourceType: string;
    resourceId?: string;
    changedAt: string;
}

export interface WholesaleCatalogGeneration {
    id: string;
    accountId: string;
    catalogId: string;
    requestedById: string;
    approvedById: string | null;
    retryOfId: string | null;
    status: WholesaleGenerationStatus;
    versionNumber: number | null;
    progressStage: string | null;
    progressPercent: number;
    cancelRequestedAt: string | null;
    fileSize: number | null;
    pageCount: number | null;
    productCount: number;
    errorMessage: string | null;
    startedAt: string | null;
    completedAt: string | null;
    approvedAt: string | null;
    approvalNote: string | null;
    effectiveDate: string;
    validUntil: string;
    originalGeneratedAt: string | null;
    validityArtifactStatus: WholesaleValidityArtifactStatus;
    validityRevision: number;
    staleAt: string | null;
    staleReasons: WholesaleGenerationStaleReason[] | null;
    expiresAt: string | null;
    createdAt: string;
    updatedAt: string;
    downloadable: boolean;
    warning: 'STALE' | 'EXPIRED' | null;
}

export interface WholesaleCustomerSearchResult {
    id: string;
    company: string;
    contact: string;
    email: string;
    phone: string;
}

export interface WholesaleShareCustomerSnapshot {
    company: string;
    contact: string;
    email: string;
    phone?: string;
    pageCount?: number;
    notificationsMuted?: boolean;
}

export interface WholesaleProductHistorySnapshot {
    priceTiers?: Array<{ minimumQuantity: number; unitPrice: string | null; isPoa: boolean }>;
    priceTaxBasis?: WholesaleTaxBasis;
    personalisationTypes?: WholesaleProcess[];
}

export interface WholesaleProductHistoryEvent {
    id: string;
    createdAt: string;
    details?: { old?: WholesaleProductHistorySnapshot | null; new?: WholesaleProductHistorySnapshot | null } | null;
    user?: { fullName?: string | null; email?: string | null; avatarUrl?: string | null } | null;
}

export interface WholesaleProductHistoryPage {
    events: WholesaleProductHistoryEvent[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
}

export interface WholesaleCatalogShare {
    id: string;
    catalogId: string;
    generationId: string;
    customerId: string | null;
    createdById: string;
    customerSnapshot: WholesaleShareCustomerSnapshot;
    status: WholesaleShareStatus;
    artifactStatus: WholesaleShareArtifactStatus;
    artifactError: string | null;
    personalizedFileName: string | null;
    expiresAt: string;
    activatedAt: string | null;
    revokedAt: string | null;
    lockedUntil: string | null;
    lastAccessedAt: string | null;
    emailedAt: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface WholesaleShareViewer {
    id: string;
    name: string;
    email: string;
    firstAccessedAt: string | null;
    lastAccessedAt: string | null;
    confidentialityAcceptedAt: string | null;
    createdAt: string;
}

export interface WholesaleShareSummary {
    uniquePages: number;
    completion: number;
    lastPage: number;
    viewerCount: number;
    deviceCount: number;
    sessionCount: number;
}

export interface WholesaleShareDetail {
    share: WholesaleCatalogShare;
    summary: WholesaleShareSummary;
    viewers: WholesaleShareViewer[];
}
