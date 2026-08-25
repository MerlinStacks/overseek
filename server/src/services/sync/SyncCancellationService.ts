import { UnrecoverableError } from 'bullmq';
import { redisClient } from '../../utils/redis';

const CANCELLATION_TTL_SECONDS = 60 * 60;

export class SyncCancellationService {
    private static key(queueName: string, jobId: string) {
        return `sync:cancel:${queueName}:${jobId}`;
    }

    static async request(queueName: string, jobId: string) {
        await redisClient.set(this.key(queueName, jobId), '1', 'EX', CANCELLATION_TTL_SECONDS);
    }

    static async clear(queueName: string, jobId: string) {
        await redisClient.del(this.key(queueName, jobId));
    }

    static async assertNotRequested(job?: { id?: string | number; queueName?: string }) {
        if (!job?.id || !job.queueName) return;
        if (await redisClient.get(this.key(job.queueName, String(job.id)))) {
            throw new UnrecoverableError('Cancelled by user');
        }
    }

    static isCancellation(error: unknown): boolean {
        return error instanceof UnrecoverableError && error.message === 'Cancelled by user';
    }
}
