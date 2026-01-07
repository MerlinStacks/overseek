

export interface ReportResult {
    dimension: string;
    sales?: number;
    orders?: number;
    aov?: number;
    quantity?: number;
    // Index signature to allow dynamic metric access
    [key: string]: string | number | undefined;
}

export interface ReportTemplate {
    id: string;
    name: string;
    type: 'CUSTOM' | 'SYSTEM' | 'SYSTEM_CLONE';
    config: {
        metrics: string[];
        dimension: string;
        dateRange: string;
    };
}

export interface LiveSession {
    id: string; // session ID
    visitorId: string;
    country: string | null;
    city: string | null;
    deviceType: string | null;
    os: string | null;
    browser: string | null;
    currentPath: string | null;
    lastActiveAt: string;
    cartValue: number;
    cartItems: any; // JSON
    referrer: string | null;
    utmSource: string | null;
    utmCampaign: string | null;
    customer?: {
        firstName?: string | null;
        lastName?: string | null;
        email?: string;
    } | null;
}
