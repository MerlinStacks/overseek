/**
 * Meta Token Service
 * Unified service for Meta token lifecycle management.
 * Handles token exchange, validation, and refresh for both Ads and Messaging.
 * 
 * Why: Centralizes Meta token operations to fix the 24-hour expiration bug
 * caused by silent fallback to short-lived tokens when exchange fails.
 */

import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';

/** Current Meta Graph API version (updated 2026-02) */
const API_VERSION = 'v24.0';
const GRAPH_API_BASE = `https://graph.facebook.com/${API_VERSION}`;

/** Token exchange result with explicit expiration info */
export interface TokenExchangeResult {
    accessToken: string;
    expiresIn: number;
    tokenType: 'short_lived' | 'long_lived';
    expiresAt: Date;
}

/** Token debug info from /debug_token endpoint */
export interface TokenDebugInfo {
    isValid: boolean;
    appId: string | null;
    userId: string | null;
    expiresAt: Date | null;
    scopes: string[];
    issuedAt: Date | null;
    error?: string;
}

/** Page info with access token */
export interface PageInfo {
    id: string;
    name: string;
    accessToken: string;
    category?: string;
}

/** Ad account info */
export interface AdAccountInfo {
    id: string;
    accountId: string;
    name: string;
    currency: string;
    status: number;
}

/**
 * Unified Meta Token Service.
 * Handles all Meta token operations with proper error handling.
 */
export class MetaTokenService {
    /**
     * Get Meta credentials (appId, appSecret) from database.
     * Supports unified 'META' platform with fallback to 'META_MESSAGING' or 'META_ADS'.
     */
    static async getCredentials(preferredPlatform?: 'META_MESSAGING' | 'META_ADS'): Promise<{
        appId: string;
        appSecret: string;
    }> {
        // Try unified META first
        const platforms = ['META', preferredPlatform, 'META_MESSAGING', 'META_ADS'].filter(Boolean) as string[];

        for (const platform of platforms) {
            try {
                const record = await prisma.platformCredentials.findUnique({
                    where: { platform }
                });

                if (record?.credentials) {
                    const creds = record.credentials as Record<string, string>;
                    if (creds.appId && creds.appSecret) {
                        Logger.debug(`[MetaToken] Using credentials from ${platform}`);
                        return { appId: creds.appId, appSecret: creds.appSecret };
                    }
                }
            } catch (error) {
                Logger.warn(`[MetaToken] Failed to fetch ${platform} credentials`, { error });
            }
        }

        // Fallback to environment variables
        const envAppId = process.env.META_APP_ID;
        const envAppSecret = process.env.META_APP_SECRET;

        if (envAppId && envAppSecret) {
            Logger.debug('[MetaToken] Using credentials from environment variables');
            return { appId: envAppId, appSecret: envAppSecret };
        }

        throw new Error('Meta credentials not configured. Please configure via Super Admin or environment variables.');
    }

    /**
     * Exchange a short-lived token for a long-lived token (~60 days).
     * 
     * CRITICAL: This method throws on failure instead of silently falling back.
     * The silent fallback was the root cause of the 24-hour expiration bug.
     * 
     * @throws Error if exchange fails - caller must handle the error
     */
    static async exchangeForLongLived(
        shortLivedToken: string,
        preferredPlatform?: 'META_MESSAGING' | 'META_ADS'
    ): Promise<TokenExchangeResult> {
        const { appId, appSecret } = await this.getCredentials(preferredPlatform);

        const url = `${GRAPH_API_BASE}/oauth/access_token?` + new URLSearchParams({
            grant_type: 'fb_exchange_token',
            client_id: appId,
            client_secret: appSecret,
            fb_exchange_token: shortLivedToken
        });

        Logger.info('[MetaToken] Exchanging for long-lived token');

        try {
            const response = await fetch(url);
            const data = await response.json() as any;

            if (data.error) {
                // Log full error details for debugging
                Logger.error('[MetaToken] Long-lived token exchange FAILED', {
                    errorCode: data.error.code,
                    errorType: data.error.type,
                    errorMessage: data.error.message,
                    errorSubcode: data.error.error_subcode,
                    fbTraceId: data.error.fbtrace_id
                });

                throw new Error(
                    `Meta token exchange failed: ${data.error.message || 'Unknown error'}` +
                    (data.error.code ? ` (code: ${data.error.code})` : '')
                );
            }

            if (!data.access_token) {
                throw new Error('Meta token exchange returned no access_token');
            }

            // Token exchange succeeded
            const expiresIn = data.expires_in || 5184000; // Default to 60 days
            const expiresAt = new Date(Date.now() + (expiresIn * 1000));

            Logger.info('[MetaToken] Long-lived token acquired', {
                expiresIn,
                expiresAt: expiresAt.toISOString(),
                tokenPrefix: data.access_token.substring(0, 10) + '...'
            });

            return {
                accessToken: data.access_token,
                expiresIn,
                tokenType: 'long_lived',
                expiresAt
            };
        } catch (error: any) {
            if (error.message?.includes('Meta token exchange')) {
                throw error; // Re-throw our formatted errors
            }
            Logger.error('[MetaToken] Network error during token exchange', { error });
            throw new Error(`Meta token exchange network error: ${error.message}`);
        }
    }

    /**
     * Debug a token using the /debug_token endpoint.
     * Returns detailed info including expiration, scopes, and validity.
     */
    static async debugToken(accessToken: string): Promise<TokenDebugInfo> {
        try {
            const { appId, appSecret } = await this.getCredentials();
            const appToken = `${appId}|${appSecret}`;

            const url = `${GRAPH_API_BASE}/debug_token?` + new URLSearchParams({
                input_token: accessToken,
                access_token: appToken
            });

            const response = await fetch(url);
            const data = await response.json() as any;

            if (data.error) {
                return {
                    isValid: false,
                    appId: null,
                    userId: null,
                    expiresAt: null,
                    scopes: [],
                    issuedAt: null,
                    error: data.error.message
                };
            }

            const debugData = data.data;

            return {
                isValid: debugData.is_valid || false,
                appId: debugData.app_id || null,
                userId: debugData.user_id || null,
                expiresAt: debugData.expires_at ? new Date(debugData.expires_at * 1000) : null,
                scopes: debugData.scopes || [],
                issuedAt: debugData.issued_at ? new Date(debugData.issued_at * 1000) : null
            };
        } catch (error: any) {
            Logger.error('[MetaToken] Failed to debug token', { error });
            return {
                isValid: false,
                appId: null,
                userId: null,
                expiresAt: null,
                scopes: [],
                issuedAt: null,
                error: error.message
            };
        }
    }

    /**
     * Validate if a token is still working by making a lightweight /me call.
     */
    static async validateToken(accessToken: string): Promise<{
        valid: boolean;
        userId?: string;
        name?: string;
        error?: string;
    }> {
        try {
            const url = `${GRAPH_API_BASE}/me?` + new URLSearchParams({
                access_token: accessToken,
                fields: 'id,name'
            });

            const response = await fetch(url);
            const data = await response.json() as any;

            if (data.error) {
                return {
                    valid: false,
                    error: data.error.message
                };
            }

            return {
                valid: true,
                userId: data.id,
                name: data.name
            };
        } catch (error: any) {
            return {
                valid: false,
                error: error.message
            };
        }
    }

    /**
     * Get Page Access Tokens for all pages the user has access to.
     * Page tokens derived from long-lived user tokens should never expire.
     */
    static async getPageTokens(userAccessToken: string): Promise<PageInfo[]> {
        try {
            const url = `${GRAPH_API_BASE}/me/accounts?` + new URLSearchParams({
                access_token: userAccessToken,
                fields: 'id,name,access_token,category'
            });

            const response = await fetch(url);
            const data = await response.json() as any;

            if (data.error) {
                Logger.error('[MetaToken] Failed to fetch page tokens', { error: data.error });
                throw new Error(data.error.message);
            }

            const pages: PageInfo[] = (data.data || []).map((page: any) => ({
                id: page.id,
                name: page.name,
                accessToken: page.access_token,
                category: page.category
            }));

            Logger.info('[MetaToken] Retrieved page tokens', { count: pages.length });
            return pages;
        } catch (error: any) {
            Logger.error('[MetaToken] Error fetching page tokens', { error });
            throw error;
        }
    }

    /**
     * Get Ad Accounts accessible by this token.
     */
    static async getAdAccounts(userAccessToken: string): Promise<AdAccountInfo[]> {
        try {
            const url = `${GRAPH_API_BASE}/me/adaccounts?` + new URLSearchParams({
                access_token: userAccessToken,
                fields: 'id,account_id,name,currency,account_status'
            });

            const response = await fetch(url);
            const data = await response.json() as any;

            if (data.error) {
                Logger.error('[MetaToken] Failed to fetch ad accounts', { error: data.error });
                throw new Error(data.error.message);
            }

            const accounts: AdAccountInfo[] = (data.data || []).map((acc: any) => ({
                id: acc.id,
                accountId: acc.account_id,
                name: acc.name,
                currency: acc.currency,
                status: acc.account_status
            }));

            Logger.info('[MetaToken] Retrieved ad accounts', { count: accounts.length });
            return accounts;
        } catch (error: any) {
            Logger.error('[MetaToken] Error fetching ad accounts', { error });
            throw error;
        }
    }

    /**
     * Get the current API version used by this service.
     */
    static getApiVersion(): string {
        return API_VERSION;
    }
}

export default MetaTokenService;
