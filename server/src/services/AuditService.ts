import { Logger } from '../utils/logger';
import { prisma } from '../utils/prisma';

export class AuditService {
    /**
     * Log an action to the Audit Trail.
     * 
     * @param accountId - The account context
     * @param userId - The user performing the action (nullable for system actions)
     * @param action - Verb (UPDATE, CREATE, DELETE, ETC)
     * @param resource - Noun (PRODUCT, ORDER, SETTINGS)
     * @param resourceId - Target ID
     * @param details - JSON details of the change
     */
    static async log(
        accountId: string,
        userId: string | null,
        action: string,
        resource: string,
        resourceId: string,
        details: Record<string, any>
    ) {
        try {
            await prisma.auditLog.create({
                data: {
                    accountId,
                    userId,
                    action,
                    resource,
                    resourceId,
                    details
                }
            });
            Logger.info(`[Audit] ${action} ${resource} ${resourceId} by ${userId || 'System'}`);
        } catch (error) {
            Logger.error('[AuditService] Failed to create log entry', { error, accountId });
        }
    }

    /**
     * Retrieve audit logs for a specific resource
     */
    static async getLogsForResource(accountId: string, resource: string, resourceId: string) {
        return prisma.auditLog.findMany({
            where: {
                accountId,
                resource,
                resourceId
            },
            include: {
                user: {
                    select: {
                        fullName: true,
                        email: true,
                        avatarUrl: true
                    }
                }
            },
            orderBy: {
                createdAt: 'desc'
            }
        });
    }

    /**
    * Retrieve recent audit logs for an account
    */
    static async getRecentLogs(accountId: string, limit = 50) {
        return prisma.auditLog.findMany({
            where: { accountId },
            include: {
                user: {
                    select: {
                        fullName: true,
                        email: true,
                        avatarUrl: true
                    }
                }
            },
            orderBy: { createdAt: 'desc' },
            take: limit
        });
    }
}
