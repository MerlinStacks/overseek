import { planSyntheticData, syntheticCli, type SyntheticOptions } from './syntheticDataSafety';
import type { PrismaClient } from '@prisma/client';
/** Read-only marker/version-bound reset plan. No automatic reseeding or search deletion. */
export const resetMockData = (options: SyntheticOptions, db: PrismaClient) => planSyntheticData('reset', db, options);
if (require.main === module) void syntheticCli('reset').catch(() => { console.error('Synthetic reset refused or failed; review scope, dependencies and approved dry-run digest.'); process.exitCode = 1; });
