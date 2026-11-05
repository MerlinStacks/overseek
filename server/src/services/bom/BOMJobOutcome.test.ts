import type { Job } from 'bullmq';
import { expect, it } from 'vitest';
import { hasUnsettledBOMProgress, requiresBOMJobReview } from './BOMJobOutcome';
import { bomExecutionFingerprint } from './BOMReconciliationEvidence';

it.each([
    { failed: 1 }, { failed: '1' }, { failed: -1 }, { failed: 'unknown' },
    { checkpoint: { inFlightIndex: 0 } }, { checkpoint: { uncertainIndexes: [0] } }
])('preserves uncertain completed work with progress %j', progress => {
    const job = { data: { accountId: 'a' }, progress } as unknown as Job;
    expect(hasUnsettledBOMProgress(job)).toBe(true);
    expect(requiresBOMJobReview(job, 'completed')).toBe(true);
});
it.each([0, { current: 2, total: 2, failed: 0 }, { checkpoint: { inFlightIndex: null, uncertainIndexes: [] } }])('allows genuinely completed normal work with progress %j', progress => {
    expect(requiresBOMJobReview({ data: {}, progress } as Job, 'completed')).toBe(false);
});
it('honors an occurrence-specific review but never bypasses active work', () => {
    const job = { data: { accountId: 'a' }, progress: { failed: 1 } } as unknown as Job;
    job.data.bomReconciliation = { auditId: 'audit', fingerprint: bomExecutionFingerprint(job) };
    expect(requiresBOMJobReview(job, 'completed')).toBe(false);
    expect(requiresBOMJobReview(job, 'active')).toBe(true);
});
