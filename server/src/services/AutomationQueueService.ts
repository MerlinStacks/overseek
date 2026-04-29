import { QueueFactory, QUEUES } from './queue/QueueFactory';
import { Logger } from '../utils/logger';

interface EnqueueEnrollmentOptions {
    enrollmentId: string;
    runAt?: Date | null;
}

export class AutomationQueueService {
    private queue = QueueFactory.getQueue(QUEUES.AUTOMATIONS);

    async enqueueEnrollment({ enrollmentId, runAt }: EnqueueEnrollmentOptions): Promise<void> {
        const targetRunAt = runAt && runAt > new Date() ? runAt : new Date();
        const delay = Math.max(0, targetRunAt.getTime() - Date.now());
        const jobId = `automation-enrollment:${enrollmentId}:${targetRunAt.getTime()}`;

        await this.queue.add(
            'process-enrollment',
            {
                enrollmentId,
                scheduledFor: targetRunAt.toISOString()
            },
            {
                jobId,
                delay
            }
        );

        Logger.debug('[AutomationQueueService] Enqueued automation enrollment', {
            enrollmentId,
            runAt: targetRunAt.toISOString(),
            delay,
            jobId
        });
    }
}

export const automationQueueService = new AutomationQueueService();
