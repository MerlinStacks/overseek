/**
 * Migration script to revoke all existing refresh tokens.
 * 
 * WHY: We migrated from storing plaintext refresh tokens to SHA-256 hashed tokens.
 *      Existing tokens in the database are plaintext and cannot be matched against
 *      incoming hashed tokens. This script revokes all existing sessions, forcing
 *      all users to re-login and receive new (properly hashed) tokens.
 * 
 * USAGE: npx ts-node scripts/revoke-all-sessions.ts
 */

import { prisma } from '../utils/prisma';
import { Logger } from '../utils/logger';

async function main() {
    console.log('=== Session Migration: Revoke All Refresh Tokens ===');
    console.log('This is required after migrating to hashed token storage.\n');

    const count = await prisma.refreshToken.count({
        where: { revokedAt: null }
    });

    console.log(`Found ${count} active refresh tokens to revoke.`);

    if (count === 0) {
        console.log('No active tokens to revoke. Done.');
        return;
    }

    const result = await prisma.refreshToken.updateMany({
        where: { revokedAt: null },
        data: { revokedAt: new Date() }
    });

    console.log(`\n✅ Successfully revoked ${result.count} refresh tokens.`);
    console.log('All users will need to re-login on their next visit.');
}

main()
    .catch((e) => {
        console.error('Migration failed:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
