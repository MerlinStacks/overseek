/**
 * getDefaultEmailAccount.ts
 * 
 * Helper function to fetch the default email account for a tenant.
 * Supports both SMTP and HTTP relay configurations.
 * Used by all services that need to send emails (automations, broadcasts, reports, chat, etc.)
 */

import { prisma } from './prisma';
import type { EmailAccount } from '@prisma/client';

/**
 * Fetches the default sending-capable email account for a tenant.
 * Priority:
 *   1. Sending-capable account with isDefault: true
 *   2. Oldest sending-capable account (ID breaks creation-time ties)
 *   3. null if no sending-capable accounts exist
 * Relay-only accounts need both a non-blank endpoint and API key.
 */
export async function getDefaultEmailAccount(accountId: string): Promise<EmailAccount | null> {
    // Never allow an absent tenant ID to become an unscoped Prisma query.
    if (typeof accountId !== 'string' || !accountId.trim()) return null;

    const candidates = await prisma.emailAccount.findMany({
        where: {
            accountId,
            OR: [
                { smtpEnabled: true },
                { relayEndpoint: { not: null }, relayApiKey: { not: null } }
            ]
        },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }]
    });

    // Prisma's portable string filters cannot reject whitespace-only values.
    return candidates.find(account => account.smtpEnabled || (
        Boolean(account.relayEndpoint?.trim()) && Boolean(account.relayApiKey?.trim())
    )) ?? null;
}
