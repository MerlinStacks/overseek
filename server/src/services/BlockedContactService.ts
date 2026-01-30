/**
 * Blocked Contact Service
 * 
 * Manages blocked contacts for inbox filtering.
 * Blocked contacts have their messages auto-resolved without autoreplies.
 */

import { prisma } from '../utils/prisma';
import { Logger } from '../utils/logger';

export class BlockedContactService {
    /**
     * Check if an email is blocked for a given account.
     */
    static async isBlocked(accountId: string, email: string): Promise<boolean> {
        const blocked = await prisma.blockedContact.findUnique({
            where: {
                accountId_email: { accountId, email: email.toLowerCase() }
            }
        });
        return !!blocked;
    }

    /**
     * Block a contact by email.
     */
    static async blockContact(
        accountId: string,
        email: string,
        blockedBy?: string,
        reason?: string
    ): Promise<{ success: boolean; error?: string }> {
        try {
            await prisma.blockedContact.upsert({
                where: {
                    accountId_email: { accountId, email: email.toLowerCase() }
                },
                create: {
                    accountId,
                    email: email.toLowerCase(),
                    blockedBy,
                    reason
                },
                update: {
                    blockedBy,
                    reason,
                    blockedAt: new Date()
                }
            });
            Logger.info('[BlockedContact] Contact blocked', { accountId, email });
            return { success: true };
        } catch (error) {
            Logger.error('[BlockedContact] Failed to block contact', { error, accountId, email });
            return { success: false, error: 'Failed to block contact' };
        }
    }

    /**
     * Unblock a contact by email.
     */
    static async unblockContact(
        accountId: string,
        email: string
    ): Promise<{ success: boolean; error?: string }> {
        try {
            await prisma.blockedContact.deleteMany({
                where: {
                    accountId,
                    email: email.toLowerCase()
                }
            });
            Logger.info('[BlockedContact] Contact unblocked', { accountId, email });
            return { success: true };
        } catch (error) {
            Logger.error('[BlockedContact] Failed to unblock contact', { error, accountId, email });
            return { success: false, error: 'Failed to unblock contact' };
        }
    }

    /**
     * List all blocked contacts for an account.
     */
    static async listBlocked(accountId: string) {
        return prisma.blockedContact.findMany({
            where: { accountId },
            include: {
                blocker: { select: { id: true, fullName: true } }
            },
            orderBy: { blockedAt: 'desc' }
        });
    }

    /**
     * Get a single blocked contact.
     */
    static async getBlockedContact(accountId: string, email: string) {
        return prisma.blockedContact.findUnique({
            where: {
                accountId_email: { accountId, email: email.toLowerCase() }
            },
            include: {
                blocker: { select: { id: true, fullName: true } }
            }
        });
    }
}
