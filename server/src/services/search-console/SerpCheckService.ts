/**
 * SERP Check Service
 *
 * Checks Google search result positions for competitor domains on
 * specific keywords using the Google Custom Search JSON API.
 *
 * Why Custom Search API over scraping: scraping Google violates TOS
 * and risks IP bans. Custom Search provides a legitimate, stable
 * interface with 100 free queries/day and $5/1K after that.
 *
 * Credentials are stored in PlatformCredentials under the key
 * 'GOOGLE_CUSTOM_SEARCH' with shape { apiKey, searchEngineId }.
 */

import { Logger } from '../../utils/logger';
import { retryWithBackoff } from '../../utils/retryWithBackoff';
import { prisma } from '../../utils/prisma';

/** Result from a single SERP position check */
export interface SerpPositionResult {
    /** 1-based position in SERP, null if not found in top results */
    position: number | null;
    /** The URL that ranked for this keyword */
    rankingUrl: string | null;
}

/** Cached credentials to avoid repeated DB lookups */
let cachedCredentials: { apiKey: string; searchEngineId: string } | null = null;
let credentialsCacheExpiry = 0;
let credentialVersion = 0;
const CRED_CACHE_TTL_MS = 10 * 60 * 1000;

/** In-memory result cache to avoid duplicate queries within a refresh cycle */
const resultCache = new Map<string, { result: SerpPositionResult; expiry: number }>();
const RESULT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 5000;

function cacheResult(key: string, result: SerpPositionResult): void {
    const now = Date.now();
    for (const [entryKey, entry] of resultCache) if (entry.expiry <= now) resultCache.delete(entryKey);
    if (resultCache.size >= MAX_CACHE_ENTRIES) resultCache.delete(resultCache.keys().next().value!);
    resultCache.set(key, { result, expiry: now + RESULT_CACHE_TTL_MS });
}

export class SerpCheckService {

    /**
     * Check the SERP position of a specific domain for a given keyword.
     * Searches the top 30 results (3 pages × 10 results) to limit quota usage.
     * A null position means not found within that coverage, never a failed check.
     */
    static async checkPosition(keyword: string, domain: string): Promise<SerpPositionResult> {
        keyword = keyword.trim();
        if (!keyword) throw new Error('Keyword required');
        const domainUrl = new URL(domain.includes('://') ? domain : `https://${domain}`);
        if (!['https:', 'http:'].includes(domainUrl.protocol) || domainUrl.username || domainUrl.password || domainUrl.pathname !== '/' || domainUrl.search || domainUrl.hash) throw new Error('Invalid competitor domain');
        const normalizedDomain = domainUrl.hostname.toLowerCase().replace(/^www\./, '');
        const cacheKey = JSON.stringify([keyword.toLowerCase(), normalizedDomain]);
        const cached = resultCache.get(cacheKey);
        if (cached && cached.expiry > Date.now()) {
            return cached.result;
        }

        const creds = await this.getCredentials();
        if (!creds) {
            throw new Error('Google Custom Search credentials are not configured');
        }

        // Why stop at 3 pages initially: balances API quota vs coverage.
        // Most competitive analysis cares about top 30 positions.
        const maxPages = 3;
        for (let page = 0; page < maxPages; page++) {
            const startIndex = page * 10 + 1;

            const result = await this.fetchSearchPage(creds, keyword, normalizedDomain, startIndex);
            if (result) {
                cacheResult(cacheKey, result);
                return result;
            }
        }

        // Not found in searched pages
        const notFound: SerpPositionResult = { position: null, rankingUrl: null };
        cacheResult(cacheKey, notFound);
        return notFound;
    }

    /**
     * Bulk check positions for multiple keywords against a single domain.
     * Adds a small delay between requests to respect rate limits.
     */
    static async checkPositionsBulk(
        keywords: string[],
        domain: string
    ): Promise<Map<string, SerpPositionResult>> {
        const results = new Map<string, SerpPositionResult>();
        const DELAY_BETWEEN_CHECKS_MS = 200;

        const uniqueKeywords = [...new Set(keywords)];
        for (const [index, keyword] of uniqueKeywords.entries()) {
            const result = await this.checkPosition(keyword, domain);
            results.set(keyword, result);

            // Throttle to stay within rate limits
            if (index < uniqueKeywords.length - 1) {
                await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_CHECKS_MS));
            }
        }

        return results;
    }

    /**
     * Check if credentials are configured and valid.
     */
    static async isConfigured(): Promise<boolean> {
        const creds = await this.getCredentials();
        return creds !== null;
    }

    /**
     * Clear the in-memory result cache — useful for manual refresh.
     */
    static clearCache(): void {
        credentialVersion++;
        resultCache.clear();
        cachedCredentials = null;
        credentialsCacheExpiry = 0;
    }

    /**
     * Fetch a single page of search results and check for domain match.
     */
    private static async fetchSearchPage(
        creds: { apiKey: string; searchEngineId: string },
        keyword: string,
        normalizedDomain: string,
        startIndex: number
    ): Promise<SerpPositionResult | null> {
        const url = new URL('https://www.googleapis.com/customsearch/v1');
        url.searchParams.set('key', creds.apiKey);
        url.searchParams.set('cx', creds.searchEngineId);
        url.searchParams.set('q', keyword);
        url.searchParams.set('start', String(startIndex));
        url.searchParams.set('num', '10');

        const response = await retryWithBackoff(
            async () => {
                const res = await fetch(url.toString(), { signal: AbortSignal.timeout(15000) });
                if (!res.ok) {
                    const error: any = new Error(`Custom Search API error: ${res.status}`);
                    error.status = res.status;
                    error.response = { status: res.status };
                    throw error;
                }
                return res.json();
            },
            { maxRetries: 2, baseDelayMs: 500, context: 'SerpCheck:fetchPage' }
        );

        if (!response || typeof response !== 'object' || response.error || (response.items !== undefined && !Array.isArray(response.items))) throw new Error('Invalid Custom Search response');
        const items: Array<{ link: string }> = response.items ?? [];
        if (!items.every(item => item && typeof item.link === 'string')) throw new Error('Invalid Custom Search results');

        for (let i = 0; i < items.length; i++) {
            try {
                const resultUrl = new URL(items[i].link);
                const resultDomain = resultUrl.hostname.replace(/^www\./, '').toLowerCase();

                if (resultDomain === normalizedDomain || resultDomain.endsWith(`.${normalizedDomain}`)) {
                    return {
                        position: startIndex + i,
                        rankingUrl: items[i].link,
                    };
                }
            } catch {
                // Invalid URL in results — skip
            }
        }

        return null;
    }

    /**
     * Retrieves Google Custom Search credentials from PlatformCredentials.
     * Caches for 10 minutes to avoid repeated DB lookups.
     */
    private static async getCredentials(): Promise<{ apiKey: string; searchEngineId: string } | null> {
        const version = credentialVersion;
        if (cachedCredentials && credentialsCacheExpiry > Date.now()) {
            return cachedCredentials;
        }

        try {
            const record = await prisma.platformCredentials.findUnique({
                where: { platform: 'GOOGLE_CUSTOM_SEARCH' }
            });
            if (version !== credentialVersion) return this.getCredentials();

            if (!record?.credentials) {
                // Fallback to environment variables
                const apiKey = process.env.GOOGLE_CUSTOM_SEARCH_API_KEY;
                const searchEngineId = process.env.GOOGLE_CUSTOM_SEARCH_ENGINE_ID;
                if (apiKey && searchEngineId) {
                    cachedCredentials = { apiKey, searchEngineId };
                    credentialsCacheExpiry = Date.now() + CRED_CACHE_TTL_MS;
                    return cachedCredentials;
                }
                return null;
            }

            const creds = record.credentials as Record<string, string>;
            if (!creds.apiKey || !creds.searchEngineId) {
                Logger.warn('GOOGLE_CUSTOM_SEARCH credentials missing apiKey or searchEngineId');
                return null;
            }

            cachedCredentials = { apiKey: creds.apiKey, searchEngineId: creds.searchEngineId };
            credentialsCacheExpiry = Date.now() + CRED_CACHE_TTL_MS;
            return cachedCredentials;
        } catch (error) {
            Logger.error('Failed to fetch GOOGLE_CUSTOM_SEARCH credentials', { error });
            return null;
        }
    }
}
