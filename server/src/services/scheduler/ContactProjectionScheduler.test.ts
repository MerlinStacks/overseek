import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SchedulerService } from './SchedulerService';
import { MaintenanceScheduler } from './MaintenanceScheduler';
import { drainContactProjections, closeContactProjectionPool } from '../ContactProjection';

const queue = vi.hoisted(() => ({ add: vi.fn(), getRepeatableJobs: vi.fn().mockResolvedValue([]) }));
const worker = vi.hoisted(() => ({ run: null as any, close: vi.fn() }));
vi.mock('../queue/QueueFactory', () => ({ QUEUES: {}, QueueFactory: {
    createQueue: () => queue,
    createWorker: (_: string, run: any) => { worker.run = run; return worker; }
} }));
vi.mock('../../utils/logger', () => ({ Logger: { info: vi.fn(), warn: vi.fn() } }));
vi.mock('../JanitorService', () => ({ JanitorService: {} }));
vi.mock('./SyncScheduler', () => ({ SyncScheduler: { register: vi.fn() } }));
vi.mock('./MarketingScheduler', () => ({ MarketingScheduler: { register: vi.fn(), start: vi.fn(), stop: vi.fn() } }));
vi.mock('./MessageScheduler', () => ({ MessageScheduler: { start: vi.fn(), stop: vi.fn() } }));
vi.mock('./ShippingTrackingScheduler', () => ({ ShippingTrackingScheduler: { register: vi.fn() } }));
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
});
