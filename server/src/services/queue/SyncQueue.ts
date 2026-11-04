export interface SyncJobData {
    accountId: string;
    incremental?: boolean; // Default true
    wooOrderId?: number; // Targeted order fetch; must not advance the account sync checkpoint
    wooProductId?: number;
    wooCustomerId?: number;
    wooReviewId?: number;
    liveEvent?: 'purchase' | 'order_changed' | 'customer_changed' | 'review_changed';
    sourceEventId?: string;
    types?: string[]; // If generic "sync all" job
    page?: number; // For pagination recursion
    triggerSource?: 'SYSTEM' | 'MANUAL' | 'RETRY';
}

export interface SyncQueue {
    add(jobName: string, data: SyncJobData, options?: JobsOptions): Promise<void>;
    process(handler: (job: Job<SyncJobData>) => Promise<void>): void;
}
import type { Job, JobsOptions } from 'bullmq';

export function isTargetedSync(data: SyncJobData): boolean {
    return [data.wooOrderId, data.wooProductId, data.wooCustomerId, data.wooReviewId].some(id => id !== undefined);
}
