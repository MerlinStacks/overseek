/**
 * AIService Unit Tests
 * 
 * Tests the AI response generation, tool execution loop, and error handling.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AIService } from '../ai';
import { prisma } from '../../utils/prisma';
import { AIToolsService } from '../ai_tools';

// Mock prisma
vi.mock('../../utils/prisma', () => ({
    prisma: {
        account: {
            findUnique: vi.fn(),
        },
        wooOrder: {
            findFirst: vi.fn(),
        },
        wooProduct: {
            findFirst: vi.fn(),
        },
        wooCustomer: {
            findFirst: vi.fn(),
        },
    }
}));

// Mock logger
vi.mock('../../utils/logger', () => ({
    Logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    }
}));

// Mock Elasticsearch (not used directly in ai.ts but might be imported)
vi.mock('../../utils/elastic', () => ({
    esClient: {}
}));

// Mock AIToolsService
vi.mock('../ai_tools', () => ({
    AIToolsService: {
        getDefinitions: vi.fn(() => []),
        executeTool: vi.fn(),
    }
}));

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('AIService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('getModels', () => {
        it('should return models from OpenRouter API on success', async () => {
            const mockModels = {
                data: [
                    { id: 'openai/gpt-4o', name: 'GPT-4o' },
                    { id: 'anthropic/claude-3', name: 'Claude 3' },
                ]
            };

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve(mockModels)
            });

            const result = await AIService.getModels('test-api-key');

            expect(result).toEqual(mockModels.data);
            expect(mockFetch).toHaveBeenCalledWith(
                'https://openrouter.ai/api/v1/models',
                { headers: { Authorization: 'Bearer test-api-key' } }
            );
        });

        it('should return default models when API fails', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: false,
                statusText: 'Unauthorized'
            });

            const result = await AIService.getModels('invalid-key');

            expect(result).toHaveLength(3);
            expect(result[0].id).toBe('openai/gpt-4o');
        });

        it('should return default models on network error', async () => {
            mockFetch.mockRejectedValueOnce(new Error('Network error'));

            const result = await AIService.getModels('test-key');

            expect(result).toHaveLength(3);
            expect(result[0].id).toBe('openai/gpt-4o');
        });
    });

    describe('generateResponse', () => {
        it('should return demo mode message when no API key configured', async () => {
            (prisma.account.findUnique as any).mockResolvedValue({
                openRouterApiKey: null,
                aiModel: null
            });

            // Ensure no env key
            const originalKey = process.env.OPENAI_API_KEY;
            delete process.env.OPENAI_API_KEY;

            const result = await AIService.generateResponse('Hello', 'acc_123');

            expect(result.reply).toContain('demonstration mode');
            expect(result.sources).toEqual([]);

            // Restore
            if (originalKey) process.env.OPENAI_API_KEY = originalKey;
        });

        it('should handle a simple response without tool calls', async () => {
            (prisma.account.findUnique as any).mockResolvedValue({
                openRouterApiKey: 'test-key',
                aiModel: 'openai/gpt-4o'
            });

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({
                    choices: [{
                        message: {
                            content: 'Hello! How can I help you today?',
                            tool_calls: null
                        }
                    }]
                })
            });

            const result = await AIService.generateResponse('Hi', 'acc_123');

            expect(result.reply).toBe('Hello! How can I help you today?');
        });

        it('should execute tools when requested and return final response', async () => {
            (prisma.account.findUnique as any).mockResolvedValue({
                openRouterApiKey: 'test-key',
                aiModel: 'openai/gpt-4o'
            });

            // First call: AI requests a tool
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({
                    choices: [{
                        message: {
                            content: null,
                            tool_calls: [{
                                id: 'call_1',
                                function: {
                                    name: 'get_store_overview',
                                    arguments: '{}'
                                }
                            }]
                        }
                    }]
                })
            });

            // Second call: AI provides final answer
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({
                    choices: [{
                        message: {
                            content: 'Your store has 100 products and 50 customers.',
                            tool_calls: null
                        }
                    }]
                })
            });

            // Mock tool execution
            (AIToolsService.executeTool as any).mockResolvedValueOnce({
                totalProducts: 100,
                totalCustomers: 50
            });

            const result = await AIService.generateResponse('How is my store doing?', 'acc_123');

            expect(result.reply).toBe('Your store has 100 products and 50 customers.');
            expect(result.sources).toHaveLength(1);
            expect(AIToolsService.executeTool).toHaveBeenCalledWith('get_store_overview', {}, 'acc_123');
        });

        it('should limit tool iterations to prevent infinite loops', async () => {
            (prisma.account.findUnique as any).mockResolvedValue({
                openRouterApiKey: 'test-key',
                aiModel: 'openai/gpt-4o'
            });

            // Always return tool calls (infinite loop scenario)
            mockFetch.mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({
                    choices: [{
                        message: {
                            content: null,
                            tool_calls: [{
                                id: 'call_1',
                                function: {
                                    name: 'get_store_overview',
                                    arguments: '{}'
                                }
                            }]
                        }
                    }]
                })
            });

            (AIToolsService.executeTool as any).mockResolvedValue({ data: 'test' });

            const result = await AIService.generateResponse('Loop me', 'acc_123');

            // Should bail out after 5 iterations
            expect(result.reply).toContain("gathered a lot of information");
            expect(mockFetch).toHaveBeenCalledTimes(5);
        });

        it('should handle API errors gracefully', async () => {
            (prisma.account.findUnique as any).mockResolvedValue({
                openRouterApiKey: 'test-key',
                aiModel: 'openai/gpt-4o'
            });

            mockFetch.mockResolvedValueOnce({
                ok: false,
                text: () => Promise.resolve('Rate limit exceeded')
            });

            const result = await AIService.generateResponse('Hello', 'acc_123');

            expect(result.reply).toContain('error connecting');
        });

        it('should inject order context when viewing an order page', async () => {
            (prisma.account.findUnique as any).mockResolvedValue({
                openRouterApiKey: 'test-key',
                aiModel: 'openai/gpt-4o'
            });

            (prisma.wooOrder.findFirst as any).mockResolvedValue({
                number: '1234',
                status: 'completed',
                total: '150.00',
                currency: 'AUD',
                rawData: {
                    billing: { first_name: 'John', last_name: 'Doe' }
                }
            });

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({
                    choices: [{
                        message: {
                            content: 'This order is completed.',
                            tool_calls: null
                        }
                    }]
                })
            });

            const result = await AIService.generateResponse(
                'Is this profitable?',
                'acc_123',
                { path: '/orders/1234' }
            );

            expect(result.reply).toBe('This order is completed.');
            expect(prisma.wooOrder.findFirst).toHaveBeenCalled();
        });
    });
});
