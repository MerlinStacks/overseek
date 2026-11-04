import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SchedulerService } from './SchedulerService';
import { MaintenanceScheduler } from './MaintenanceScheduler';
import { drainContactProjections, closeContactProjectionPool } from '../ContactProjection';
import { Logger } from '../../utils/logger';

const queue = vi.hoisted(() => ({ add: vi.fn(), getRepeatableJobs: vi.fn().mockResolvedValue([]), removeRepeatableByKey: vi.fn() }));
const worker = vi.hoisted(() => ({ run: null as any, close: vi.fn() }));
vi.mock('../queue/QueueFactory', () => ({ QUEUES: {}, QueueFactory: {
    createQueue: () => queue,
    createWorker: (_: string, run: any) => { worker.run = run; return worker; }
} }));
vi.mock('../../utils/logger', () => ({ Logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));
vi.mock('../JanitorService', () => ({ JanitorService: {} }));
vi.mock('./SyncScheduler', () => ({ SyncScheduler: { register: vi.fn() } }));
vi.mock('./MarketingScheduler', () => ({ MarketingScheduler: { register: vi.fn(), start: vi.fn(), stop: vi.fn() } }));
vi.mock('./MessageScheduler', () => ({ MessageScheduler: { start: vi.fn(), stop: vi.fn() } }));
vi.mock('../ContactProjection', () => ({ drainContactProjections: vi.fn(), closeContactProjectionPool: vi.fn() }));

describe('durable contact projection scheduling', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(MaintenanceScheduler, 'start').mockImplementation(() => {});
        vi.spyOn(MaintenanceScheduler, 'stop').mockImplementation(() => {});
    });

    it('registers periodic recovery independently of Woo sync and routes failures to BullMQ retry', async () => {
        await SchedulerService.start();
        expect(queue.add).toHaveBeenCalledWith('contact-projection-recovery', {}, {
            repeat: { every: 10000 }, jobId: 'contact-projection-recovery-10sec'
        });
        vi.mocked(drainContactProjections).mockRejectedValueOnce(new Error('ES offline'));
        await expect(worker.run({ name: 'contact-projection-recovery' })).rejects.toThrow('ES offline');
        vi.mocked(drainContactProjections).mockResolvedValueOnce(1);
        await worker.run({ name: 'contact-projection-recovery' });
        expect(drainContactProjections).toHaveBeenLastCalledWith(250);
        await SchedulerService.shutdown();
        expect(closeContactProjectionPool).toHaveBeenCalled();
    });
    it('removes only known obsolete schedules and safely no-ops an already queued significance job', async () => {
        queue.getRepeatableJobs.mockResolvedValueOnce([
            { name: 'experiment-significance-check', key: 'old-experiment' },
            { name: 'orchestrate-sync', key: 'keep-sync' },
            { name: 'unknown-new-job', key: 'keep-unknown' },
        ] as any);
        await SchedulerService.start();
        expect(queue.removeRepeatableByKey).toHaveBeenCalledExactlyOnceWith('old-experiment');
        await worker.run({ name: 'experiment-significance-check' });
        expect(Logger.warn).not.toHaveBeenCalled();
        await worker.run({ name: 'unknown-new-job' });
        expect(Logger.warn).toHaveBeenCalledWith('[Scheduler] Unknown job type: unknown-new-job');
        await SchedulerService.shutdown();
    });

    it('retires the old wholesale schedule and safely ignores already queued maintenance', async () => {
        queue.getRepeatableJobs.mockResolvedValueOnce([
            { name: 'wholesale-catalog-maintenance', key: 'legacy-wholesale' },
            { name: 'orchestrate-sync', key: 'keep-sync' },
        ] as any);
        await SchedulerService.start();
        expect(queue.removeRepeatableByKey).toHaveBeenCalledExactlyOnceWith('legacy-wholesale');
        expect(queue.add).not.toHaveBeenCalledWith('wholesale-catalog-maintenance', expect.anything(), expect.anything());
        await expect(worker.run({ name: 'wholesale-catalog-maintenance' })).resolves.toBeUndefined();
        expect(Logger.warn).not.toHaveBeenCalled();
        await SchedulerService.shutdown();
    });

    it('removes retired shipping schedules and makes already queued shipping jobs inert', async () => {
        queue.getRepeatableJobs.mockResolvedValueOnce([
            { name: 'shipping-tracking-poll', key: 'old-shipping-poll' },
            { name: 'shipping-label-storage-cleanup', key: 'old-shipping-cleanup' },
        ] as any);
        await SchedulerService.start();
        expect(queue.removeRepeatableByKey).toHaveBeenCalledWith('old-shipping-poll');
        expect(queue.removeRepeatableByKey).toHaveBeenCalledWith('old-shipping-cleanup');
        expect(queue.add.mock.calls.some(([name]) => name.startsWith('shipping-'))).toBe(false);
        await worker.run({ name: 'shipping-tracking-poll' });
        await worker.run({ name: 'shipping-label-storage-cleanup' });
        expect(Logger.warn).not.toHaveBeenCalled();
        await SchedulerService.shutdown();
    });
});
