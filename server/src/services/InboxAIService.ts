/**
 * InboxAIService - Generates AI draft replies for inbox conversations.
 * 
 * Gathers conversation history, customer details, and store policies
 * to provide context for the AI to generate relevant draft replies.
 */

import { prisma } from '../utils/prisma';
import { Logger } from '../utils/logger';
import { cacheAside, CacheTTL } from '../utils/cache';
import { extractOrderTracking, TrackingItem } from '../utils/orderTracking';

interface DraftResult {
    draft: string;
    error?: string;
    warning?: string;  // Informational warning (e.g., no policies configured)
}

interface OrderContext {
    orderNumber: string;
    status: string;
    total: string;
    currency: string;
    dateCreated: string;
    trackingItems: TrackingItem[];
    lineItems: { name: string; quantity: number }[];
}

interface ConversationContext {
    messages: { role: 'customer' | 'agent' | 'system'; content: string; timestamp: string }[];
    customerName: string;
    customerEmail: string;
    totalSpent?: string;
    ordersCount?: number;
    recentOrders: OrderContext[];
}

export class InboxAIService {
    /**
     * Generates an AI draft reply for a conversation.
     * @param conversationId - The conversation to generate a draft for
     * @param accountId - The account ID for fetching policies and AI config
     * @param currentDraft - Optional current draft content to continue/refine
     */
    static async generateDraftReply(conversationId: string, accountId: string, currentDraft?: string): Promise<DraftResult> {
        try {
            // 1. Fetch account AI configuration
            const account = await prisma.account.findUnique({
                where: { id: accountId },
                select: { openRouterApiKey: true, aiModel: true }
            });

            if (!account?.openRouterApiKey) {
                return {
                    draft: '',
                    error: 'AI is not configured. Please set your OpenRouter API key in Settings > Intelligence.'
                };
            }

            // 2. Fetch conversation with messages and customer
            const conversation = await prisma.conversation.findUnique({
                where: { id: conversationId },
                include: {
                    messages: {
                        orderBy: { createdAt: 'asc' },
                        take: 20  // Last 20 messages for context
                    },
                    wooCustomer: true
                }
            });

            if (!conversation) {
                return { draft: '', error: 'Conversation not found' };
            }

            // 3. Look up customer's recent orders for context
            const recentOrders = await this.fetchCustomerOrders(accountId, conversation);

            // 4. Build conversation context (includes orders)
            const context = this.buildConversationContext(conversation, recentOrders);

            // 5. Fetch published policies for the account
            const policies = await cacheAside(
                `policies:${accountId}`,
                async () => prisma.policy.findMany({
                    where: { accountId, isPublished: true },
                    select: { title: true, content: true, type: true },
                    orderBy: [{ type: 'asc' }, { title: 'asc' }]
                }),
                { ttl: CacheTTL.LONG }
            );

            // EDGE CASE: Warn when no policies are configured - AI will give generic responses
            const noPoliciesWarning = policies.length === 0;
            if (noPoliciesWarning) {
                Logger.debug('[InboxAI] No store policies configured - AI responses may be generic', { accountId });
            }

            // 6. Fetch the inbox_draft_reply prompt template
            const promptTemplate = await prisma.aIPrompt.findUnique({
                where: { promptId: 'inbox_draft_reply' }
            });

            // Use default prompt if none configured
            const basePrompt = promptTemplate?.content || this.getDefaultPrompt();

            // 7. Build the full prompt with context
            const fullPrompt = this.injectVariables(basePrompt, context, policies);

            // 8. Call OpenRouter API
            const apiKey = account.openRouterApiKey;
            const model = account.aiModel || 'openai/gpt-4o';

            // 9. Build user message - include current draft if available
            let userMessage = 'Generate a draft reply for this customer conversation.';
            if (currentDraft?.trim()) {
                userMessage = `The agent has already started drafting a reply. Continue, expand, or refine this draft while maintaining the same tone and intent:

CURRENT DRAFT:
${this.stripHtmlTags(currentDraft.trim())}

Generate a complete reply that incorporates and improves upon the current draft.`;
            }

            const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'HTTP-Referer': process.env.APP_URL || 'http://localhost:5173',
                    'X-Title': process.env.APP_NAME || 'Commerce Platform',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model,
                    messages: [
                        { role: 'system', content: fullPrompt },
                        { role: 'user', content: userMessage }
                    ]
                })
            });

            if (!response.ok) {
                const err = await response.text();
                Logger.error('OpenRouter API error', { error: err });
                return { draft: '', error: 'Failed to generate draft. Please try again.' };
            }

            const data = await response.json();
            const draft = data.choices?.[0]?.message?.content || '';

            // Include warning if no policies were configured
            return {
                draft,
                warning: noPoliciesWarning
                    ? 'No store policies configured. Add policies in Settings > Policies for more contextual AI responses.'
                    : undefined
            };

        } catch (error) {
            Logger.error('InboxAIService.generateDraftReply error', { error });
            return { draft: '', error: 'An unexpected error occurred while generating the draft.' };
        }
    }

    /**
     * Generates AI-assisted email content for new message composition.
     * Unlike generateDraftReply, this does not require an existing conversation.
     * @param accountId - The account ID for fetching AI config
     * @param recipient - The email recipient address
     * @param subject - The email subject
     * @param currentDraft - Optional current draft content to improve
     */
    static async generateComposeAssist(
        accountId: string,
        recipient: string,
        subject: string,
        currentDraft?: string
    ): Promise<DraftResult> {
        try {
            // Fetch account AI configuration
            const account = await prisma.account.findUnique({
                where: { id: accountId },
                select: { openRouterApiKey: true, aiModel: true }
            });

            if (!account?.openRouterApiKey) {
                return {
                    draft: '',
                    error: 'AI is not configured. Please set your OpenRouter API key in Settings > Intelligence.'
                };
            }

            // Fetch published policies for context
            const policies = await cacheAside(
                `policies:${accountId}`,
                async () => prisma.policy.findMany({
                    where: { accountId, isPublished: true },
                    select: { title: true, content: true, type: true },
                    orderBy: [{ type: 'asc' }, { title: 'asc' }]
                }),
                { ttl: CacheTTL.LONG }
            );

            const policiesText = policies.length > 0
                ? policies.map(p => `### ${p.title}\n${this.stripHtmlTags(p.content)}`).join('\n\n')
                : 'No store policies configured.';

            // Build system prompt for compose assistance
            const systemPrompt = `You are a helpful email composition assistant. Help draft a professional email.

RECIPIENT: ${recipient}
SUBJECT: ${subject}

STORE POLICIES:
${policiesText}

Guidelines:
- Be polite, professional, and clear
- Match the tone to the subject matter
- Keep the email concise but complete
- Follow store policies when applicable

IMPORTANT: Return the email body as valid HTML. Use:
- <p> for paragraphs
- <strong> for emphasis
- <ul>/<li> for lists if needed

Do NOT include markdown, code blocks, greetings like "Subject:", or any wrapping. Only return the HTML content of the email body.`;

            // Build user message
            let userMessage = `Draft a professional email with subject "${subject}" to ${recipient}.`;
            if (currentDraft?.trim()) {
                userMessage = `I have started drafting an email. Please improve, expand, or refine it while maintaining my intent:

CURRENT DRAFT:
${this.stripHtmlTags(currentDraft.trim())}

Generate a complete, improved version of this email.`;
            }

            // Call OpenRouter API
            const apiKey = account.openRouterApiKey;
            const model = account.aiModel || 'openai/gpt-4o';

            const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'HTTP-Referer': process.env.APP_URL || 'http://localhost:5173',
                    'X-Title': process.env.APP_NAME || 'Commerce Platform',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model,
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: userMessage }
                    ]
                })
            });

            if (!response.ok) {
                const err = await response.text();
                Logger.error('OpenRouter API error (compose)', { error: err });
                return { draft: '', error: 'Failed to generate draft. Please try again.' };
            }

            const data = await response.json();
            const draft = data.choices?.[0]?.message?.content || '';

            return { draft };

        } catch (error) {
            Logger.error('InboxAIService.generateComposeAssist error', { error });
            return { draft: '', error: 'An unexpected error occurred while generating the draft.' };
        }
    }

    /**
     * Fetches the customer's recent orders with tracking data.
     * Why: Gives the AI context about shipment status so it can answer
     * "where's my order?" style enquiries accurately.
     */
    private static async fetchCustomerOrders(accountId: string, conversation: any): Promise<OrderContext[]> {
        try {
            const customer = conversation.wooCustomer;
            const guestEmail = conversation.guestEmail;

            if (!customer?.wooId && !guestEmail) return [];

            // Build query — prefer wooCustomerId, fall back to billing email
            const where: any = { accountId };
            if (customer?.wooId) {
                where.wooCustomerId = customer.wooId;
            } else {
                where.billingEmail = guestEmail.toLowerCase().trim();
            }

            const orders = await prisma.wooOrder.findMany({
                where,
                orderBy: { dateCreated: 'desc' },
                take: 5, // Last 5 orders is sufficient context
                select: { number: true, status: true, total: true, currency: true, dateCreated: true, rawData: true }
            });

            return orders.map((o) => {
                const raw = o.rawData as Record<string, unknown>;
                const lineItems = Array.isArray(raw.line_items)
                    ? (raw.line_items as any[]).map((li) => ({ name: String(li.name || 'Unknown'), quantity: Number(li.quantity || 1) }))
                    : [];
                return {
                    orderNumber: o.number,
                    status: o.status,
                    total: String(o.total),
                    currency: o.currency,
                    dateCreated: o.dateCreated.toISOString(),
                    trackingItems: extractOrderTracking(raw),
                    lineItems
                };
            });
        } catch (error) {
            Logger.warn('Failed to fetch customer orders for AI context', { error });
            return [];
        }
    }

    /**
     * Builds structured conversation context from the conversation data.
     */
    private static buildConversationContext(conversation: any, recentOrders: OrderContext[] = []): ConversationContext {
        const messages = conversation.messages.map((msg: any) => ({
            role: msg.senderType === 'CUSTOMER' ? 'customer' as const :
                msg.senderType === 'AGENT' ? 'agent' as const : 'system' as const,
            content: this.stripHtmlTags(msg.content),
            timestamp: new Date(msg.createdAt).toLocaleString()
        }));

        // Determine customer info from WooCustomer or guest fields
        const customer = conversation.wooCustomer;
        const customerName = customer
            ? `${customer.firstName || ''} ${customer.lastName || ''}`.trim() || 'Customer'
            : conversation.guestName || 'Customer';
        const customerEmail = customer?.email || conversation.guestEmail || 'Unknown';

        return {
            messages,
            customerName,
            customerEmail,
            totalSpent: customer?.totalSpent ? `$${customer.totalSpent}` : undefined,
            ordersCount: customer?.ordersCount,
            recentOrders
        };
    }

    /**
     * Strips HTML tags from content for cleaner AI context.
     */
    private static stripHtmlTags(html: string): string {
        return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    }

    /**
     * Injects context variables into the prompt template.
     */
    private static injectVariables(
        template: string,
        context: ConversationContext,
        policies: { title: string; content: string; type: string }[]
    ): string {
        // Format conversation history
        const conversationHistory = context.messages.map(m =>
            `[${m.timestamp}] ${m.role.toUpperCase()}: ${m.content}`
        ).join('\n');

        // Format customer details
        const customerDetails = [
            `Name: ${context.customerName}`,
            `Email: ${context.customerEmail}`,
            context.totalSpent ? `Total Spent: ${context.totalSpent}` : null,
            context.ordersCount !== undefined ? `Orders: ${context.ordersCount}` : null
        ].filter(Boolean).join('\n');

        // Format order history with tracking info
        const orderHistory = context.recentOrders.length > 0
            ? context.recentOrders.map(o => {
                const items = o.lineItems.map(li => `  - ${li.name} x${li.quantity}`).join('\n');
                const tracking = o.trackingItems.length > 0
                    ? o.trackingItems.map(t =>
                        `  Tracking: ${t.provider} ${t.trackingNumber}${t.trackingUrl ? ` (${t.trackingUrl})` : ''}${t.dateShipped ? ` shipped ${t.dateShipped}` : ''}`
                    ).join('\n')
                    : '  No tracking information';
                return `Order #${o.orderNumber} — ${o.status.toUpperCase()} — ${o.currency} ${o.total} — ${new Date(o.dateCreated).toLocaleDateString()}\n${items}\n${tracking}`;
            }).join('\n\n')
            : 'No recent orders found for this customer.';

        // Format policies
        const policiesText = policies.length > 0
            ? policies.map(p => `### ${p.title}\n${this.stripHtmlTags(p.content)}`).join('\n\n')
            : 'No store policies configured.';

        // Replace template variables
        return template
            .replace(/\{\{conversation_history\}\}/g, conversationHistory)
            .replace(/\{\{customer_details\}\}/g, customerDetails)
            .replace(/\{\{order_history\}\}/g, orderHistory)
            .replace(/\{\{policies\}\}/g, policiesText);
    }

    /**
     * Returns the default prompt if none is configured in the database.
     */
    private static getDefaultPrompt(): string {
        return `You are a helpful customer service agent. Draft a professional reply to the customer based on the conversation history, customer context, and their recent orders.

CONVERSATION HISTORY:
{{conversation_history}}

CUSTOMER DETAILS:
{{customer_details}}

RECENT ORDERS & TRACKING:
{{order_history}}

STORE POLICIES:
{{policies}}

Guidelines:
- Be polite, empathetic, and professional
- Reference specific order details and tracking numbers when relevant to the customer's query
- If the customer is asking about their shipment, include the tracking number and tracking link from their order
- Follow store policies when applicable
- Keep response concise but complete
- Address all customer concerns raised

IMPORTANT: Return the reply as valid HTML. Use:
- <p> for paragraphs
- <strong> for emphasis
- <ul>/<li> for lists if needed

Do NOT include markdown, code blocks, or any wrapping. Only return the HTML content of the reply.`;
    }
}
