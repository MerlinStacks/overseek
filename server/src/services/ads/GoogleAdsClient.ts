/**
 * Google Ads Client Factory
 * 
 * Shared helper for creating Google Ads API clients.
 * 
 * Why caching matters: GoogleAdsApi spawns gRPC / HTTP/2 channels internally.
 * Creating a new instance per call leaks connections and buffers, leading to
 * heap exhaustion under load (the OOM crash that prompted this rewrite).
 */

import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';
import { getCredentials } from './types';
import { EventBus, EVENTS } from '../events';

// ─── Singleton GoogleAdsApi instance ────────────────────────────────────────
// All accounts share the same developer token / client ID / secret, so there
// is exactly one API client. Lazily initialised on first use.
// Type is `any` because google-ads-api is imported lazily to avoid loading
// its ~500MB+ protobuf descriptors at module-load time.
let cachedApiClient: any = null;
let cachedApiFingerprint = '';

// ─── Customer object cache (per adAccountId) ────────────────────────────────
// Reusing the Customer avoids spawning duplicate HTTP/2 channels.
// Entries expire after CUSTOMER_CACHE_TTL_MS to pick up token refreshes.
// Capped at MAX_CUSTOMER_CACHE_SIZE to prevent protobuf descriptor trees
// from accumulating and inflating the heap (each Customer holds ~2–5 MB).
const CUSTOMER_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_CUSTOMER_CACHE_SIZE = 20;
interface CachedCustomer {
    customer: any;
    currency: string;
    createdAt: number;
}
const customerCache = new Map<string, CachedCustomer>();

// ─── Circuit-breakers ───────────────────────────────────────────────────────

/**
 * Auth breaker: accounts with expired OAuth (invalid_grant).
 * Prevents repeated API round-trips until the user re-authenticates.
 */
const AUTH_BREAKER_TTL_MS = 60 * 60 * 1000; // 60 minutes
const authBreakerMap = new Map<string, number>();

/**
 * gRPC failure breaker: accounts that keep returning "Unknown gRPC error".
 * After GRPC_BREAKER_THRESHOLD failures within GRPC_BREAKER_WINDOW_MS,
 * the account is skipped for GRPC_BREAKER_COOLDOWN_MS.
 */
const GRPC_BREAKER_THRESHOLD = 3;
const GRPC_BREAKER_WINDOW_MS = 5 * 60 * 1000;   // 5-minute window
const GRPC_BREAKER_COOLDOWN_MS = 10 * 60 * 1000; // 10-minute cooldown
interface GrpcBreakerState {
    failures: number[];       // timestamps of recent failures
    cooldownUntil: number;    // 0 = not in cooldown
}
const grpcBreakerMap = new Map<string, GrpcBreakerState>();

// Periodically purge expired breaker entries to prevent unbounded Map growth
setInterval(() => {
    const now = Date.now();
    for (const [id, ts] of authBreakerMap.entries()) {
        if (now - ts >= AUTH_BREAKER_TTL_MS) authBreakerMap.delete(id);
    }
    for (const [id, state] of grpcBreakerMap.entries()) {
        // Remove if cooldown has expired AND no recent failures
        if (state.cooldownUntil <= now && state.failures.length === 0) {
            grpcBreakerMap.delete(id);
        }
    }
}, 15 * 60 * 1000); // every 15 minutes

/**
 * Check if the gRPC circuit-breaker is currently open for an ad account.
 * Callers can use this to skip work before constructing full call chains.
 */
export function isGrpcBreakerOpen(adAccountId: string): boolean {
    const state = grpcBreakerMap.get(adAccountId);
    return !!(state && state.cooldownUntil > Date.now());
}

/** Mark an ad account as auth-broken. Called from parseGoogleAdsError. */
export function tripAuthBreaker(adAccountId: string): void {
    authBreakerMap.set(adAccountId, Date.now());
    // Also evict from customer cache so stale tokens aren't reused
    customerCache.delete(adAccountId);

    // Notify the user that their token has expired
    prisma.adAccount.findUnique({ where: { id: adAccountId }, select: { accountId: true, name: true, platform: true } })
        .then(adAccount => {
            if (adAccount?.accountId) {
                EventBus.emit(EVENTS.AD.AUTH_EXPIRED, {
                    accountId: adAccount.accountId,
                    adAccountId,
                    platform: adAccount.platform,
                    adAccountName: adAccount.name
                });
            }
        })
        .catch(err => Logger.warn('Failed to emit auth-expired event', { error: err.message }));
}

/**
 * Record a gRPC failure for an ad account.
 * Call this from catch blocks that see transient/unknown gRPC errors.
 */
export function recordGrpcFailure(adAccountId: string): void {
    const now = Date.now();
    let state = grpcBreakerMap.get(adAccountId);
    if (!state) {
        state = { failures: [], cooldownUntil: 0 };
        grpcBreakerMap.set(adAccountId, state);
    }
    // Already in cooldown — don't accumulate more failures
    if (state.cooldownUntil > now) return;

    // Prune old failures outside the window
    state.failures = state.failures.filter(t => now - t < GRPC_BREAKER_WINDOW_MS);
    state.failures.push(now);

    if (state.failures.length >= GRPC_BREAKER_THRESHOLD) {
        state.cooldownUntil = now + GRPC_BREAKER_COOLDOWN_MS;
        state.failures = []; // Reset so counter starts fresh after cooldown
        Logger.warn('gRPC circuit-breaker tripped — skipping account for 10 min', {
            adAccountId,
            failureCount: GRPC_BREAKER_THRESHOLD
        });
    }
}

export interface GoogleAdsClientConfig {
    customer: any;
    currency: string;
}

/**
 * Extract a usable error message from gRPC error objects.
 *
 * Why: google-ads-api sometimes throws raw gRPC errors where both
 * `.message` and `.details` are empty. This digs into nested error
 * structures (AggregateError, .cause chain) to surface diagnostics.
 */
export function extractGrpcErrorMessage(error: any): string {
    if (error.message) return error.message;
    if (error.details) return error.details;

    const parts: string[] = [];
    if (error.code !== undefined) parts.push(`gRPC code=${error.code}`);

    // AggregateError from Promise.any() — gRPC DNS/credential resolution
    if (Array.isArray(error.errors) && error.errors.length > 0) {
        const inner = error.errors[0];
        const innerMsg = inner?.message || inner?.details || String(inner);
        parts.push(`inner=${innerMsg}`);
    }

    // ES2022 Error.cause chain
    if (error.cause) {
        const causeMsg = error.cause?.message || String(error.cause);
        parts.push(`cause=${causeMsg}`);
    }

    // gRPC metadata sometimes carries error descriptions
    if (error.metadata) {
        try {
            const meta = typeof error.metadata.toJSON === 'function'
                ? JSON.stringify(error.metadata.toJSON())
                : String(error.metadata);
            if (meta && meta !== '{}') parts.push(`metadata=${meta}`);
        } catch { /* ignore serialisation failures */ }
    }

    if (parts.length > 0) return parts.join(' ');

    // Last resort: stringify the error object itself
    try {
        const str = String(error);
        if (str && str !== '[object Object]') return str;
    } catch { /* ignore */ }

    return 'Unknown gRPC error (no message/details/code)';
}

/**
 * Pre-flight OAuth token refresh.
 *
 * Why: google-ads-api delegates token refresh to gRPC's credential
 * provider, which swallows errors into opaque AggregateErrors with
 * zero diagnostics. By refreshing proactively via REST we can:
 * (a) detect revoked tokens immediately and trip the auth breaker,
 * (b) store a fresh access token so gRPC never needs to refresh.
 */
async function refreshAccessToken(
    adAccountId: string,
    refreshToken: string,
    clientId: string,
    clientSecret: string,
): Promise<string> {
    const params = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
    });

    const resp = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
    });

    const data = await resp.json();

    if (data.error) {
        // Trip auth breaker so scheduled jobs stop hammering Google
        tripAuthBreaker(adAccountId);
        Logger.warn('Google OAuth token refresh failed — auth breaker tripped', {
            adAccountId,
            error: data.error,
            description: data.error_description,
        });
        throw new Error(
            `Google token refresh failed: ${data.error_description || data.error}. ` +
            'Reconnect your Google Ads account in Settings.',
        );
    }

    // Persist the new access token so other services can use it
    if (data.access_token) {
        await prisma.adAccount.update({
            where: { id: adAccountId },
            data: { accessToken: data.access_token },
        }).catch(err => Logger.warn('Failed to persist refreshed access token', { error: err.message }));
    }

    return data.access_token;
}

/**
 * Create (or return cached) Google Ads API customer client for an ad account.
 */
export async function createGoogleAdsClient(adAccountId: string): Promise<GoogleAdsClientConfig> {
    const now = Date.now();

    // ── Auth circuit-breaker ─────────────────────────────────────────────
    const breakerTs = authBreakerMap.get(adAccountId);
    if (breakerTs && now - breakerTs < AUTH_BREAKER_TTL_MS) {
        throw new Error('Auth circuit-breaker active — invalid_grant within last 60 min. Re-authenticate to restore.');
    }

    // ── gRPC failure circuit-breaker ─────────────────────────────────────
    const grpcState = grpcBreakerMap.get(adAccountId);
    if (grpcState && grpcState.cooldownUntil > now) {
        throw new Error('gRPC circuit-breaker active — too many failures, cooling down for 10 min.');
    }

    // ── Return cached Customer if still fresh ────────────────────────────
    const cached = customerCache.get(adAccountId);
    if (cached && now - cached.createdAt < CUSTOMER_CACHE_TTL_MS) {
        // Promote to end of Map iteration order (LRU touch)
        customerCache.delete(adAccountId);
        customerCache.set(adAccountId, cached);
        return { customer: cached.customer, currency: cached.currency };
    }

    // ── Build or reuse the singleton GoogleAdsApi ────────────────────────
    const adAccount = await prisma.adAccount.findUnique({
        where: { id: adAccountId }
    });

    if (!adAccount || adAccount.platform !== 'GOOGLE' || !adAccount.refreshToken || !adAccount.externalId) {
        throw new Error('Invalid Google Ad Account');
    }

    const creds = await getCredentials('GOOGLE_ADS');
    if (!creds?.clientId || !creds?.clientSecret || !creds?.developerToken) {
        Logger.warn('Google Ads credentials not configured.');
        throw new Error('Google Ads credentials not configured');
    }

    const { clientId, clientSecret, developerToken } = creds;
    const fingerprint = `${clientId}:${developerToken}`;

    // Only allocate a new GoogleAdsApi if credentials changed (effectively never).
    // Lazy import: google-ads-api loads ~500MB+ of protobuf descriptors,
    // so we defer the import until the first actual API call.
    if (!cachedApiClient || cachedApiFingerprint !== fingerprint) {
        const { GoogleAdsApi } = await import('google-ads-api');
        cachedApiClient = new GoogleAdsApi({
            client_id: clientId,
            client_secret: clientSecret,
            developer_token: developerToken
        });
        cachedApiFingerprint = fingerprint;
        Logger.info('GoogleAdsApi client created (singleton — protobuf loaded)');
    }

    // ── Pre-flight token refresh via REST ──────────────────────────────
    // Validates the refresh token before gRPC touches it. On failure
    // the auth breaker is tripped with a clear error message.
    const freshAccessToken = await refreshAccessToken(
        adAccountId,
        adAccount.refreshToken,
        clientId,
        clientSecret,
    );

    const loginCustomerId = creds.loginCustomerId;
    const customerConfig: any = {
        customer_id: adAccount.externalId.replace(/-/g, ''),
        refresh_token: adAccount.refreshToken,
    };

    if (loginCustomerId) {
        customerConfig.login_customer_id = loginCustomerId.replace(/-/g, '');
    }

    const customer = cachedApiClient.Customer(customerConfig);
    const currency = adAccount.currency || 'USD';

    // Cache for reuse — evict oldest if at capacity
    if (customerCache.size >= MAX_CUSTOMER_CACHE_SIZE) {
        const oldestKey = customerCache.keys().next().value;
        if (oldestKey) customerCache.delete(oldestKey);
    }
    customerCache.set(adAccountId, { customer, currency, createdAt: now });

    return { customer, currency };
}

/**
 * Parse Google Ads API errors into user-friendly messages.
 */
export function parseGoogleAdsError(error: any, customerId: string): string {
    const errorMessage = error.message || error.details || '';
    const errorCode = error.code;

    // GRPC error code 12 = UNIMPLEMENTED
    if (errorCode === 12 || errorMessage.includes('UNIMPLEMENTED') || errorMessage.includes('GRPC target method')) {
        return 'Google Ads API access denied. Possible causes: ' +
            '(1) Developer token at "Test Account" level - upgrade to "Explorer Access" at https://ads.google.com/aw/apicenter. ' +
            '(2) Missing Manager Account ID (MCC) - if accessing client accounts through an MCC, add the Manager Account ID in Super Admin > Credentials > Google Ads.';
    }
    // GRPC error code 7 = PERMISSION_DENIED
    if (errorCode === 7 || errorMessage.includes('PERMISSION_DENIED')) {
        return 'Permission denied. Ensure the connected Google account has access to this Google Ads account (Customer ID: ' +
            customerId + '). If this account is managed by a Manager Account (MCC), you MUST configure the "Manager Account ID" in Super Admin > Credentials > Google Ads.';
    }
    // GRPC error code 16 = UNAUTHENTICATED
    if (errorCode === 16 || errorMessage.includes('UNAUTHENTICATED') || errorMessage.includes('invalid_grant')) {
        // Trip circuit-breaker so scheduled jobs skip this account for 60 min
        tripAuthBreaker(customerId);
        return 'Authentication expired. Please disconnect and reconnect your Google Ads account to refresh the OAuth tokens.';
    }
    // Invalid customer ID format
    if (errorMessage.includes('INVALID_CUSTOMER_ID') || errorMessage.includes('customer_id')) {
        return 'Invalid Customer ID format. Please verify the Customer ID is correct (format: 123-456-7890 or 1234567890).';
    }

    return errorMessage;
}
