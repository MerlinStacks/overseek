import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    lock: vi.fn(), findFirst: vi.fn(), update: vi.fn(), count: vi.fn(), create: vi.fn(), settings: vi.fn()
}));
vi.mock('../utils/prisma', () => ({ prisma: {
    $transaction: (run: any) => run({
        $executeRaw: mocks.lock,
        emailLog: { findFirst: mocks.findFirst, update: mocks.update },
        emailSendAttempt: { count: mocks.count, create: mocks.create },
        emailSettings: { upsert: mocks.settings }
    })
} }));
import { classifySendFailure, reserveEmailSend } from './emailSendLifecycle';

describe('email capacity reservation', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        mocks.findFirst.mockResolvedValue({ status: 'QUEUED' });
        mocks.settings.mockResolvedValue({ maxSendPerDay: 10, maxSendPerSecond: 1 });
        mocks.count.mockResolvedValue(0);
    });

    it('takes the shared lock before reading capacity and records an attempt before releasing it', async () => {
        await expect(reserveEmailSend('a', 'mail', true)).resolves.toBeNull();
        expect(mocks.lock.mock.calls[0][1]).toBe('email-send:a');
        expect(mocks.lock.mock.invocationCallOrder[0]).toBeLessThan(mocks.count.mock.invocationCallOrder[0]);
        expect(mocks.update).toHaveBeenCalledWith({ where: { id: 'mail' }, data: expect.objectContaining({ status: 'SENDING', canRetry: false }) });
        expect(mocks.create).toHaveBeenCalledWith({ data: expect.objectContaining({ accountId: 'a', emailLogId: 'mail' }) });
    });

    it('defers daily exhaustion to the next UTC day without consuming another attempt', async () => {
        mocks.count.mockResolvedValueOnce(10);
        const retryAt = await reserveEmailSend('a', 'mail', true);
        expect(retryAt!.getTime()).toBeGreaterThan(Date.now());
        expect(retryAt!.getUTCHours()).toBe(0);
        expect(mocks.create).not.toHaveBeenCalled();
        expect(mocks.update).not.toHaveBeenCalled();
    });

    it('counts retry attempts for the per-second limit', async () => {
        mocks.findFirst.mockResolvedValue({ status: 'PENDING_RETRY' });
        mocks.count.mockResolvedValueOnce(5).mockResolvedValueOnce(1);
        const retryAt = await reserveEmailSend('a', 'mail', true);
        expect(retryAt!.getTime()).toBeGreaterThan(Date.now());
        expect(mocks.create).not.toHaveBeenCalled();
    });

    it('refuses to reserve an email already claimed by another worker', async () => {
        mocks.findFirst.mockResolvedValue({ status: 'SENDING' });
        await expect(reserveEmailSend('a', 'mail', true)).rejects.toThrow('already claimed');
        expect(mocks.create).not.toHaveBeenCalled();
    });

    it('lets transactional email through while recording its capacity use', async () => {
        await expect(reserveEmailSend('a', 'mail', false)).resolves.toBeNull();
        expect(mocks.count).not.toHaveBeenCalled();
        expect(mocks.create).toHaveBeenCalledOnce();
    });
});

describe('delivery ambiguity', () => {
    it.each([
        [{ responseCode: 421 }, 'FAILED', true],
        [{ responseCode: 550 }, 'FAILED', false],
        [{ code: 'EAUTH' }, 'FAILED', false],
        [{ code: 'ETIMEDOUT', command: 'CONN' }, 'FAILED', true],
        [{ code: 'ETIMEDOUT', command: 'DATA' }, 'UNKNOWN', false],
        [{ code: 'ECONNECTION' }, 'UNKNOWN', false],
        [{ deliveryUnknown: true, responseCode: 451 }, 'UNKNOWN', false]
    ])('classifies %j conservatively', (error, status, canRetry) => {
        expect(classifySendFailure(error)).toEqual({ status, canRetry });
    });
});
