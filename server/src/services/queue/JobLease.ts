import type { Job } from 'bullmq';
import { QUEUE_LIMITS } from '../../config/limits';

export class JobLeaseLostError extends Error {
    constructor(cause?: unknown) {
        super('Job lock ownership could not be confirmed; stop stock writes and reconcile this occurrence', { cause });
        this.name = 'JobLeaseLostError';
    }
}

/** BullMQ's token-checked script only extends an existing lock owned by this
 * execution. It cannot acquire a missing lock or steal another worker's lock. */
export async function assertJobLease(job: Pick<Job, 'token' | 'extendLock'>): Promise<void> {
    if (!job.token) throw new JobLeaseLostError();
    try {
        if (await job.extendLock(job.token, QUEUE_LIMITS.LONG_RUNNING_LOCK_DURATION_MS) !== 1) throw new JobLeaseLostError();
    } catch (error) {
        if (error instanceof JobLeaseLostError) throw error;
        throw new JobLeaseLostError(error);
    }
}
