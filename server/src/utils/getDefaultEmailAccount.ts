/**
 * getDefaultEmailAccount.ts
 * 
 * Helper function to fetch the default email account for a tenant.
 * Supports both SMTP and HTTP relay configurations.
 * Used by all services that need to send emails (automations, broadcasts, reports, chat, etc.)
 */

import { prisma } from './prisma';
import { EmailAccount } from '@prisma/client';

/**
 * Fetches the default sending-capable email account for a tenant.
 * Priority:
 *   1. Account with isDefault: true and (smtpEnabled OR relayEndpoint)
 *   2. First sending-capable account found (fallback)
 *   3. null if no sending-capable accounts exist
 */
export async function getDefaultEmailAccount(accountId: string): Promise<EmailAccount | null> {
    // First try to find the explicitly set default
    const defaultAccount = await prisma.emailAccount.findFirst({
        where: {
            accountId,
            isDefault: true,
            OR: [
                { smtpEnabled: true },
                { relayEndpoint: { not: null } }
            ]
        }
    });

    if (defaultAccount) {
        return defaultAccount;
    }

    // Fallback: return first sending-capable account
    return prisma.emailAccount.findFirst({
        where: {
            accountId,
            OR: [
                { smtpEnabled: true },
                { relayEndpoint: { not: null } }
            ]
        }
    });
}
