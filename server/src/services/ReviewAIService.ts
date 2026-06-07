import { prisma } from '../utils/prisma';
import { Logger } from '../utils/logger';

async function safeOpenRouterJson(response: Response): Promise<any> {
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
        const bodySnippet = (await response.text()).slice(0, 200);
        Logger.warn('OpenRouter returned non-JSON response for review reply', { status: response.status, contentType, bodySnippet });
        throw new Error('OpenRouter returned a non-JSON response');
    }

    return response.json();
}

function stripHtmlTags(value: string): string {
    return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function injectReviewVariables(template: string, review: { rating: number; content: string | null; productName: string | null; reviewer: string }, currentDraft?: string): string {
    return template
        .replace(/\{\{rating\}\}/g, String(review.rating))
        .replace(/\{\{review_text\}\}/g, review.content || 'No review text')
        .replace(/\{\{product_name\}\}/g, review.productName || 'Unknown Product')
        .replace(/\{\{reviewer_name\}\}/g, review.reviewer || 'Customer')
        .replace(/\{\{current_draft\}\}/g, currentDraft?.trim() || '');
}

export class ReviewAIService {
    static async generateReply(accountId: string, reviewId: string, currentDraft?: string): Promise<{ reply: string; error?: string }> {
        try {
            const [account, review] = await Promise.all([
                prisma.account.findUnique({
                    where: { id: accountId },
                    select: { openRouterApiKey: true, aiModel: true }
                }),
                prisma.wooReview.findUnique({
                    where: { id: reviewId },
                    select: { accountId: true, rating: true, content: true, productName: true, reviewer: true }
                })
            ]);

            if (!account?.openRouterApiKey) {
                return {
                    reply: '',
                    error: 'AI is not configured. Please set your OpenRouter API key in Settings > Intelligence.'
                };
            }

            if (!review || review.accountId !== accountId) {
                return { reply: '', error: 'Review not found' };
            }

            const [accountPromptTemplate, globalPromptTemplate] = await Promise.all([
                prisma.accountAIPrompt.findUnique({
                    where: { accountId_promptId: { accountId, promptId: 'review_reply' } }
                }),
                prisma.aIPrompt.findUnique({
                    where: { promptId: 'review_reply' }
                })
            ]);

            const basePrompt = accountPromptTemplate?.content || globalPromptTemplate?.content || this.getDefaultPrompt();
            const systemPrompt = injectReviewVariables(basePrompt, review, currentDraft);
            const userMessage = currentDraft?.trim()
                ? `Improve this draft review reply while keeping it concise and ready to post:\n\n${stripHtmlTags(currentDraft.trim())}`
                : 'Generate a concise customer review reply that is ready to post.';

            const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${account.openRouterApiKey}`,
                    'HTTP-Referer': process.env.APP_URL || 'http://localhost:5173',
                    'X-Title': process.env.APP_NAME || 'Commerce Platform',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: account.aiModel || 'openai/gpt-4o',
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: userMessage }
                    ]
                })
            });

            if (!response.ok) {
                const err = await response.text();
                Logger.error('OpenRouter API error for review reply', { error: err });
                return { reply: '', error: 'Failed to generate reply. Please try again.' };
            }

            const data = await safeOpenRouterJson(response);
            const generatedReply = stripHtmlTags(data.choices?.[0]?.message?.content || '');
            if (!generatedReply) return { reply: '', error: 'AI returned an empty reply. Please try again.' };

            return { reply: generatedReply };
        } catch (error) {
            Logger.error('ReviewAIService.generateReply error', { error });
            return { reply: '', error: 'An unexpected error occurred while generating the reply.' };
        }
    }

    private static getDefaultPrompt(): string {
        return `You are responding to a customer review on behalf of the store. Generate a professional and warm reply:

Review Rating: {{rating}}/5
Review Text: {{review_text}}
Product: {{product_name}}
Reviewer: {{reviewer_name}}

Guidelines:
- Thank the customer
- Address specific points mentioned
- If negative, acknowledge the issue and invite them to contact support
- Keep it under 100 words
- Return plain text only, with no markdown or HTML`;
    }
}
