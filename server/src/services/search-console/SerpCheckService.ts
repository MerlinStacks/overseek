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
const CRED_CACHE_TTL_MS = 10 * 60 * 1000;

/** In-memory result cache to avoid duplicate queries within a refresh cycle */
const resultCache = new Map<string, { result: SerpPositionResult; expiry: number }>();
const RESULT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export class SerpCheckService {

    /**
     * Check the SERP position of a specific domain for a given keyword.
     * Searches up to 100 results (10 pages × 10 results).
     *
     * Why paginate to 100: Google Custom Search API returns max 10 results
     * per request and supports start=1..91. Most meaningful competitor
     * analysis happens within the first 100 results.
     */
    static async checkPosition(keyword: string, domain: string): Promise<SerpPositionResult> {
        const cacheKey = `${keyword.toLowerCase()}::${domain.toLowerCase()}`;
        const cached = resultCache.get(cacheKey);
        if (cached && cached.expiry > Date.now()) {
            return cached.result;
        }

        const creds = await this.getCredentials();
        if (!creds) {
            Logger.warn('SERP check skipped: no Google Custom Search credentials configured');
            return { position: null, rankingUrl: null };
        }

        const normalizedDomain = domain.toLowerCase().replace(/^www\./, '');

        // Search pages 1-10 (positions 1-100)
        // Why stop at 3 pages initially: balances API quota vs coverage.
        // Most competitive analysis cares about top 30 positions.
        const maxPages = 3;
        for (let page = 0; page < maxPages; page++) {
            const startIndex = page * 10 + 1;

            try {
                const result = await this.fetchSearchPage(
                    creds, keyword, normalizedDomain, startIndex
                );

                if (result) {
                    resultCache.set(cacheKey, {
                        result,
                        expiry: Date.now() + RESULT_CACHE_TTL_MS,
                    });
                    return result;
                }
            } catch (error: any) {
                // HTTP 429 = daily quota exceeded — stop immediately
                if (error?.status === 429 || error?.response?.status === 429) {
                    Logger.warn('Google Custom Search daily quota exceeded', { keyword, domain });
                    return { position: null, rankingUrl: null };
                }
                Logger.error('SERP check page fetch failed', { keyword, domain, startIndex, error: error.message });
            }
        }

        // Not found in searched pages
        const notFound: SerpPositionResult = { position: null, rankingUrl: null };
        resultCache.set(cacheKey, { result: notFound, expiry: Date.now() + RESULT_CACHE_TTL_MS });
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

        for (const keyword of keywords) {
            const result = await this.checkPosition(keyword, domain);
            results.set(keyword, result);

            // Throttle to stay within rate limits
            if (keywords.indexOf(keyword) < keywords.length - 1) {
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
        resultCache.clear();
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
                const res = await fetch(url.toString());
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

        const items: Array<{ link: string }> = response.items || [];

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
        if (cachedCredentials && credentialsCacheExpiry > Date.now()) {
            return cachedCredentials;
        }

        try {
            const record = await prisma.platformCredentials.findUnique({
                where: { platform: 'GOOGLE_CUSTOM_SEARCH' }
            });

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
