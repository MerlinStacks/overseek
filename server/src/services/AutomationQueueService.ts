import { QueueFactory, QUEUES } from './queue/QueueFactory';
import { Logger } from '../utils/logger';

interface EnqueueEnrollmentOptions {
    enrollmentId: string;
    runAt?: Date | null;
}

export class AutomationQueueService {
    private queue = QueueFactory.getQueue(QUEUES.AUTOMATIONS);

    async enqueueEnrollment({ enrollmentId, runAt }: EnqueueEnrollmentOptions): Promise<void> {
        // Preserve the persisted schedule even when it is already due. The ticker may
        // discover the same enrollment more than once; a stable job id lets BullMQ
        // deduplicate those enqueue attempts instead of running duplicate actions.
        const targetRunAt = runAt || new Date();
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
