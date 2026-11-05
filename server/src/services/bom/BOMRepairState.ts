import type { Job } from 'bullmq';
import { z } from 'zod';

export const bomRepairResultSchema = z.object({
    total: z.number().int().min(0).max(10000),
    checked: z.number().int().min(0).max(10000),
    repaired: z.number().int().min(0).max(10000),
    unchanged: z.number().int().min(0).max(10000),
    failed: z.number().int().min(0).max(10000),
    uncertainWrites: z.number().int().min(0).max(10000),
    issues: z.array(z.object({
        productId: z.string(), variationId: z.number().int(), name: z.string(), sku: z.string().nullable(), code: z.string(), message: z.string()
    })).max(10000),
    verified: z.boolean(),
    processedOn: z.number(),
    auditId: z.string().optional()
});
export type BOMRepairResult = z.infer<typeof bomRepairResultSchema>;

export function readBOMRepairResult(job: Job) {
    const result = bomRepairResultSchema.safeParse(job.data?.bomRepairResult);
    return result.success && result.data.processedOn === job.processedOn ? result.data : null;
}

/** Successful repair approval is valid only for this completed execution. */
export function isVerifiedBOMRepair(job: Job) {
    const result = readBOMRepairResult(job);
    return Boolean(job.data?.bomRepair && result?.verified && result.auditId && result.failed === 0
        && result.issues.length === 0 && result.uncertainWrites === 0 && result.checked === result.total
        && result.repaired + result.unchanged === result.total);
}
