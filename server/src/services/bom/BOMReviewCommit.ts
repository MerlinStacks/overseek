import type { Job, Queue } from 'bullmq';

// A stale Job.updateData() can overwrite a NEW occurrence at the same reusable ID.
// Compare the exact retained Redis evidence and terminal membership atomically.
export const commitBOMReviewScript = `
if redis.call('EXISTS', KEYS[1] .. ':lock') == 1 then return 0 end
if not redis.call('ZSCORE', KEYS[2], ARGV[1]) and not redis.call('ZSCORE', KEYS[3], ARGV[1]) then return 0 end
local fields = {'data', 'progress', 'timestamp', 'processedOn', 'finishedOn', 'failedReason'}
local defaults = {'{}', '0', '', '', '', ''}
for i, field in ipairs(fields) do
    if (redis.call('HGET', KEYS[1], field) or defaults[i]) ~= ARGV[i + 1] then return 0 end
end
local attempts = redis.call('HGET', KEYS[1], 'atm') or redis.call('HGET', KEYS[1], 'attemptsMade') or '0'
if attempts ~= ARGV[8] then return 0 end
redis.call('HSET', KEYS[1], 'data', ARGV[9])
return 1
`;

export async function commitBOMReview(queue: Queue, job: Job, data: Job['data']) {
    const client = await queue.client;
    client.defineCommand('overseekCommitBOMReviewV1', { numberOfKeys: 3, lua: commitBOMReviewScript });
    return await client.runCommand('overseekCommitBOMReviewV1', [
        queue.toKey(String(job.id)), queue.toKey('failed'), queue.toKey('completed'), String(job.id),
        JSON.stringify(job.data ?? {}), JSON.stringify(job.progress ?? 0),
        String(job.timestamp ?? ''), String(job.processedOn ?? ''), String(job.finishedOn ?? ''),
        job.failedReason ?? '', String(job.attemptsMade ?? 0), JSON.stringify(data)]) === 1;
}
