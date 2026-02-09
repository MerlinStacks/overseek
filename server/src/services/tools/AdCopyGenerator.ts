/**
 * Ad Copy Generator Service
 * 
 * Uses OpenRouter AI to generate compelling, contextual ad copy
 * for Google Search campaigns based on store and product data.
 */

import { Logger } from '../../utils/logger';
import { prisma } from '../../utils/prisma';


/** Tone presets for ad copy generation */
export type TonePreset = 'professional' | 'playful' | 'urgent' | 'luxury';

/** Target ad platform */
export type AdPlatform = 'google' | 'meta' | 'both';

/** Platform-specific character limits */
export const PLATFORM_LIMITS = {
    google: {
        headline: 30,
        description: 90,
        headlineCount: 15,
        descriptionCount: 4
    },
    meta: {
        primaryText: 125,
        headline: 40,
        description: 30,  // Link description
        primaryTextCount: 3,
        headlineCount: 5
    }
} as const;

export interface AdCopyContext {
    storeName: string;
    storeUrl: string;
    topProducts: { name: string; price?: number; sku?: string }[];
    avgOrderValue: number;
    categories?: string[];
    /** Optional: brand voice/tone description */
    brandVoice?: string;
    /** Tone preset for copy style */
    tonePreset?: TonePreset;
    /** Target platform */
    platform?: AdPlatform;
}

export interface GeneratedAdCopy {
    headlines: string[];
    descriptions: string[];
    /** Indicates if this was AI-generated or template fallback */
    source: 'ai' | 'template';
    /** Any warnings or notes about the generation */
    notes?: string[];
    /** Meta-specific primary text (if platform is meta or both) */
    primaryTexts?: string[];
    /** Platform this copy was generated for */
    platform?: AdPlatform;
}

/** Options for bulk ad copy generation */
export interface BulkGenerationOptions {
    tonePreset: TonePreset;
    platform: AdPlatform;
    /** Specific product IDs to generate for (if empty, uses top products) */
    productIds?: string[];
    /** Maximum products to generate for */
    maxProducts?: number;
}

/** Result of bulk generation */
export interface BulkGenerationResult {
    generated: Array<{
        productId: string;
        productName: string;
        sku?: string;
        copy: GeneratedAdCopy;
    }>;
    failed: Array<{
        productId: string;
        productName: string;
        error: string;
    }>;
    totalProducts: number;
    successCount: number;
    failedCount: number;
}


const HEADLINE_PROMPT = `You are an expert Google Ads copywriter. Generate 15 unique headlines for a Responsive Search Ad.

RULES:
- Each headline must be 30 characters or less
- Use a mix of: benefits, calls-to-action, product names, trust signals
- Include the business name in 2-3 headlines
- Avoid repetition and generic phrases
- Make headlines compelling and action-oriented
- Use numbers where appropriate (prices, percentages)

CONTEXT:
Store: {storeName}
Top Products: {products}
Average Order: {avgOrderValue}
Categories: {categories}

OUTPUT FORMAT: Return ONLY a JSON array of 15 headline strings, nothing else.
Example: ["Shop Premium Rings", "Free Shipping Today", "Quality Guaranteed"]`;

const DESCRIPTION_PROMPT = `You are an expert Google Ads copywriter. Generate 4 unique descriptions for a Responsive Search Ad.

RULES:
- Each description must be 90 characters or less
- Include benefits, USPs, and calls-to-action
- Mention free shipping, guarantees, or trust signals
- Make descriptions complement the headlines
- Be specific to the products and store

CONTEXT:
Store: {storeName}
Top Products: {products}
Average Order: {avgOrderValue}
Categories: {categories}
{toneInstruction}

OUTPUT FORMAT: Return ONLY a JSON array of 4 description strings, nothing else.`;

// Meta Ads specific prompts
const META_PRIMARY_TEXT_PROMPT = `You are an expert Facebook/Instagram Ads copywriter. Generate 3 unique primary texts for a Meta ad.

RULES:
- Each primary text must be 125 characters or less
- Hook the reader in the first line
- Use emotional triggers and storytelling
- Include a clear benefit and call-to-action
- Be conversational and engaging

CONTEXT:
Store: {storeName}
Top Products: {products}
Average Order: {avgOrderValue}
Categories: {categories}
{toneInstruction}

OUTPUT FORMAT: Return ONLY a JSON array of 3 primary text strings, nothing else.`;

const META_HEADLINE_PROMPT = `You are an expert Facebook/Instagram Ads copywriter. Generate 5 unique headlines for a Meta ad.

RULES:
- Each headline must be 40 characters or less
- Make them punchy and attention-grabbing
- Focus on benefits over features
- Use action verbs

CONTEXT:
Store: {storeName}
Top Products: {products}
{toneInstruction}

OUTPUT FORMAT: Return ONLY a JSON array of 5 headline strings, nothing else.`;

// Tone instruction modifiers
const TONE_INSTRUCTIONS: Record<TonePreset, string> = {
    professional: `
TONE: Professional and trustworthy
- Use formal but approachable language
- Emphasize quality, expertise, and reliability
- Avoid slang or casual phrases
- Focus on value and professionalism`,

    playful: `
TONE: Playful and fun
- Use casual, friendly language
- Add personality and humor where appropriate
- Use exclamation points sparingly but effectively
- Make the reader smile`,

    urgent: `
TONE: Urgent and action-oriented
- Create a sense of urgency and scarcity
- Use words like "Now", "Today", "Limited", "Don't Miss"
- Emphasize time-sensitive offers
- Drive immediate action`,

    luxury: `
TONE: Luxurious and premium
- Use sophisticated, elegant language
- Emphasize exclusivity and premium quality
- Avoid discount-focused messaging
- Appeal to aspirational desires`
};


export class AdCopyGenerator {

    /**
     * Generate AI-powered ad copy for a search campaign.
     * Falls back to template-based copy if AI is unavailable.
     */
    static async generate(
        accountId: string,
        context: AdCopyContext
    ): Promise<GeneratedAdCopy> {
        try {
            // Get account's API key
            const account = await prisma.account.findUnique({
                where: { id: accountId },
                select: { openRouterApiKey: true, aiModel: true }
            });

            if (!account?.openRouterApiKey) {
                Logger.debug('No OpenRouter API key, using template fallback');
                return this.generateTemplateBasedCopy(context);
            }

            // Generate headlines
            const headlinesResult = await this.callOpenRouter(
                account.openRouterApiKey,
                account.aiModel || 'mistralai/mistral-7b-instruct',
                this.buildPrompt(HEADLINE_PROMPT, context)
            );

            // Generate descriptions
            const descriptionsResult = await this.callOpenRouter(
                account.openRouterApiKey,
                account.aiModel || 'mistralai/mistral-7b-instruct',
                this.buildPrompt(DESCRIPTION_PROMPT, context)
            );

            // Parse results
            const headlines = this.parseJsonArray(headlinesResult, 15);
            const descriptions = this.parseJsonArray(descriptionsResult, 4);

            // Validate and filter
            const validHeadlines = headlines
                .filter(h => h.length <= 30 && h.length >= 5)
                .slice(0, 15);
            const validDescriptions = descriptions
                .filter(d => d.length <= 90 && d.length >= 20)
                .slice(0, 4);

            // If we got enough valid content, return AI-generated
            if (validHeadlines.length >= 10 && validDescriptions.length >= 2) {
                return {
                    headlines: validHeadlines,
                    descriptions: validDescriptions,
                    source: 'ai',
                    notes: [`Generated ${validHeadlines.length} headlines and ${validDescriptions.length} descriptions`]
                };
            }

            // Supplement with templates if needed
            const templateCopy = this.generateTemplateBasedCopy(context);
            return {
                headlines: [...validHeadlines, ...templateCopy.headlines].slice(0, 15),
                descriptions: [...validDescriptions, ...templateCopy.descriptions].slice(0, 4),
                source: 'ai',
                notes: ['AI-generated with template supplementation']
            };

        } catch (error) {
            Logger.warn('AI copy generation failed, using templates', { error });
            return this.generateTemplateBasedCopy(context);
        }
    }

    /**
     * Build prompt with context substitution and tone instruction
     */
    private static buildPrompt(template: string, context: AdCopyContext): string {
        const productNames = context.topProducts.map(p => p.name).join(', ');
        const categories = context.categories?.join(', ') || 'Various';
        const toneInstruction = context.tonePreset
            ? TONE_INSTRUCTIONS[context.tonePreset]
            : '';

        return template
            .replace('{storeName}', context.storeName)
            .replace('{products}', productNames)
            .replace('{avgOrderValue}', `$${context.avgOrderValue.toFixed(0)}`)
            .replace('{categories}', categories)
            .replace('{toneInstruction}', toneInstruction);
    }

    /**
     * Call OpenRouter API
     */
    private static async callOpenRouter(
        apiKey: string,
        model: string,
        prompt: string
    ): Promise<string> {
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': process.env.APP_URL || 'https://localhost:3000',
                'X-Title': `${process.env.APP_NAME || 'Commerce Platform'} Ad Copy Generator`
            },
            body: JSON.stringify({
                model,
                messages: [
                    { role: 'user', content: prompt }
                ],
                max_tokens: 1000,
                temperature: 0.7
            })
        });

        if (!response.ok) {
            throw new Error(`OpenRouter API error: ${response.status}`);
        }

        const data = await response.json();
        return data.choices?.[0]?.message?.content || '';
    }

    /**
     * Parse JSON array from AI response
     */
    private static parseJsonArray(content: string, expectedCount: number): string[] {
        try {
            // Try to extract JSON array from response
            const jsonMatch = content.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                if (Array.isArray(parsed)) {
                    return parsed.filter(item => typeof item === 'string');
                }
            }
            return [];
        } catch {
            // If JSON parsing fails, try to extract quoted strings
            const quotes = content.match(/"([^"]{5,90})"/g);
            if (quotes) {
                return quotes.map(q => q.replace(/"/g, '')).slice(0, expectedCount);
            }
            return [];
        }
    }

    /**
     * Generate template-based copy as fallback
     */
    private static generateTemplateBasedCopy(context: AdCopyContext): GeneratedAdCopy {
        const { storeName, topProducts, avgOrderValue, platform } = context;
        const mainProduct = topProducts[0]?.name?.slice(0, 20) || 'Products';
        const productWord = mainProduct.split(' ')[0];

        const headlines = [
            `Shop ${mainProduct.slice(0, 20)}`,
            `Buy ${productWord} Online`,
            'Free Shipping Available',
            'Shop Now & Save',
            `${storeName.slice(0, 20)} Official`,
            'Quality Guaranteed',
            'Trusted by Thousands',
            `From $${Math.floor(avgOrderValue * 0.3)}`,
            'Order Today',
            'Premium Quality',
            topProducts[1]?.name?.slice(0, 25) || 'Top Rated Products',
            'Fast Delivery',
            '100% Satisfaction',
            `Shop ${storeName.slice(0, 15)}`,
            'Limited Time Offer'
        ].filter(h => h.length <= 30);

        const descriptions = [
            `Shop our best-selling ${productWord}. Quality craftsmanship & fast delivery.`,
            `${storeName} - Your trusted source for premium products. Free shipping on orders.`,
            `Discover why thousands trust ${storeName}. 100% satisfaction guarantee.`,
            `Quality ${productWord} at great prices. Order today for fast, reliable delivery.`
        ].filter(d => d.length <= 90);

        // Add Meta primary texts for meta/both platforms
        const primaryTexts = (platform === 'meta' || platform === 'both') ? [
            `Discover ${mainProduct} at ${storeName}. Quality you can trust, delivered fast.`,
            `Why wait? Shop ${productWord} now and experience the ${storeName} difference.`,
            `Join thousands of happy customers. ${storeName} delivers quality every time.`
        ].filter(p => p.length <= 125) : undefined;

        return {
            headlines,
            descriptions,
            primaryTexts,
            source: 'template',
            platform,
            notes: ['Generated from templates - configure AI for better results']
        };
    }

    /**
     * Generate ad copy for Meta Ads (Facebook/Instagram)
     */
    static async generateForMeta(
        accountId: string,
        context: AdCopyContext
    ): Promise<GeneratedAdCopy> {
        try {
            const account = await prisma.account.findUnique({
                where: { id: accountId },
                select: { openRouterApiKey: true, aiModel: true }
            });

            if (!account?.openRouterApiKey) {
                Logger.debug('No OpenRouter API key, using template fallback for Meta');
                return this.generateTemplateBasedCopy({ ...context, platform: 'meta' });
            }

            const model = account.aiModel || 'mistralai/mistral-7b-instruct';

            // Generate primary texts
            const primaryTextsResult = await this.callOpenRouter(
                account.openRouterApiKey,
                model,
                this.buildPrompt(META_PRIMARY_TEXT_PROMPT, context)
            );

            // Generate headlines
            const headlinesResult = await this.callOpenRouter(
                account.openRouterApiKey,
                model,
                this.buildPrompt(META_HEADLINE_PROMPT, context)
            );

            const primaryTexts = this.parseJsonArray(primaryTextsResult, 3)
                .filter(p => p.length <= 125 && p.length >= 20)
                .slice(0, 3);
            const headlines = this.parseJsonArray(headlinesResult, 5)
                .filter(h => h.length <= 40 && h.length >= 5)
                .slice(0, 5);

            if (primaryTexts.length >= 2 && headlines.length >= 3) {
                return {
                    headlines,
                    descriptions: [], // Meta uses primary text, not descriptions
                    primaryTexts,
                    source: 'ai',
                    platform: 'meta',
                    notes: [`Generated ${primaryTexts.length} primary texts and ${headlines.length} headlines for Meta`]
                };
            }

            // Fallback
            return this.generateTemplateBasedCopy({ ...context, platform: 'meta' });
        } catch (error) {
            Logger.warn('Meta copy generation failed, using templates', { error });
            return this.generateTemplateBasedCopy({ ...context, platform: 'meta' });
        }
    }

    /**
     * Generate ad copy for both platforms
     */
    static async generateForBothPlatforms(
        accountId: string,
        context: AdCopyContext
    ): Promise<GeneratedAdCopy> {
        const [googleCopy, metaCopy] = await Promise.all([
            this.generate(accountId, { ...context, platform: 'google' }),
            this.generateForMeta(accountId, { ...context, platform: 'meta' })
        ]);

        return {
            headlines: googleCopy.headlines,
            descriptions: googleCopy.descriptions,
            primaryTexts: metaCopy.primaryTexts,
            source: googleCopy.source === 'ai' || metaCopy.source === 'ai' ? 'ai' : 'template',
            platform: 'both',
            notes: [
                ...(googleCopy.notes || []),
                ...(metaCopy.notes || [])
            ]
        };
    }

    /**
     * Bulk generate ad copy for multiple products
     */
    static async generateBulk(
        accountId: string,
        options: BulkGenerationOptions
    ): Promise<BulkGenerationResult> {
        const { tonePreset, platform, productIds, maxProducts = 50 } = options;

        // Get account info for store context
        const account = await prisma.account.findUnique({
            where: { id: accountId },
            select: {
                name: true,
                wooUrl: true,
                openRouterApiKey: true,
                aiModel: true
            }
        });

        if (!account) {
            throw new Error('Account not found');
        }

        // Get products to generate for
        let products;
        if (productIds && productIds.length > 0) {
            products = await prisma.wooProduct.findMany({
                where: {
                    accountId,
                    id: { in: productIds }
                },
                select: { id: true, name: true, sku: true, price: true },
                take: maxProducts
            });
        } else {
            // Get top products by order count or recent updates
            products = await prisma.wooProduct.findMany({
                where: { accountId },
                select: { id: true, name: true, sku: true, price: true },
                orderBy: { updatedAt: 'desc' },
                take: maxProducts
            });
        }

        const result: BulkGenerationResult = {
            generated: [],
            failed: [],
            totalProducts: products.length,
            successCount: 0,
            failedCount: 0
        };

        // Process products in batches to avoid overloading API
        const BATCH_SIZE = 5;
        for (let i = 0; i < products.length; i += BATCH_SIZE) {
            const batch = products.slice(i, i + BATCH_SIZE);

            const batchPromises = batch.map(async (product) => {
                try {
                    const context: AdCopyContext = {
                        storeName: account.name || 'Store',
                        storeUrl: account.wooUrl || '',
                        topProducts: [{
                            name: product.name,
                            price: product.price ? parseFloat(product.price.toString()) : undefined,
                            sku: product.sku || undefined
                        }],
                        avgOrderValue: product.price ? parseFloat(product.price.toString()) : 50,
                        tonePreset,
                        platform
                    };

                    let copy: GeneratedAdCopy;
                    if (platform === 'meta') {
                        copy = await this.generateForMeta(accountId, context);
                    } else if (platform === 'both') {
                        copy = await this.generateForBothPlatforms(accountId, context);
                    } else {
                        copy = await this.generate(accountId, context);
                    }

                    result.generated.push({
                        productId: product.id,
                        productName: product.name,
                        sku: product.sku || undefined,
                        copy
                    });
                    result.successCount++;
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                    result.failed.push({
                        productId: product.id,
                        productName: product.name,
                        error: errorMessage
                    });
                    result.failedCount++;
                }
            });

            await Promise.all(batchPromises);

            // Small delay between batches to respect rate limits
            if (i + BATCH_SIZE < products.length) {
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }

        Logger.info('Bulk ad copy generation complete', {
            accountId,
            total: result.totalProducts,
            success: result.successCount,
            failed: result.failedCount
        });

        return result;
    }

    /**
     * Generate N variants of base ad copy for A/B testing.
     * Each variant uses a different messaging angle.
     * Part of AI Co-Pilot v2 - Phase 4: Creative A/B Engine.
     */
    static async generateVariants(
        accountId: string,
        baseCopy: GeneratedAdCopy,
        variantCount: number,
        platform: AdPlatform = 'google'
    ): Promise<GeneratedAdCopy[]> {
        Logger.info('[AdCopyGenerator] Generating variants', {
            accountId,
            variantCount,
            platform
        });

        const variants: GeneratedAdCopy[] = [baseCopy]; // First variant is control

        try {
            const account = await prisma.account.findUnique({
                where: { id: accountId },
                select: { openRouterApiKey: true, aiModel: true }
            });

            const apiKey = account?.openRouterApiKey;
            const model = account?.aiModel || 'mistralai/mistral-7b-instruct';

            if (!apiKey) {
                // Fallback: generate simple template variations
                for (let i = 1; i < variantCount; i++) {
                    variants.push(this.generateTemplateVariant(baseCopy, i, platform));
                }
                return variants;
            }

            // Generate AI-powered variants
            const prompt = this.buildVariantPrompt(baseCopy, variantCount - 1, platform);
            const response = await this.callOpenRouter(apiKey, model, prompt);

            try {
                const parsed = JSON.parse(response);
                if (Array.isArray(parsed)) {
                    for (const variantData of parsed.slice(0, variantCount - 1)) {
                        variants.push({
                            headlines: variantData.headlines || baseCopy.headlines,
                            descriptions: variantData.descriptions || baseCopy.descriptions,
                            primaryTexts: variantData.primaryTexts || baseCopy.primaryTexts,
                            source: 'ai',
                            platform
                        });
                    }
                }
            } catch {
                // Fallback if AI response can't be parsed
                for (let i = 1; i < variantCount; i++) {
                    variants.push(this.generateTemplateVariant(baseCopy, i, platform));
                }
            }

        } catch (error: any) {
            Logger.error('[AdCopyGenerator] Variant generation failed', {
                accountId,
                error: error.message
            });

            // Fallback: generate template variations
            for (let i = variants.length; i < variantCount; i++) {
                variants.push(this.generateTemplateVariant(baseCopy, i, platform));
            }
        }

        return variants;
    }

    /**
     * Build prompt for variant generation.
     */
    private static buildVariantPrompt(
        baseCopy: GeneratedAdCopy,
        variantCount: number,
        platform: AdPlatform
    ): string {
        const limits = PLATFORM_LIMITS[platform];
        const headlineLimit = platform === 'google' ? limits.headline : limits.headline;
        const descLimit = platform === 'google' ? limits.description : limits.primaryText;

        return `You are an expert ad copywriter. Generate ${variantCount} unique variations of the following ad copy for A/B testing.

ORIGINAL COPY:
Headlines: ${JSON.stringify(baseCopy.headlines)}
Descriptions: ${JSON.stringify(baseCopy.descriptions)}

RULES FOR VARIATIONS:
- Each variation should have a distinct messaging angle
- Variation angles to try: benefit-focused, feature-focused, urgency, social proof, curiosity, value proposition
- Headlines max ${headlineLimit} characters each
- Descriptions max ${descLimit} characters each
- Maintain the core value proposition but change the approach
- Make each variation genuinely different, not just word swaps

OUTPUT FORMAT: Return ONLY a JSON array of ${variantCount} objects, each with "headlines" (array of strings) and "descriptions" (array of strings).`;
    }

    /**
     * Generate a template-based variant as fallback.
     */
    private static generateTemplateVariant(
        baseCopy: GeneratedAdCopy,
        variantIndex: number,
        platform: AdPlatform
    ): GeneratedAdCopy {
        const angles = ['Shop Now', 'Discover More', 'Get Yours', 'Limited Time', 'Best Value'];
        const angle = angles[variantIndex % angles.length];

        // Modify headlines with different CTAs
        const modifiedHeadlines = baseCopy.headlines.map((h, i) => {
            if (i === 0 && h.length > 5) {
                const limit = PLATFORM_LIMITS[platform].headline;
                return `${angle} - ${h.slice(0, limit - angle.length - 3)}`.slice(0, limit);
            }
            return h;
        });

        // Modify first description
        const modifiedDescriptions = [...baseCopy.descriptions];
        if (modifiedDescriptions.length > 0) {
            const prefixes = [
                'Limited time offer. ',
                'Customer favorite. ',
                'Best seller. ',
                'Top rated. ',
                'Premium quality. '
            ];
            const prefix = prefixes[variantIndex % prefixes.length];
            const descLimit = PLATFORM_LIMITS[platform].description;
            modifiedDescriptions[0] = `${prefix}${modifiedDescriptions[0]}`.slice(0, descLimit);
        }

        return {
            headlines: modifiedHeadlines,
            descriptions: modifiedDescriptions,
            primaryTexts: baseCopy.primaryTexts,
            source: 'template',
            platform,
            notes: [`Variant ${variantIndex + 1}: ${angle} angle`]
        };
    }
}

