/**
 * Campaign Wizard Service
 * 
 * AI-powered campaign creation wizard that generates optimal campaign
 * structures based on product selection and business goals.
 * Part of AI Co-Pilot v2 - Phase 3: Campaign Automation.
 */

import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';
import { CampaignBuilderService, NewCampaignParams, AdCopy, KeywordConfig } from './CampaignBuilderService';
import { AdCopyGenerator } from '../tools/AdCopyGenerator';

/** Input for the campaign wizard */
export interface WizardInput {
    productIds: string[];
    businessGoal: 'sales' | 'leads' | 'awareness';
    dailyBudget: number;
    targetRoas?: number;
    platform: 'GOOGLE' | 'META';
    audienceHints?: string;  // Optional context for targeting
}

/** Ad group proposal within a campaign */
interface AdGroupProposal {
    name: string;
    productIds: string[];
    keywords?: KeywordConfig[];
    adCopy?: AdCopy;
}

/** Complete campaign proposal */
export interface CampaignProposal {
    campaignType: 'SEARCH' | 'SHOPPING' | 'PMAX' | 'ADVANTAGE_PLUS';
    campaignName: string;
    dailyBudget: number;
    targetRoas?: number;
    adGroups: AdGroupProposal[];
    estimatedReach?: number;
    reasoning: string;
}

/** Result of campaign creation */
export interface CampaignCreationResult {
    success: boolean;
    campaignId?: string;
    campaignName?: string;
    adGroupsCreated?: number;
    error?: string;
}

/**
 * AI-powered campaign creation wizard.
 */
export class CampaignWizardService {
    /**
     * Generate a campaign proposal from product selection.
     * Uses AI to determine optimal campaign structure.
     */
    static async generateProposal(
        accountId: string,
        input: WizardInput
    ): Promise<CampaignProposal> {
        Logger.info('[CampaignWizard] Generating proposal', { accountId, input });

        // Fetch product data
        const products = await prisma.wooProduct.findMany({
            where: {
                accountId,
                id: { in: input.productIds }
            },
            select: {
                id: true,
                name: true,
                price: true,
                sku: true,
                images: true,
                rawData: true
            }
        });

        if (products.length === 0) {
            throw new Error('No valid products found for the selected IDs');
        }

        // Determine optimal campaign type
        const campaignType = await this.suggestCampaignType(products, input);

        // Generate campaign structure
        const proposal = await this.buildProposal(
            products,
            campaignType,
            input
        );

        Logger.info('[CampaignWizard] Proposal generated', {
            accountId,
            campaignType,
            adGroups: proposal.adGroups.length
        });

        return proposal;
    }

    /**
     * Auto-suggest campaign type based on products and goals.
     */
    static async suggestCampaignType(
        products: any[],
        input: WizardInput
    ): Promise<'SEARCH' | 'SHOPPING' | 'PMAX'> {
        const hasImages = products.some(p => {
            const images = p.images as any[];
            return images && images.length > 0;
        });

        const productCount = products.length;

        // Decision tree for campaign type
        if (input.platform === 'META') {
            // Meta only supports Advantage+ style campaigns (similar to PMax)
            return 'PMAX';
        }

        // Google campaign type selection
        if (input.businessGoal === 'awareness') {
            return 'PMAX';  // PMax is best for broad reach
        }

        if (productCount >= 6 && hasImages) {
            // Many products with images -> Shopping or PMax
            return input.businessGoal === 'sales' ? 'SHOPPING' : 'PMAX';
        }

        // Default to Search for targeted sales
        return 'SEARCH';
    }

    /**
     * Build the full campaign proposal.
     */
    private static async buildProposal(
        products: any[],
        campaignType: 'SEARCH' | 'SHOPPING' | 'PMAX',
        input: WizardInput
    ): Promise<CampaignProposal> {
        const productNames = products.map(p => p.name).join(', ');
        const campaignName = this.generateCampaignName(products, campaignType, input);

        // Build ad groups based on campaign type
        const adGroups: AdGroupProposal[] = [];

        if (campaignType === 'SEARCH') {
            // Group products by category or create single ad group
            const adGroup = await this.buildSearchAdGroup(products, input);
            adGroups.push(adGroup);
        } else if (campaignType === 'SHOPPING') {
            // One product group for all products
            adGroups.push({
                name: 'All Products',
                productIds: products.map(p => p.id)
            });
        } else {
            // PMax - asset group style
            adGroups.push({
                name: 'Asset Group',
                productIds: products.map(p => p.id)
            });
        }

        // Generate reasoning
        const reasoning = this.generateReasoning(
            campaignType,
            products.length,
            input
        );

        return {
            campaignType,
            campaignName,
            dailyBudget: input.dailyBudget,
            targetRoas: input.targetRoas,
            adGroups,
            reasoning
        };
    }

    /**
     * Build a Search campaign ad group with keywords and ad copy.
     */
    private static async buildSearchAdGroup(
        products: any[],
        input: WizardInput
    ): Promise<AdGroupProposal> {
        // Generate keywords from product names
        const keywords: KeywordConfig[] = [];

        for (const product of products.slice(0, 10)) {  // Limit to 10 products
            const productName = product.name || '';

            // Add phrase match for product name
            keywords.push({
                text: productName,
                matchType: 'PHRASE'
            });

            // Add broad match modifier for key terms
            const keyTerms = productName.split(' ').filter((t: string) => t.length > 3);
            if (keyTerms.length >= 2) {
                keywords.push({
                    text: keyTerms.join(' '),
                    matchType: 'BROAD'
                });
            }
        }

        // Generate ad copy
        const adCopy = await this.generateSearchAdCopy(products);

        return {
            name: `Products - ${products.length} items`,
            productIds: products.map(p => p.id),
            keywords: keywords.slice(0, 20),  // Google allows max 20 keywords per ad group
            adCopy
        };
    }

    /**
     * Generate ad copy for Search campaigns.
     */
    private static async generateSearchAdCopy(products: any[]): Promise<AdCopy> {
        // Get first product for context
        const mainProduct = products[0];
        const productNames = products.slice(0, 3).map(p => p.name).join(', ');

        // Simple copy generation (could use AdCopyGenerator for AI copy)
        const headlines = [
            `Shop ${mainProduct.name}`.slice(0, 30),
            `${products.length} Quality Products`.slice(0, 30),
            'Free Shipping Available'.slice(0, 30),
            'Buy Now - Great Prices'.slice(0, 30),
            'Shop The Best Selection'.slice(0, 30)
        ];

        const descriptions = [
            `Discover our collection including ${productNames}. Order today with secure checkout.`.slice(0, 90),
            'Premium quality products at competitive prices. Fast delivery and easy returns.'.slice(0, 90)
        ];

        return {
            headlines,
            descriptions,
            finalUrl: 'https://example.com'  // Would be filled from account settings
        };
    }

    /**
     * Generate a descriptive campaign name.
     */
    private static generateCampaignName(
        products: any[],
        campaignType: string,
        input: WizardInput
    ): string {
        const date = new Date().toISOString().slice(0, 10);
        const goalLabel = input.businessGoal.charAt(0).toUpperCase() + input.businessGoal.slice(1);

        if (products.length === 1) {
            return `${campaignType} - ${products[0].name} - ${goalLabel} - ${date}`;
        }

        return `${campaignType} - ${products.length} Products - ${goalLabel} - ${date}`;
    }

    /**
     * Generate AI reasoning for the campaign structure.
     */
    private static generateReasoning(
        campaignType: string,
        productCount: number,
        input: WizardInput
    ): string {
        const reasons: string[] = [];

        if (campaignType === 'SEARCH') {
            reasons.push('Search campaigns target users actively searching for your products.');
            reasons.push(`With ${productCount} product(s), a focused Search campaign will capture high-intent traffic.`);
        } else if (campaignType === 'SHOPPING') {
            reasons.push('Shopping campaigns showcase your products directly in search results with images and prices.');
            reasons.push('Ideal for e-commerce with multiple products.');
        } else {
            reasons.push('Performance Max campaigns leverage AI to find customers across all Google channels.');
            reasons.push('Best for awareness and broad reach with diverse product offerings.');
        }

        if (input.targetRoas) {
            reasons.push(`Target ROAS set to ${input.targetRoas}x will optimize bids for profitable conversions.`);
        }

        return reasons.join(' ');
    }

    /**
     * Execute an approved campaign proposal.
     */
    static async executeProposal(
        accountId: string,
        adAccountId: string,
        proposal: CampaignProposal
    ): Promise<CampaignCreationResult> {
        Logger.info('[CampaignWizard] Executing proposal', {
            accountId,
            adAccountId,
            campaignType: proposal.campaignType
        });

        try {
            if (proposal.campaignType === 'SEARCH' && proposal.adGroups[0]) {
                const adGroup = proposal.adGroups[0];

                const params: NewCampaignParams = {
                    name: proposal.campaignName,
                    dailyBudget: proposal.dailyBudget,
                    targetRoas: proposal.targetRoas
                };

                const result = await CampaignBuilderService.createSearchCampaign(
                    adAccountId,
                    params,
                    adGroup.keywords || [],
                    adGroup.adCopy!
                );

                return {
                    success: result.success,
                    campaignId: result.campaignResource,
                    campaignName: result.campaignName,
                    adGroupsCreated: 1
                };

            } else if (proposal.campaignType === 'PMAX') {
                // PMax not fully implemented in CampaignBuilderService
                return {
                    success: false,
                    error: 'Performance Max campaign creation is not yet implemented'
                };

            } else if (proposal.campaignType === 'SHOPPING') {
                return {
                    success: false,
                    error: 'Shopping campaign creation is not yet implemented'
                };
            }

            return {
                success: false,
                error: 'Unknown campaign type'
            };

        } catch (error: any) {
            Logger.error('[CampaignWizard] Execution failed', {
                accountId,
                error: error.message
            });

            return {
                success: false,
                error: error.message
            };
        }
    }
}
