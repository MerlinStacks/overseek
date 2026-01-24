/**
 * Ad Copy Generator Service
 * 
 * Uses OpenRouter AI to generate compelling, contextual ad copy
 * for Google Search campaigns based on store and product data.
 */

import { Logger } from '../../utils/logger';
import { prisma } from '../../utils/prisma';

// =============================================================================
// TYPES
// =============================================================================

export interface AdCopyContext {
    storeName: string;
    storeUrl: string;
    topProducts: { name: string; price?: number }[];
    avgOrderValue: number;
    categories?: string[];
    /** Optional: brand voice/tone description */
    brandVoice?: string;
}

export interface GeneratedAdCopy {
    headlines: string[];
    descriptions: string[];
    /** Indicates if this was AI-generated or template fallback */
    source: 'ai' | 'template';
    /** Any warnings or notes about the generation */
    notes?: string[];
}

// =============================================================================
// PROMPTS
// =============================================================================

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

OUTPUT FORMAT: Return ONLY a JSON array of 4 description strings, nothing else.`;

// =============================================================================
// SERVICE
// =============================================================================

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
     * Build prompt with context substitution
     */
    private static buildPrompt(template: string, context: AdCopyContext): string {
        const productNames = context.topProducts.map(p => p.name).join(', ');
        const categories = context.categories?.join(', ') || 'Various';

        return template
            .replace('{storeName}', context.storeName)
            .replace('{products}', productNames)
            .replace('{avgOrderValue}', `$${context.avgOrderValue.toFixed(0)}`)
            .replace('{categories}', categories);
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
        const { storeName, topProducts, avgOrderValue } = context;
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

        return {
            headlines,
            descriptions,
            source: 'template',
            notes: ['Generated from templates - configure AI for better results']
        };
    }
}
