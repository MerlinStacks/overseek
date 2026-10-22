import { planSyntheticData, syntheticCli, type SyntheticOptions } from './syntheticDataSafety';
import type { PrismaClient } from '@prisma/client';
/** Read-only planning. Never adopts a user/membership or returns/logs a password. */
export const setupMockAccount = (options: SyntheticOptions, db: PrismaClient) => planSyntheticData('setup', db, options);
if (require.main === module) void syntheticCli('setup').catch(() => { console.error('Synthetic account planning/application failed. Check explicit test scope and confirmation; secrets are not printed.'); process.exitCode = 1; });
