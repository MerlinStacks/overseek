export interface SyncJobData {
    accountId: string;
    incremental?: boolean; // Default true
    types?: string[]; // If generic "sync all" job
    page?: number; // For pagination recursion
    triggerSource?: 'SYSTEM' | 'MANUAL' | 'RETRY';
}

export interface SyncQueue {
    add(jobName: string, data: SyncJobData, options?: any): Promise<void>;
    process(handler: (job: any) => Promise<void>): void;
}
