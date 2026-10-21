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
import { z } from 'zod';
const briefSchema = z.object({ suggestedTitle: z.string().trim().min(1).max(60), metaDescription: z.string().trim().min(1).max(155),
    wordCount: z.number().int().min(100).max(20000), headingOutline: z.array(z.string().trim().min(1).max(300)).min(1).max(20),
    keyTopics: z.array(z.string().trim().min(1).max(300)).min(1).max(20), internalLinkSuggestions: z.array(z.string().trim().min(1).max(300)).max(10),
    contentType: z.enum(['blog post', 'guide', 'landing page', 'product page', 'comparison']), tone: z.enum(['informational', 'commercial', 'transactional', 'navigational']) });

/** Content brief output */
export interface ContentBrief {
    keyword: string;
    currentPosition: number | null;
    currentClicks: number | null;
    currentImpressions: number | null;
    provenance: 'ai' | 'template';
    fallbackReason?: 'not-configured' | 'generation-failed';
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
        _keywordId?: string
    ): Promise<ContentBrief> {
        keyword = z.string().trim().min(1).max(200).parse(keyword).replace(/\s+/g, ' ');
        if (_keywordId && !await prisma.trackedKeyword.findFirst({ where: { id: _keywordId, accountId, keyword: { equals: keyword, mode: 'insensitive' } } })) throw new Error('Tracked keyword not found in account');
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
        let provenance: ContentBrief['provenance'] = 'template';
        let fallbackReason: ContentBrief['fallbackReason'] = 'not-configured';

        if (account?.openRouterApiKey) {
            try {
            brief = await this.generateAIBrief(
                account.openRouterApiKey,
                account.aiModel || 'google/gemini-2.0-flash-001',
                keyword,
                kwData,
                relatedQueries
            );
            provenance = 'ai'; fallbackReason = undefined;
            } catch {
                Logger.warn('AI content brief generation failed; returning labelled template');
                brief = this.generateTemplateBrief(keyword, kwData, relatedQueries); fallbackReason = 'generation-failed';
            }
        } else {
            // Template-based fallback when no API key
            brief = this.generateTemplateBrief(keyword, kwData, relatedQueries);
        }

        return {
            keyword,
            currentPosition: Number.isFinite(kwData?.position) && kwData.position > 0 ? kwData.position : null,
            currentClicks: Number.isFinite(kwData?.clicks) && kwData.clicks >= 0 ? kwData.clicks : null,
            currentImpressions: Number.isFinite(kwData?.impressions) && kwData.impressions >= 0 ? kwData.impressions : null,
            provenance, fallbackReason,
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
Current Clicks: ${kwData?.clicks ?? 'Unavailable'}
Current Impressions: ${kwData?.impressions ?? 'Unavailable'}
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
                signal: AbortSignal.timeout(30000),
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
            const content = data.choices?.[0]?.message?.content;
            if (typeof content !== 'string' || content.length > 30000) throw new Error('Invalid brief response');

            // Parse JSON from response (handle potential markdown wrapping)
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                return briefSchema.parse(JSON.parse(jsonMatch[0]));
            }

            throw new Error('No valid JSON in AI response');
        } catch (error) {
            throw new Error('AI content brief unavailable', { cause: error });
        }
    }

    /**
     * Template-based fallback brief when AI is unavailable
     */
    private static generateTemplateBrief(
        keyword: string,
        _kwData: any,
        relatedQueries: string[]
    ): ContentBrief['brief'] {
        const titleKeyword = keyword.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
        const isCommercial = keyword.includes('buy') || keyword.includes('best') || keyword.includes('review');

        return {
            suggestedTitle: `${titleKeyword}: ${isCommercial ? 'Comparison outline' : 'Guide outline'}`.slice(0, 60),
            metaDescription: `Planning outline for ${keyword}. Review facts, topics and available internal links before publishing.`.slice(0, 155),
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
