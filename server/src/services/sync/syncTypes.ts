/** Shared types for WooCommerce sync services */

// BullMQ Job has updateProgress, isActive, attemptsMade
export interface SyncJob {
    updateProgress(progress: number): Promise<void>;
    isActive(): Promise<boolean>;
    attemptsMade?: number;
}

export interface WooApiResponse<T> {
    data: T[];
    total: number;
    totalPages: number;
}

export interface WooStoreSetting {
    id: string;
    label: string;
    description: string;
    tip: string;
    type: string;
    value: string;
    choices?: Record<string, string>;
    default: string;
}

export interface SeoData {
    focusKeyword?: string;
    analysis?: Array<{
        test: string;
        status: 'pass' | 'fail' | 'warning';
        message: string;
    }>;
    [key: string]: unknown;
}

export interface MerchantCenterIssue {
    type: 'error' | 'warning';
    message: string;
}

export interface ChatSettingsConfig {
    businessHours?: {
        enabled: boolean;
        offlineMessage?: string;
        days?: Record<string, {
            isOpen: boolean;
            open: string;
            close: string;
        }>;
    };
    [key: string]: unknown;
}
