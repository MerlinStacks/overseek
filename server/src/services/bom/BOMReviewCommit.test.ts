import { expect, it, vi } from 'vitest';
import type { Job, Queue } from 'bullmq';
import { commitBOMReview, commitBOMReviewScript } from './BOMReviewCommit';

it('compares retained data, progress, occurrence identity and terminal sets in one Redis operation', async () => {
    const evalScript = vi.fn().mockResolvedValue(1);
    const defineCommand = vi.fn();
    const queue = { client: Promise.resolve({ runCommand: evalScript, defineCommand }), toKey: (suffix: string) => `bull:bom:${suffix}` } as unknown as Queue;
    const job = { id: 'bom_sync_account', data: { accountId: 'account' }, progress: { current: 4 }, timestamp: 100, processedOn: 120, finishedOn: 200, failedReason: 'lock lost', attemptsMade: 1 } as unknown as Job;
    const data = { ...job.data, bomReconciliation: { auditId: 'audit' } };
    expect(await commitBOMReview(queue, job, data)).toBe(true);
    expect(defineCommand).toHaveBeenCalledWith('overseekCommitBOMReviewV1', { numberOfKeys: 3, lua: commitBOMReviewScript });
    expect(evalScript).toHaveBeenCalledExactlyOnceWith('overseekCommitBOMReviewV1', [
        'bull:bom:bom_sync_account', 'bull:bom:failed', 'bull:bom:completed', 'bom_sync_account',
        JSON.stringify(job.data), JSON.stringify(job.progress), '100', '120', '200', 'lock lost', '1', JSON.stringify(data)]);
    evalScript.mockResolvedValue(0);
    expect(await commitBOMReview(queue, job, data)).toBe(false);
});
