import { esClient } from '../utils/elastic';
import { prisma } from '../utils/prisma';
import { AIToolsService } from './ai_tools';
import { Logger } from '../utils/logger';
import { AI_LIMITS } from '../config/limits';
import { AIServiceError, AIRateLimitError, ExternalAPIError, isOverseekError } from '../utils/errors';

// ============================================================================
// Type Definitions
// ============================================================================

/** Result from AI tool execution */
interface ToolResult {
    [key: string]: unknown;
}

/** OpenAI-compatible chat message */
interface ChatMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string | null;
    tool_calls?: ToolCall[];
    tool_call_id?: string;
    alias?: string;
}

/** Tool call structure from LLM */
interface ToolCall {
    id: string;
    function: {
        name: string;
        arguments: string;
    };
}

/** OpenRouter API response */
interface OpenRouterResponse {
    choices: Array<{
        message: ChatMessage;
    }>;
}

/** Order billing information from rawData */
interface OrderBilling {
    first_name?: string;
    last_name?: string;
}

/** Order rawData structure */
interface OrderRawData {
    billing?: OrderBilling;
}

/** AI response returned to client */
interface AIResponse {
    reply: string;
    sources?: ToolResult[];
}

export class AIService {

    static async getModels(apiKey?: string) {
        const headers: Record<string, string> = {};
        if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

        // Default models fallback if no key or key is invalid
        const defaultModels = [
            { id: 'openai/gpt-4o', name: 'GPT-4o' },
            { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet' },
            { id: 'mistralai/mistral-7b-instruct', name: 'Mistral 7B' }, // Fallback
        ];

        try {
            const res = await fetch(AI_LIMITS.MODELS_ENDPOINT, { headers });
            if (!res.ok) {
                Logger.warn(`Failed to fetch models: ${res.statusText}, returning defaults.`);
                return defaultModels;
            }
            const data = await res.json();
            return data.data;
        } catch (e) {
            Logger.error('Model fetch error', { error: e });
            return defaultModels;
        }
    }

    static async generateResponse(query: string, accountId: string, context?: { path?: string }): Promise<AIResponse> {
        let contextData: ToolResult[] = [];
        let contextSummary = "";

        // 0. Pre-fetch Context Data based on Path
        if (context?.path) {
            try {
                // Order Details: /orders/123 or /orders/123/edit
                const orderMatch = context.path.match(/\/orders\/(\d+)/) || context.path.match(/\/orders\/(\w+)/); // Support number or string id
                if (orderMatch && orderMatch[1]) {
                    // Check if it's "new" which isn't an ID
                    if (orderMatch[1] !== 'new') {
                        const orderId = orderMatch[1];
                        // We use the tool directly to get summary
                        // Note: In real app, might want a specific service call, but re-using tool logic is efficient here
                        // We can't easily call OrderTools.getRecentOrders for a specific ID, let's just query Prisma briefly
                        // Safe query for ID vs Number
                        const isNumericId = /^\d+$/.test(orderId);
                        const order = await prisma.wooOrder.findFirst({
                            where: isNumericId
                                ? { accountId, wooId: Number(orderId) }
                                : { accountId, number: String(orderId) },
                            select: { number: true, status: true, total: true, currency: true, rawData: true }
                        });
                        if (order) {
                            const raw = order.rawData as OrderRawData;
                            const billing = raw?.billing ?? {};
                            contextSummary += `\n\n**CURRENTLY VIEWING:** Order #${order.number} (Status: ${order.status}, Total: ${order.currency} ${order.total}, Customer: ${billing?.first_name} ${billing?.last_name}). Answer questions relative to this order if implied (e.g., "Is THIS profitable?").`;
                        }
                    }
                }

                // Product Details: /inventory/product/123
                const productMatch = context.path.match(/\/inventory\/product\/(\d+)/);
                if (productMatch && productMatch[1]) {
                    const pid = Number(productMatch[1]);
                    const product = await prisma.wooProduct.findFirst({
                        where: { accountId, wooId: pid },
                        select: { name: true, stockStatus: true, price: true, sku: true }
                    });
                    if (product) {
                        contextSummary += `\n\n**CURRENTLY VIEWING:** Product "${product.name}" (SKU: ${product.sku}, Stock: ${product.stockStatus}, Price: ${product.price}). Answer questions relative to this product.`;
                    }
                }

                // Customer Details: /customers/123
                const customerMatch = context.path.match(/\/customers\/(\d+)/);
                if (customerMatch && customerMatch[1]) {
                    const cid = Number(customerMatch[1]);
                    const customer = await prisma.wooCustomer.findFirst({
                        where: { accountId, wooId: cid },
                        select: { firstName: true, email: true, totalSpent: true, ordersCount: true }
                    });
                    if (customer) {
                        contextSummary += `\n\n**CURRENTLY VIEWING:** Customer ${customer.firstName} (${customer.email}) - Lifetime Spend: ${customer.totalSpent}, Orders: ${customer.ordersCount}.`;
                    }
                }

            } catch (err) {
                Logger.warn("Failed to inject context", { error: err });
            }
        }

        const systemPrompt = `You are ${process.env.APP_NAME || 'Commerce Platform'}'s AI Analyst, an intelligent assistant for WooCommerce.

**NEW COMPETENCIES:**
- **Forecasting:** You can predict next week's sales.
- **Profitability:** You can calculate real margins using COGS (Cost of Goods Sold).
- **Live Traffic:** You can see who is actively browsing the store.
- **Search Insights:** You can see what users are searching for.
- **Customer Segmentation:** You can identify "Whales" (top spenders) and "At Risk" customers.

${contextSummary}

You have access to tools that let you query real store data. ALWAYS use tools to fetch data when answering questions about:

**Orders & Sales:**
- Recent orders and order details
- Sales analytics by period
- Revenue breakdown with trend comparison

**Products & Inventory:**
- Product search
- Inventory status and low stock alerts
- Best selling products

**Customers & Reviews:**
- Customer lookup
- Top customers by spending
- Review summaries and ratings

**Store Overview:**
- General store statistics (products, customers, orders, revenue)

**Advertising (if connected):**
- Ad performance (spend, impressions, clicks, ROAS) from Meta and Google Ads
- Platform comparison between Meta and Google Ads

**Guidelines:**
1. ALWAYS use tools to fetch real data - never make up numbers or facts
2. If a tool returns no results, state that clearly
3. Format numbers nicely (e.g., currency, percentages)
4. Provide actionable insights when possible
5. If ad accounts aren't connected, guide users to Settings > Integrations

Current Date: ${new Date().toISOString().split('T')[0]}`;


        // Fetch Account Settings
        const account = await prisma.account.findUnique({
            where: { id: accountId },
            select: { openRouterApiKey: true, aiModel: true }
        });

        // 1. Fallback / Mock Mode if no API Key
        if (!account?.openRouterApiKey && !process.env.OPENAI_API_KEY) {
            return {
                reply: "AI is currently running in demonstration mode (No API Key configured). Please configure your OpenRouter API key in Settings > AI to enable real data analysis.",
                sources: []
            };
        }

        const apiKey = account?.openRouterApiKey || process.env.OPENAI_API_KEY;
        const model = account?.aiModel || AI_LIMITS.DEFAULT_MODEL;

        const messages: ChatMessage[] = [
            { role: "system", content: systemPrompt },
            { role: "user", content: query }
        ];

        // 2. Main Loop: LLM -> Tool Call -> LLM
        for (let i = 0; i < AI_LIMITS.MAX_TOOL_ITERATIONS; i++) {
            try {
                const response = await fetch(AI_LIMITS.API_ENDPOINT, {
                    method: "POST",
                    headers: {
                        "Authorization": `Bearer ${apiKey}`,
                        "HTTP-Referer": process.env.APP_URL || 'http://localhost:5173',
                        "X-Title": process.env.APP_NAME || 'Commerce Platform',
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        model: model,
                        messages: messages,
                        tools: AIToolsService.getDefinitions().map(tool => ({
                            type: 'function',
                            function: tool
                        }))
                    })
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    const isRateLimit = response.status === 429;
                    Logger.error('OpenRouter Error', {
                        status: response.status,
                        error: errorText,
                        accountId
                    });

                    if (isRateLimit) {
                        return {
                            reply: "I'm currently experiencing high demand. Please wait a moment and try again.",
                            sources: []
                        };
                    }
                    return {
                        reply: "I encountered an error connecting to the AI provider. Please check your API key in Settings > AI.",
                        sources: []
                    };
                }

                const data = await response.json();
                const choice = data.choices[0];
                const msg = choice.message;

                messages.push(msg); // Add assistant's response to history

                // Check for Tool Calls
                if (msg.tool_calls && msg.tool_calls.length > 0) {
                    Logger.debug('AI requested tool execution', { count: msg.tool_calls.length });

                    for (const toolCall of msg.tool_calls) {
                        const fnName = toolCall.function.name;
                        const fnArgs = JSON.parse(toolCall.function.arguments);

                        // Execute Tool
                        const toolResult = await AIToolsService.executeTool(fnName, fnArgs, accountId);

                        // Capture data for "sources"
                        if (Array.isArray(toolResult)) {
                            contextData = [...contextData, ...(toolResult as ToolResult[])];
                        } else if (typeof toolResult === 'object' && toolResult !== null) {
                            contextData.push(toolResult as ToolResult);
                        }

                        // Add Tool output to history
                        messages.push({
                            role: "tool",
                            tool_call_id: toolCall.id,
                            alias: fnName,
                            content: JSON.stringify(toolResult)
                        });
                    }
                    // Loop continues to get the final answer
                } else {
                    // No tool calls, this is the final answer
                    return {
                        reply: msg.content,
                        sources: contextData
                    };
                }

            } catch (error) {
                const err = error as Error;
                Logger.error('AI Loop Error', {
                    error: err.message,
                    stack: err.stack,
                    iteration: i,
                    accountId
                });
                return {
                    reply: "I'm sorry, I encountered an error while processing your request. Please try again or rephrase your question.",
                    sources: contextData
                };
            }
        }

        // Max iterations reached - prevent infinite loops
        Logger.warn('AI max iterations reached', { accountId, maxIterations: AI_LIMITS.MAX_TOOL_ITERATIONS });
        return {
            reply: "I've gathered a lot of information but need to stop here. Could you ask a more specific question?",
            sources: contextData
        };
    }
}
