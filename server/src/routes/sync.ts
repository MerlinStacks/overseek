/**
 * Sync Route - Fastify Plugin
 */

import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../utils/prisma';
import { Logger } from '../utils/logger';
import { SyncService } from '../services/sync';
import { SearchQueryService } from '../services/search/SearchQueryService';
import { requireAuthFastify } from '../middleware/auth';
import { mapSyncError } from '../services/sync/syncErrors';

const syncService = new SyncService();

const syncRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.addHook('preHandler', requireAuthFastify);

    const syncQueues = ['sync-orders', 'sync-products', 'sync-customers', 'sync-reviews', 'bom-inventory-sync'] as const;
    const allowedEntities = new Set(['orders', 'products', 'customers', 'reviews', 'bom']);

    const hasActiveSyncJob = async (accountId: string, entityType: string): Promise<boolean> => {
        const queueName = `sync-${entityType}`;
        if (!syncQueues.includes(queueName as any)) return false;

        const queue = (await import('../services/queue/QueueFactory')).QueueFactory.getQueue(queueName);
        const jobs = await queue.getJobs(['active', 'waiting', 'delayed']);

        return jobs.some((job) => job?.data?.accountId === accountId);
    };

    // Trigger Manual Sync
    fastify.post('/manual', async (request, reply) => {
        const { accountId: bodyAccountId, types, incremental } = request.body as any;
        const accountId = request.accountId;

        if (!accountId) {
            return reply.code(400).send({ error: 'accountId is required' });
        }
        if (bodyAccountId && bodyAccountId !== accountId) {
            return reply.code(400).send({ error: 'accountId mismatch' });
        }

        syncService.runSync(accountId, {
            types: types || ['orders', 'products', 'customers', 'reviews'],
            incremental: incremental !== false,
            triggerSource: 'MANUAL'
        }).catch(err => {
            Logger.error('Background sync failed', { error: err });
        });

        return { message: 'Sync started', status: 'IN_PROGRESS' };
    });

    fastify.get('/active', async (request, reply) => {
        try {
            const accountId = request.accountId;
            if (!accountId) return reply.code(400).send({ error: 'accountId is required' });

            const activeJobs: any[] = [];

            for (const name of syncQueues) {
                const queue = (await import('../services/queue/QueueFactory')).QueueFactory.getQueue(name);
                const jobs = await queue.getActive();

                for (const job of jobs) {
                    if (job?.data?.accountId === accountId) {
                        activeJobs.push({
                            id: job.id,
                            queue: name,
                            progress: job.progress,
                            data: job.data
                        });
                    }
                }
            }

            return activeJobs;
        } catch (error) {
            Logger.error('Failed to fetch active jobs', { error });
            return reply.code(500).send({ error: 'Failed to fetch active jobs' });
        }
    });

    fastify.post('/control', async (request, reply) => {
        const { accountId, action, queueName, jobId } = request.body as any;

        try {
            const { QueueFactory } = await import('../services/queue/QueueFactory');

            if (action === 'pause') {
                if (queueName) {
                    const queue = QueueFactory.getQueue(queueName);
                    await queue.pause();
                    return { message: `Queue ${queueName} paused` };
                } else {
                    const names = ['sync-orders', 'sync-products', 'sync-customers', 'sync-reviews', 'bom-inventory-sync'];
                    for (const n of names) await QueueFactory.getQueue(n).pause();
                    return { message: 'All queues paused' };
                }

            } else if (action === 'resume') {
                if (queueName) {
                    const queue = QueueFactory.getQueue(queueName);
                    await queue.resume();
                    return { message: `Queue ${queueName} resumed` };
                } else {
                    const names = ['sync-orders', 'sync-products', 'sync-customers', 'sync-reviews', 'bom-inventory-sync'];
                    for (const n of names) await QueueFactory.getQueue(n).resume();
                    return { message: 'All queues resumed' };
                }

            } else if (action === 'cancel') {
                if (queueName && jobId) {
                    const queue = QueueFactory.getQueue(queueName);
                    const job = await queue.getJob(jobId);
                    if (job) {
                        try {
                            await job.remove();
                        } catch (e) {
                            // ignore lock issues
                        }
                        return { message: 'Job cancellation requested' };
                    } else {
                        return reply.code(404).send({ error: 'Job not found' });
                    }
                } else {
                    return reply.code(400).send({ error: 'queueName and jobId required for cancel' });
                }
            } else {
                return reply.code(400).send({ error: 'Invalid action' });
            }

        } catch (error: any) {
            Logger.error('Control action failed', { error });
            return reply.code(500).send({ error: 'Control action failed: ' + error.message });
        }
    });

    // Sync Health Timeline + Summary
    fastify.get('/health', async (request, reply) => {
        const accountId = request.accountId;
        if (!accountId) return reply.code(400).send({ error: 'accountId is required' });

        try {
            const maxAttempts = 3;
            const baseDelayMs = 2000;
            const recent = await prisma.syncLog.findMany({
                where: { accountId: String(accountId) },
                orderBy: { startedAt: 'desc' },
                take: 50
            });

            const state = await prisma.syncState.findMany({
                where: { accountId: String(accountId) }
            });

            const lastSuccess = recent.find((log) => log.status === 'SUCCESS');
            const lastFailure = recent.find((log) => log.status === 'FAILED');

            const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
            const total24h = await prisma.syncLog.count({
                where: { accountId: String(accountId), startedAt: { gte: since } }
            });
            const failed24h = await prisma.syncLog.count({
                where: { accountId: String(accountId), status: 'FAILED', startedAt: { gte: since } }
            });

            let activeJobsCount = 0;
            for (const name of syncQueues) {
                const queue = (await import('../services/queue/QueueFactory')).QueueFactory.getQueue(name);
                const jobs = await queue.getActive();
                activeJobsCount += jobs.filter((job) => job?.data?.accountId === accountId).length;
            }

            const enriched = recent.map((log) => {
                const friendly = log.status === 'FAILED' ? mapSyncError(log.errorMessage) : null;
                let nextRetryAt: string | null = null;
                let willRetry = false;

                if (log.status === 'FAILED' && log.retryCount < maxAttempts) {
                    const completedAt = log.completedAt || log.startedAt;
                    const backoffMultiplier = Math.pow(2, Math.max(log.retryCount - 1, 0));
                    const delayMs = baseDelayMs * backoffMultiplier;
                    nextRetryAt = new Date(completedAt.getTime() + delayMs).toISOString();
                    willRetry = true;
                }

                return {
                    ...log,
                    errorCode: friendly?.code,
                    friendlyError: friendly?.friendlyMessage,
                    nextRetryAt,
                    willRetry,
                    maxAttempts
                };
            });

            return {
                summary: {
                    lastSuccessAt: lastSuccess?.completedAt || null,
                    lastFailureAt: lastFailure?.completedAt || null,
                    failureRate24h: total24h === 0 ? 0 : Number((failed24h / total24h).toFixed(3)),
                    activeJobs: activeJobsCount
                },
                recent: enriched,
                state
            };
        } catch (error) {
            Logger.error('Failed to fetch sync health', { error });
            return reply.code(500).send({ error: 'Failed to fetch sync health' });
        }
    });

    // Retry failed sync
    fastify.post('/retry', async (request, reply) => {
        const accountId = request.accountId;
        const { entityType, logId } = request.body as { entityType?: string; logId?: string };

        if (!accountId) return reply.code(400).send({ error: 'accountId is required' });
        if (!entityType || !allowedEntities.has(entityType)) {
            return reply.code(400).send({ error: 'Invalid entityType' });
        }

        if (logId) {
            const log = await prisma.syncLog.findUnique({ where: { id: logId } });
            if (!log || log.accountId !== accountId) {
                return reply.code(404).send({ error: 'Sync log not found' });
            }
        }

        if (await hasActiveSyncJob(accountId, entityType)) {
            return reply.code(409).send({ error: 'Sync already in progress for this entity' });
        }

        syncService.runSync(accountId, {
            types: [entityType],
            incremental: true,
            triggerSource: 'RETRY'
        }).catch(err => {
            Logger.error('Retry sync failed to enqueue', { error: err });
        });

        return { message: 'Retry scheduled', status: 'IN_PROGRESS' };
    });

    // Search Orders
    fastify.get('/orders/search', async (request, reply) => {
        const query = request.query as any;
        const accountId = request.accountId;
        const page = parseInt(query.page) || 1;
        const limit = parseInt(query.limit) || 50;
        const { q, tags: tagsParam, status } = query;

        let tags: string[] | undefined;
        if (tagsParam) {
            if (Array.isArray(tagsParam)) {
                tags = tagsParam as string[];
            } else if (typeof tagsParam === 'string') {
                tags = tagsParam.split(',').map((t: string) => t.trim()).filter(Boolean);
            }
        }

        if (!accountId) {
            return reply.code(400).send({ error: 'accountId is required' });
        }

        try {
            const results = await SearchQueryService.searchOrders(accountId, q, page, limit, tags, status);
            return results;
        } catch (error) {
            Logger.error('Search failed', { error });
            return reply.code(500).send({ error: 'Search failed' });
        }
    });

    // Get unique order tags
    fastify.get('/orders/tags', async (request, reply) => {
        const query = request.query as any;
        const accountId = request.accountId;

        if (!accountId) {
            return reply.code(400).send({ error: 'accountId is required' });
        }

        try {
            const tags = await SearchQueryService.getOrderTags(accountId);

            const account = await prisma.account.findUnique({
                where: { id: accountId },
                select: { orderTagMappings: true }
            });

            const tagColors: Record<string, string> = {};
            if (account?.orderTagMappings && Array.isArray(account.orderTagMappings)) {
                for (const mapping of account.orderTagMappings as any[]) {
                    if (mapping.orderTag && mapping.color) {
                        tagColors[mapping.orderTag] = mapping.color;
                    }
                }
            }

            return { tags, tagColors };
        } catch (error) {
            Logger.error('Failed to fetch order tags', { error });
            return reply.code(500).send({ error: 'Failed to fetch order tags' });
        }
    });

    // Get order status counts for tab filter
    fastify.get('/orders/status-counts', async (request, reply) => {
        const accountId = request.accountId;

        if (!accountId) {
            return reply.code(400).send({ error: 'accountId is required' });
        }

        try {
            const result = await SearchQueryService.getOrderStatusCounts(accountId);
            return result;
        } catch (error) {
            Logger.error('Failed to fetch order status counts', { error });
            return reply.code(500).send({ error: 'Failed to fetch order status counts' });
        }
    });

    // Get Sync Status
    fastify.get('/status', async (request, reply) => {
        const accountId = request.accountId;
        if (!accountId) return reply.code(400).send({ error: 'accountId is required' });

        try {
            const logs = await prisma.syncLog.findMany({
                where: { accountId: String(accountId) },
                orderBy: { startedAt: 'desc' },
                take: 20
            });

            const state = await prisma.syncState.findMany({
                where: { accountId: String(accountId) }
            });

            return { logs, state };
        } catch (error) {
            Logger.error('Failed to fetch status', { error });
            return reply.code(500).send({ error: 'Failed to fetch status' });
        }
    });
};

export default syncRoutes;
