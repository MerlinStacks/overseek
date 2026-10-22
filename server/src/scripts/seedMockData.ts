import { planSyntheticData, syntheticCli, type SyntheticOptions } from './syntheticDataSafety';
import type { PrismaClient } from '@prisma/client';
/** Read-only plan by default. Explicit --apply --confirm=DIGEST is required for fixture creation. */
export const seedMockData = (options: SyntheticOptions, db: PrismaClient) => planSyntheticData('seed', db, options);
if (require.main === module) void syntheticCli('seed').catch(() => { console.error('Synthetic seeding refused or failed; review scope, empty-dataset proof and dry-run digest.'); process.exitCode = 1; });
