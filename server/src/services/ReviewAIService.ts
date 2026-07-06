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

function formatDate(value: Date | string | null | undefined): string {
    if (!value) return 'Unknown';
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return 'Unknown';
    return date.toISOString().slice(0, 10);
}

function asRecord(value: unknown): Record<string, any> {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
}

function formatLineItem(item: any): string {
    const name = stripHtmlTags(String(item?.name || 'Unknown item'));
    const quantity = Number(item?.quantity || 1);
    const metaData = Array.isArray(item?.meta_data) ? item.meta_data : [];
    const visibleMeta = metaData
        .map((meta: any) => {
            const key = stripHtmlTags(String(meta?.display_key || meta?.key || '')).trim();
            const value = stripHtmlTags(String(meta?.display_value || meta?.value || '')).trim();
            if (!key || !value || key.startsWith('_')) return null;
            return `${key}: ${value}`;
        })
        .filter(Boolean)
        .slice(0, 4);

    return `${quantity} x ${name}${visibleMeta.length ? ` (${visibleMeta.join(', ')})` : ''}`;
}

function formatOrderContext(review: {
    order?: { number: string; status: string; currency: string; total: unknown; dateCreated: Date; rawData: unknown } | null;
    customer?: { firstName: string | null; lastName: string | null; email: string; totalSpent: unknown; ordersCount: number } | null;
}): string {
    const lines: string[] = [];

    if (review.order) {
        const rawOrder = asRecord(review.order.rawData);
        const lineItems = Array.isArray(rawOrder.line_items) ? rawOrder.line_items : [];
        lines.push(`Order Number: ${review.order.number}`);
        lines.push(`Order Status: ${review.order.status}`);
        lines.push(`Order Date: ${formatDate(review.order.dateCreated)}`);
        lines.push(`Order Total: ${review.order.currency} ${String(review.order.total)}`);
        if (lineItems.length > 0) {
            lines.push(`Purchased Items: ${lineItems.slice(0, 6).map(formatLineItem).join('; ')}`);
        }
    } else {
        lines.push('Order Context: No matched order is available for this review. Do not invent order details.');
    }

    if (review.customer) {
        const customerName = [review.customer.firstName, review.customer.lastName].filter(Boolean).join(' ').trim();
        lines.push(`Customer: ${customerName || review.customer.email}`);
        lines.push(`Customer History: ${review.customer.ordersCount} orders, total spent ${String(review.customer.totalSpent)}`);
    }

    return lines.join('\n');
}

function buildUserMessage(review: {
    rating: number;
    content: string | null;
    productName: string | null;
    reviewer: string;
    order?: { number: string; status: string; currency: string; total: unknown; dateCreated: Date; rawData: unknown } | null;
    customer?: { firstName: string | null; lastName: string | null; email: string; totalSpent: unknown; ordersCount: number } | null;
}, currentDraft?: string): string {
    const context = `REVIEW CONTEXT
Reviewer: ${review.reviewer || 'Customer'}
Rating: ${review.rating}/5
Product Reviewed: ${review.productName || 'Unknown Product'}
Review Text: ${review.content || 'No review text'}

ORDER AND CUSTOMER CONTEXT
${formatOrderContext(review)}`;

    const task = currentDraft?.trim()
        ? `Rewrite this draft into a direct, ready-to-post customer review reply. Keep any useful specifics, but remove anything that sounds generic, corporate, explanatory, or AI-written.\n\nCURRENT DRAFT:\n${stripHtmlTags(currentDraft.trim())}`
        : 'Write a direct, ready-to-post customer review reply using the review context.';

    return `${context}\n\nTASK\n${task}\n\nReturn exactly one reply the store can post as-is. Write only the reply text, as if typed by a real person from the store. Do not include labels, analysis, markdown, numbering, multiple options, placeholders, greetings like "Dear", sign-offs, hashtags, emojis, or any mention of AI. Do not explain that you used the review or order context. Do not mention order details unless they are directly relevant and present above. Keep it natural, specific, and concise.`;
}

function injectReviewVariables(template: string, review: { rating: number; content: string | null; productName: string | null; reviewer: string; order?: { number: string; status: string; currency: string; total: unknown; dateCreated: Date; rawData: unknown } | null; customer?: { firstName: string | null; lastName: string | null; email: string; totalSpent: unknown; ordersCount: number } | null }, currentDraft?: string): string {
    return template
        .replace(/\{\{rating\}\}/g, String(review.rating))
        .replace(/\{\{review_text\}\}/g, review.content || 'No review text')
        .replace(/\{\{product_name\}\}/g, review.productName || 'Unknown Product')
        .replace(/\{\{reviewer_name\}\}/g, review.reviewer || 'Customer')
        .replace(/\{\{customer_name\}\}/g, review.customer ? [review.customer.firstName, review.customer.lastName].filter(Boolean).join(' ').trim() || review.reviewer || 'Customer' : review.reviewer || 'Customer')
        .replace(/\{\{order_details\}\}/g, formatOrderContext(review))
        .replace(/\{\{order_number\}\}/g, review.order?.number || '')
        .replace(/\{\{order_status\}\}/g, review.order?.status || '')
        .replace(/\{\{order_items\}\}/g, review.order ? formatOrderContext(review).split('\n').find((line) => line.startsWith('Purchased Items:'))?.replace('Purchased Items: ', '') || '' : '')
        .replace(/\{\{current_draft\}\}/g, currentDraft?.trim() || '');
}

function reviewReplyStyleGuard(): string {
    return `

NON-NEGOTIABLE OUTPUT RULES
- Return only the exact reply text to post publicly under the review.
- Do not describe the reply, explain your reasoning, mention AI, or include labels.
- Do not use markdown, HTML, numbering, bullets, hashtags, emojis, sign-offs, or multiple options.
- Do not use generic filler such as "we value your feedback", "thank you for bringing this to our attention", or "we strive to".
- Avoid corporate, technical, policy, or process language.
- Sound like a real store team member: warm, direct, natural, and concise.
- Keep it under 70 words unless the current draft is already longer and needs the detail.
- For positive reviews, say thanks and refer to a specific detail when available.
- For negative reviews, acknowledge the issue plainly, apologise where appropriate, and invite them to contact support without sounding defensive.
- Do not mention order details unless they are directly useful to the customer reply.`;
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
                    select: {
                        accountId: true,
                        rating: true,
                        content: true,
                        productName: true,
                        reviewer: true,
                        order: {
                            select: { number: true, status: true, currency: true, total: true, dateCreated: true, rawData: true }
                        },
                        customer: {
                            select: { firstName: true, lastName: true, email: true, totalSpent: true, ordersCount: true }
                        }
                    }
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
            const systemPrompt = `${injectReviewVariables(basePrompt, review, currentDraft)}${reviewReplyStyleGuard()}`;
            const userMessage = buildUserMessage(review, currentDraft);

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
        return `You write customer-facing review replies for the store. Your output must be a direct reply suggestion the team can post without editing.

Review Rating: {{rating}}/5
Review Text: {{review_text}}
Product: {{product_name}}
Reviewer: {{reviewer_name}}
Order Details:
{{order_details}}

Guidelines:
- Sound like a real person from the store, not an AI assistant or support script
- Match a warm, confident ecommerce brand voice: helpful, friendly, clear, and not overly formal
- Reply directly to the customer, using their name only if it feels natural
- Reference the product or review details only when it adds value
- For positive reviews, keep it appreciative and brief
- For negative reviews, acknowledge the issue plainly, apologise where appropriate, and invite them to contact support without being defensive
- Avoid tech talk, internal process details, policy explanations, marketing fluff, clichés, and phrases like "we value your feedback"
- Keep it under 70 words
- Return exactly one ready-to-post reply
- Return plain text only, with no markdown, HTML, labels, classification, numbering, sign-off, or multiple options`;
    }
}
