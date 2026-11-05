import { z } from 'zod';

// A bounded, durable target snapshot. Counters alone are never a resume cursor.
export const MAX_BOM_SYNC_TARGETS = 10000;
export const bomTargetSchema = z.object({
    productId: z.string().min(1).max(128),
    variationId: z.number().int().nonnegative().max(2147483647)
}).strict();
export type BOMSyncTarget = z.infer<typeof bomTargetSchema>;
export const bomManifestSchema = z.object({
    version: z.literal(1),
    targets: z.array(bomTargetSchema).max(MAX_BOM_SYNC_TARGETS)
}).strict();
export const bomCheckpointSchema = z.object({
    version: z.literal(1),
    nextIndex: z.number().int().nonnegative(),
    inFlightIndex: z.number().int().nonnegative().nullable(),
    uncertainIndexes: z.array(z.number().int().nonnegative()).max(MAX_BOM_SYNC_TARGETS)
}).strict();
export type BOMSyncCheckpoint = z.infer<typeof bomCheckpointSchema>;
export const targetKey = (target: BOMSyncTarget) => JSON.stringify([target.productId, target.variationId]);

export function readBOMCheckpoint(data: unknown, progress: unknown) {
    const manifest = bomManifestSchema.safeParse((data as { bomManifest?: unknown } | null)?.bomManifest);
    const checkpoint = bomCheckpointSchema.safeParse((progress as { checkpoint?: unknown } | null)?.checkpoint);
    if (!manifest.success || !checkpoint.success) return null;
    const { targets } = manifest.data;
    const { nextIndex, inFlightIndex, uncertainIndexes } = checkpoint.data;
    if (new Set(targets.map(targetKey)).size !== targets.length || nextIndex > targets.length
        || (inFlightIndex !== null && (inFlightIndex !== nextIndex || inFlightIndex >= targets.length))
        || uncertainIndexes.some(index => index >= nextIndex)
        || new Set(uncertainIndexes).size !== uncertainIndexes.length) return null;
    return { targets, checkpoint: checkpoint.data };
}
