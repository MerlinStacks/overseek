/**
 * Campaign Wizard Routes
 * 
 * API endpoints for AI-powered campaign creation.
 * Part of AI Co-Pilot v2 - Phase 3: Campaign Automation.
 */

import { FastifyInstance } from 'fastify';
import { CampaignWizardService, WizardInput, CampaignProposal } from '../../services/ads/CampaignWizardService';
import { requireAuthFastify } from '../../middleware/auth';
import { prisma } from '../../utils/prisma';

interface ProposeBody {
    productIds: string[];
    businessGoal: 'sales' | 'leads' | 'awareness';
    dailyBudget: number;
    targetRoas?: number;
    platform: 'GOOGLE' | 'META';
    audienceHints?: string;
}

interface ExecuteBody {
    adAccountId: string;
    proposal: CampaignProposal;
}

interface SuggestTypeBody {
    productIds: string[];
    businessGoal: 'sales' | 'leads' | 'awareness';
    platform: 'GOOGLE' | 'META';
}

export default async function wizardRoutes(fastify: FastifyInstance) {
    // All routes require authentication
    fastify.addHook('preHandler', requireAuthFastify);

    /**
     * POST /api/ads/wizard/propose
     * Generate a campaign proposal from product selection.
     */
    fastify.post<{ Body: ProposeBody }>('/propose', {
        schema: {
            body: {
                type: 'object',
                required: ['productIds', 'businessGoal', 'dailyBudget', 'platform'],
                properties: {
                    productIds: { type: 'array', items: { type: 'string' }, minItems: 1 },
                    businessGoal: { type: 'string', enum: ['sales', 'leads', 'awareness'] },
                    dailyBudget: { type: 'number', minimum: 1 },
                    targetRoas: { type: 'number' },
                    platform: { type: 'string', enum: ['GOOGLE', 'META'] },
                    audienceHints: { type: 'string' }
                }
            }
        }
    }, async (request, reply) => {
        const accountId = request.accountId;
        if (!accountId) return reply.code(400).send({ error: 'No account selected' });

        const input: WizardInput = request.body;

        const proposal = await CampaignWizardService.generateProposal(accountId, input);

        return {
            success: true,
            proposal
        };
    });

    /**
     * POST /api/ads/wizard/execute
     * Execute an approved campaign proposal.
     */
    fastify.post<{ Body: ExecuteBody }>('/execute', {
        schema: {
            body: {
                type: 'object',
                required: ['adAccountId', 'proposal'],
                properties: {
                    adAccountId: { type: 'string' },
                    proposal: { type: 'object' }  // CampaignProposal structure
                }
            }
        }
    }, async (request, reply) => {
        const accountId = request.accountId;
        if (!accountId) return reply.code(400).send({ error: 'No account selected' });

        const { adAccountId, proposal } = request.body;

        const result = await CampaignWizardService.executeProposal(
            accountId,
            adAccountId,
            proposal
        );

        if (!result.success) {
            return reply.code(400).send({
                success: false,
                error: result.error
            });
        }

        return result;
    });

    /**
     * POST /api/ads/wizard/suggest-type
     * Get AI suggestion for optimal campaign type.
     */
    fastify.post<{ Body: SuggestTypeBody }>('/suggest-type', {
        schema: {
            body: {
                type: 'object',
                required: ['productIds', 'businessGoal', 'platform'],
                properties: {
                    productIds: { type: 'array', items: { type: 'string' } },
                    businessGoal: { type: 'string', enum: ['sales', 'leads', 'awareness'] },
                    platform: { type: 'string', enum: ['GOOGLE', 'META'] }
                }
            }
        }
    }, async (request, reply) => {
        const accountId = request.accountId;
        if (!accountId) return reply.code(400).send({ error: 'No account selected' });

        const { productIds, businessGoal, platform } = request.body;

        // Fetch products
        const products = await prisma.wooProduct.findMany({
            where: {
                accountId,
                id: { in: productIds }
            },
            select: {
                id: true,
                name: true,
                images: true
            }
        });

        const input: WizardInput = {
            productIds,
            businessGoal,
            dailyBudget: 0,  // Not needed for type suggestion
            platform
        };

        const suggestedType = await CampaignWizardService.suggestCampaignType(products, input);

        return {
            success: true,
            suggestedType,
            reasoning: getSuggestionReasoning(suggestedType, products.length, businessGoal)
        };
    });
}

/**
 * Generate reasoning for campaign type suggestion.
 */
function getSuggestionReasoning(
    campaignType: string,
    productCount: number,
    goal: string
): string {
    const reasons: Record<string, string> = {
        'SEARCH': `Search campaigns are ideal for ${productCount} product(s) targeting high-intent users actively looking for similar items.`,
        'SHOPPING': `Shopping campaigns showcase your ${productCount} products with images and prices directly in search results.`,
        'PMAX': `Performance Max leverages AI to reach customers across all Google channels, optimal for ${goal} goals.`
    };

    return reasons[campaignType] || 'Recommended based on your product selection and goals.';
}
