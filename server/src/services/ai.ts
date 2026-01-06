import { esClient } from '../utils/elastic';
import { prisma } from '../utils/prisma';
import { AIToolsService } from './ai_tools';
import { Logger } from '../utils/logger';

interface AIResponse {
    reply: string;
    sources?: any[];
}

export class AIService {

    static async getModels(apiKey?: string) {
        const headers: any = {};
        if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

        // Default models fallback if no key or key is invalid
        const defaultModels = [
            { id: 'openai/gpt-4o', name: 'GPT-4o' },
            { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet' },
            { id: 'mistralai/mistral-7b-instruct', name: 'Mistral 7B' }, // Fallback
        ];

        try {
            const res = await fetch('https://openrouter.ai/api/v1/models', { headers });
            if (!res.ok) {
                console.warn(`Failed to fetch models: ${res.statusText}, returning defaults.`);
                return defaultModels;
            }
            const data = await res.json();
            return data.data;
        } catch (e) {
            console.error("Model fetch error", e);
            return defaultModels;
        }
    }

    static async generateResponse(query: string, accountId: string): Promise<AIResponse> {
        let contextData: any[] = [];
        let systemPrompt = `You are OverSeek's AI Analyst. You have access to the store's data via tools. 
        ALWAYS use tools to fetch real data when asked about orders, sales, inventory, products, or customers. 
        If data is returned by a tool, analyze it and answer the user's question. 
        Do not make up facts. If a tool returns no results, state that clearly.
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
        const model = account?.aiModel || 'openai/gpt-4o'; // Default to a smart model for tools

        let messages: any[] = [
            { role: "system", content: systemPrompt },
            { role: "user", content: query }
        ];

        // 2. Main Loop: LLM -> Tool Call -> LLM
        // We limit to 5 turns to prevent infinite loops
        for (let i = 0; i < 5; i++) {
            try {
                const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
                    method: "POST",
                    headers: {
                        "Authorization": `Bearer ${apiKey}`,
                        "HTTP-Referer": "https://overseek.app",
                        "X-Title": "OverSeek",
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
                    const err = await response.text();
                    Logger.error('OpenRouter Error', { error: err });
                    return { reply: "I encountered an error connecting to the AI provider." };
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
                            contextData = [...contextData, ...toolResult];
                        } else if (typeof toolResult === 'object') {
                            contextData.push(toolResult);
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
                console.error("AI Loop Error:", error);
                return { reply: "I'm sorry, I encountered an internal error processing your request." };
            }
        }

        return { reply: "I'm thinking too much without an answer. Let's try a simpler question." };
    }
}
