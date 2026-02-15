/**
 * AI Content Brief Service
 *
 * Generates AI-powered content briefs for target keywords using
 * OpenRouter. Combines Search Console data with AI analysis to
 * produce actionable content recommendations.
 */

import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';
import { SearchConsoleService } from './SearchConsoleService';

/** Content brief output */
export interface ContentBrief {
    keyword: string;
    currentPosition: number | null;
    currentClicks: number;
    currentImpressions: number;
    brief: {
        suggestedTitle: string;
        metaDescription: string;
        wordCount: number;
        headingOutline: string[];
        keyTopics: string[];
        internalLinkSuggestions: string[];
        contentType: string;
        tone: string;
    };
    generatedAt: string;
}

export class ContentBriefService {

    /**
     * Generate an AI content brief for a keyword.
     * Uses the account's OpenRouter API key and current Search Console data.
     */
    static async generateBrief(
        accountId: string,
        keyword: string,
        keywordId?: string
    ): Promise<ContentBrief> {
        // Get current search data for context
        const analytics = await SearchConsoleService.getSearchAnalytics(accountId, { days: 28 });
        const kwData = analytics.find(q => q.query.toLowerCase() === keyword.toLowerCase());

        // Get related queries for topic coverage
        const relatedQueries = analytics
            .filter(q => q.query.includes(keyword.split(' ')[0]) && q.query !== keyword.toLowerCase())
            .slice(0, 10)
            .map(q => q.query);

        // Get AI generation (OpenRouter)
        const account = await prisma.account.findUnique({
            where: { id: accountId },
            select: { openRouterApiKey: true, aiModel: true }
        });

        let brief: ContentBrief['brief'];

        if (account?.openRouterApiKey) {
            brief = await this.generateAIBrief(
                account.openRouterApiKey,
                account.aiModel || 'google/gemini-2.0-flash-001',
                keyword,
                kwData,
                relatedQueries
            );
        } else {
            // Template-based fallback when no API key
            brief = this.generateTemplateBrief(keyword, kwData, relatedQueries);
        }

        return {
            keyword,
            currentPosition: kwData?.position ?? null,
            currentClicks: kwData?.clicks ?? 0,
            currentImpressions: kwData?.impressions ?? 0,
            brief,
            generatedAt: new Date().toISOString(),
        };
    }

    /**
     * Generate brief using OpenRouter AI
     */
    private static async generateAIBrief(
        apiKey: string,
        model: string,
        keyword: string,
        kwData: any,
        relatedQueries: string[]
    ): Promise<ContentBrief['brief']> {
        const prompt = `You are an expert SEO content strategist. Generate a comprehensive content brief for the target keyword.

Target Keyword: "${keyword}"
Current Position: ${kwData?.position ?? 'Not ranking'}
Current Clicks: ${kwData?.clicks ?? 0}
Current Impressions: ${kwData?.impressions ?? 0}
Related Queries: ${relatedQueries.join(', ') || 'None found'}

Generate a JSON response with these exact fields:
{
  "suggestedTitle": "Compelling SEO-optimized title (60 chars max)",
  "metaDescription": "Compelling meta description (155 chars max)",
  "wordCount": recommended word count as a number,
  "headingOutline": ["H2: heading", "H3: subheading", ...] array of 5-8 headings,
  "keyTopics": ["topic1", "topic2", ...] array of 5-10 key topics to cover,
  "internalLinkSuggestions": ["descriptive link anchor text"] array of 3-5 suggestions,
  "contentType": "blog post" | "guide" | "landing page" | "product page" | "comparison",
  "tone": "informational" | "commercial" | "transactional" | "navigational"
}

Return ONLY the JSON, no markdown formatting or explanation.`;

        try {
            const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`,
                },
                body: JSON.stringify({
                    model,
                    messages: [{ role: 'user', content: prompt }],
                    temperature: 0.7,
                    max_tokens: 1000,
                })
            });

            if (!response.ok) {
                throw new Error(`OpenRouter API error: ${response.status}`);
            }

            const data = await response.json();
            const content = data.choices?.[0]?.message?.content || '';

            // Parse JSON from response (handle potential markdown wrapping)
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[0]);
            }

            throw new Error('No valid JSON in AI response');
        } catch (error) {
            Logger.warn('AI content brief generation failed, using template', { error, keyword });
            return this.generateTemplateBrief(keyword, kwData, relatedQueries);
        }
    }

    /**
     * Template-based fallback brief when AI is unavailable
     */
    private static generateTemplateBrief(
        keyword: string,
        kwData: any,
        relatedQueries: string[]
    ): ContentBrief['brief'] {
        const titleKeyword = keyword.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
        const isCommercial = keyword.includes('buy') || keyword.includes('best') || keyword.includes('review');

        return {
            suggestedTitle: isCommercial
                ? `Best ${titleKeyword}: Complete Guide & Top Picks (${new Date().getFullYear()})`
                : `${titleKeyword}: Everything You Need to Know (${new Date().getFullYear()})`,
            metaDescription: `Discover everything about ${keyword}. Our comprehensive guide covers key topics, expert tips, and actionable advice to help you succeed.`,
            wordCount: isCommercial ? 2000 : 1500,
            headingOutline: [
                `H2: What is ${titleKeyword}?`,
                `H2: Key Benefits of ${titleKeyword}`,
                `H2: How to Get Started with ${titleKeyword}`,
                `H2: Common Mistakes to Avoid`,
                `H2: Expert Tips and Best Practices`,
                `H2: Frequently Asked Questions`,
            ],
            keyTopics: [keyword, ...relatedQueries.slice(0, 5)],
            internalLinkSuggestions: [
                `Related guide on ${relatedQueries[0] || keyword}`,
                `Product page for ${keyword}`,
                `Compare ${keyword} options`,
            ],
            contentType: isCommercial ? 'comparison' : 'guide',
            tone: isCommercial ? 'commercial' : 'informational',
        };
    }
}
