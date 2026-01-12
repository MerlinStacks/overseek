/**
 * Sync Route - Fastify Plugin
 */

import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../utils/prisma';
import { Logger } from '../utils/logger';
import { SyncService } from '../services/sync';
import { SearchQueryService } from '../services/search/SearchQueryService';
import { requireAuthFastify } from '../middleware/auth';

const syncService = new SyncService();

const syncRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.addHook('preHandler', requireAuthFastify);

    // Trigger Manual Sync
    fastify.post('/manual', async (request, reply) => {
        const { accountId, types, incremental } = request.body as any;

        if (!accountId) {
            return reply.code(400).send({ error: 'accountId is required' });
        }

        syncService.runSync(accountId, {
            types: types || ['orders', 'products', 'customers', 'reviews'],
            incremental: incremental !== false
        }).catch(err => {
            Logger.error('Background sync failed', { error: err });
        });

        return { message: 'Sync started', status: 'IN_PROGRESS' };
    });

    fastify.get('/active', async (request, reply) => {
        try {
            const { accountId } = request.query as { accountId?: string };
            if (!accountId) return reply.code(400).send({ error: 'accountId is required' });

            const queueNames = ['sync-orders', 'sync-products', 'sync-customers', 'sync-reviews'];
            const activeJobs: any[] = [];

            for (const name of queueNames) {
                const queue = (await import('../services/queue/QueueFactory')).QueueFactory.getQueue(name);
                const jobs = await queue.getActive();

                for (const job of jobs) {
                    if (job.data.accountId === accountId) {
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
                    const names = ['sync-orders', 'sync-products', 'sync-customers', 'sync-reviews'];
                    for (const n of names) await QueueFactory.getQueue(n).pause();
                    return { message: 'All queues paused' };
                }

            } else if (action === 'resume') {
                if (queueName) {
                    const queue = QueueFactory.getQueue(queueName);
                    await queue.resume();
                    return { message: `Queue ${queueName} resumed` };
                } else {
                    const names = ['sync-orders', 'sync-products', 'sync-customers', 'sync-reviews'];
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

    // Search Orders
    fastify.get('/orders/search', async (request, reply) => {
        const query = request.query as any;
        const accountId = request.headers['x-account-id'] as string || query.accountId;
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
        const accountId = request.headers['x-account-id'] as string || query.accountId;

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

    // Get Sync Status
    fastify.get('/status', async (request, reply) => {
        const { accountId } = request.query as { accountId?: string };
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
