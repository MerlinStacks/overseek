import { expect, it, vi } from 'vitest';
import { assertJobLease, JobLeaseLostError } from './JobLease';
import { QUEUE_LIMITS } from '../../config/limits';
it('uses the current token to verify and renew only the existing lock', async () => {
    const extendLock = vi.fn().mockResolvedValue(1);
    await assertJobLease({ token: 'owned-token', extendLock });
    expect(extendLock).toHaveBeenCalledExactlyOnceWith('owned-token', QUEUE_LIMITS.LONG_RUNNING_LOCK_DURATION_MS);
});
it('fails closed on a missing token, expired/stolen lock or Redis outage without retrying', async () => {
    const extendLock = vi.fn().mockResolvedValue(0);
    await expect(assertJobLease({ extendLock })).rejects.toBeInstanceOf(JobLeaseLostError);
    expect(extendLock).not.toHaveBeenCalled();
    await expect(assertJobLease({ token: 'old-token', extendLock })).rejects.toBeInstanceOf(JobLeaseLostError);
    expect(extendLock).toHaveBeenCalledOnce();
    extendLock.mockRejectedValueOnce(new Error('Redis unavailable'));
    await expect(assertJobLease({ token: 'old-token', extendLock })).rejects.toMatchObject({ cause: expect.objectContaining({ message: 'Redis unavailable' }) });
    expect(extendLock).toHaveBeenCalledTimes(2);
});
