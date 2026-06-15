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
        ? `Improve this current draft while using the review and order context.\n\nCURRENT DRAFT:\n${stripHtmlTags(currentDraft.trim())}`
        : 'Generate a concise customer review reply using the review and order context.';

    return `${context}\n\nTASK\n${task}\n\nReturn exactly one ready-to-post reply. Do not include classification, labels, analysis, markdown, numbering, or multiple options. Do not mention order details unless they are directly relevant and present above.`;
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
            const systemPrompt = injectReviewVariables(basePrompt, review, currentDraft);
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
        return `You are responding to a customer review on behalf of the store. Generate a professional and warm reply:

Review Rating: {{rating}}/5
Review Text: {{review_text}}
Product: {{product_name}}
Reviewer: {{reviewer_name}}
Order Details:
{{order_details}}

Guidelines:
- Thank the customer
- Address specific points mentioned
- If negative, acknowledge the issue and invite them to contact support
- Keep it under 100 words
- Return exactly one ready-to-post reply
- Return plain text only, with no markdown, HTML, classification, numbering, or multiple options`;
    }
}
