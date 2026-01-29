/**
 * Budget Rebalancer Routes
 * 
 * API endpoints for campaign budget rebalancing.
 * Part of AI Co-Pilot v2 - Phase 3: Campaign Automation.
 */

import { FastifyInstance } from 'fastify';
import { BudgetRebalancerService, RebalancerConfig } from '../../services/ads/BudgetRebalancerService';
import { AdActionExecutor } from '../../services/ads/AdActionExecutor';
import { requireAuthFastify } from '../../middleware/auth';
import { prisma } from '../../utils/prisma';

interface AnalyzeBody {
    config?: Partial<RebalancerConfig>;
}

interface ExecuteBody {
    actionId: string;
}

export default async function rebalancerRoutes(fastify: FastifyInstance) {
    // All routes require authentication
    fastify.addHook('preHandler', requireAuthFastify);

    /**
     * POST /api/ads/rebalancer/analyze
     * Analyze campaigns and generate rebalancing recommendations.
     */
    fastify.post<{ Body: AnalyzeBody }>('/analyze', async (request, reply) => {
        const accountId = request.accountId;
        if (!accountId) return reply.code(400).send({ error: 'No account selected' });

        const config = request.body?.config || {};
        const result = await BudgetRebalancerService.analyzeAndRebalance(accountId, config);

        return {
            success: true,
            ...result
        };
    });

    /**
     * POST /api/ads/rebalancer/execute
     * Execute a specific rebalance action.
     */
    fastify.post<{ Body: ExecuteBody }>('/execute', {
        schema: {
            body: {
                type: 'object',
                required: ['actionId'],
                properties: {
                    actionId: { type: 'string' }
                }
            }
        }
    }, async (request, reply) => {
        const accountId = request.accountId;
        if (!accountId) return reply.code(400).send({ error: 'No account selected' });

        const { actionId } = request.body;

        // Verify action belongs to this account
        const action = await prisma.scheduledAdAction.findFirst({
            where: { id: actionId, accountId }
        });

        if (!action) {
            return reply.code(404).send({ error: 'Action not found' });
        }

        const result = await AdActionExecutor.executeAction(actionId);

        return result;
    });

    /**
     * GET /api/ads/rebalancer/settings
     * Get current rebalancer configuration.
     */
    fastify.get('/settings', async (request, reply) => {
        const accountId = request.accountId;
        if (!accountId) return reply.code(400).send({ error: 'No account selected' });

        const settings = await BudgetRebalancerService.getSettings(accountId);
        return { settings };
    });

    /**
     * GET /api/ads/rebalancer/pending
     * Get pending rebalance actions.
     */
    fastify.get('/pending', async (request, reply) => {
        const accountId = request.accountId;
        if (!accountId) return reply.code(400).send({ error: 'No account selected' });

        const actions = await prisma.scheduledAdAction.findMany({
            where: {
                accountId,
                status: 'pending',
                sourceType: 'rebalancer'
            },
            orderBy: { createdAt: 'desc' },
            take: 50
        });

        return { actions };
    });

    /**
     * POST /api/ads/rebalancer/approve/:id
     * Approve a pending rebalance action for execution.
     */
    fastify.post<{ Params: { id: string } }>('/approve/:id', async (request, reply) => {
        const accountId = request.accountId;
        if (!accountId) return reply.code(400).send({ error: 'No account selected' });

        const { id } = request.params;

        const action = await prisma.scheduledAdAction.findFirst({
            where: { id, accountId, status: 'pending' }
        });

        if (!action) {
            return reply.code(404).send({ error: 'Pending action not found' });
        }

        // Execute the action immediately
        const result = await AdActionExecutor.executeAction(id);

        return result;
    });

    /**
     * POST /api/ads/rebalancer/cancel/:id
     * Cancel a pending rebalance action.
     */
    fastify.post<{ Params: { id: string } }>('/cancel/:id', async (request, reply) => {
        const accountId = request.accountId;
        if (!accountId) return reply.code(400).send({ error: 'No account selected' });

        const { id } = request.params;

        const action = await prisma.scheduledAdAction.findFirst({
            where: { id, accountId, status: 'pending' }
        });

        if (!action) {
            return reply.code(404).send({ error: 'Pending action not found' });
        }

        await prisma.scheduledAdAction.update({
            where: { id },
            data: { status: 'cancelled' }
        });

        return { success: true, message: 'Action cancelled' };
    });
}
