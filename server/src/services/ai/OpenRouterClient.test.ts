import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenRouterClient } from './OpenRouterClient';

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

describe('Structured AI transport', () => {
    afterEach(() => vi.unstubAllGlobals());
    it('honours the configured model and validates JSON parsing', async () => {
        const fetchMock = vi.fn(async () => json({ choices: [{ message: { content: '```json\n{"summary":"Hello"}\n```' } }] }));
        vi.stubGlobal('fetch', fetchMock);
        expect(await OpenRouterClient.completeJson('secret', 'configured/model', [{ role: 'user', content: 'Review' }])).toEqual({ summary: 'Hello' });
        expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string).model).toBe('configured/model');
    });
    it('returns typed rate limit errors without leaking provider bodies', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => json({ error: 'Secret provider diagnostics' }, 429)));
        await expect(OpenRouterClient.completeJson('secret', 'model', [])).rejects.toMatchObject({ statusCode: 429 });
    });
    it('does not treat malformed provider output as a review', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => json({ choices: [{ message: { content: 'not JSON' } }] })));
        await expect(OpenRouterClient.completeJson('secret', 'model', [])).rejects.toThrow('invalid review');
    });
    it('discovers vision support instead of assuming every configured model sees images', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => json({ data: [
            { id: 'vision/test-model', architecture: { input_modalities: ['text', 'image'] } },
            { id: 'text/test-model', architecture: { input_modalities: ['text'] } }
        ] })));
        expect(await OpenRouterClient.supportsImages('vision/test-model')).toBe(true);
        expect(await OpenRouterClient.supportsImages('text/test-model')).toBe(false);
        expect(await OpenRouterClient.supportsImages('unknown/model')).toBe(false);
    });
});
