import { describe, expect, it } from 'vitest';
import { CRAWLER_REGISTRY } from './CrawlerRegistry';
describe('crawler identity boundaries', () => {
    it('does not group user-triggered ChatGPT fetches with GPTBot training', () => {
        expect(CRAWLER_REGISTRY.find(item => item.slug === 'gptbot')?.patterns).toEqual(['gptbot']);
        expect(CRAWLER_REGISTRY.find(item => item.slug === 'chatgpt-user')?.patterns).toEqual(['chatgpt-user']);
    });
    it('keeps registry slugs unique and patterns lowercase', () => {
        expect(new Set(CRAWLER_REGISTRY.map(item => item.slug)).size).toBe(CRAWLER_REGISTRY.length);
        expect(CRAWLER_REGISTRY.every(item => item.patterns.every(pattern => pattern.length > 0 && pattern === pattern.toLowerCase()))).toBe(true);
    });
});
