/**
 * Google Ads Client Factory
 * 
 * Shared helper for creating Google Ads API clients.
 * Reduces code duplication across GoogleAdsService methods.
 */

import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';
import { GoogleAdsApi } from 'google-ads-api';
import { getCredentials } from './types';

/**
 * Circuit-breaker for accounts with expired OAuth tokens (invalid_grant).
 * Prevents repeated API round-trips and object allocation for accounts
 * that will fail until the user re-authenticates.
 */
const AUTH_BREAKER_TTL_MS = 60 * 60 * 1000; // 60 minutes
const authBreakerMap = new Map<string, number>();

/** Mark an ad account as auth-broken. Called from parseGoogleAdsError. */
export function tripAuthBreaker(adAccountId: string): void {
    authBreakerMap.set(adAccountId, Date.now());
}

export interface GoogleAdsClientConfig {
    customer: any;
    currency: string;
}

/**
 * Create a Google Ads API customer client from an ad account ID.
 */
export async function createGoogleAdsClient(adAccountId: string): Promise<GoogleAdsClientConfig> {
    // Circuit-breaker: skip accounts with recent invalid_grant errors
    const breakerTs = authBreakerMap.get(adAccountId);
    if (breakerTs && Date.now() - breakerTs < AUTH_BREAKER_TTL_MS) {
        throw new Error('Auth circuit-breaker active — invalid_grant within last 60 min. Re-authenticate to restore.');
    }

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

    const client = new GoogleAdsApi({
        client_id: clientId,
        client_secret: clientSecret,
        developer_token: developerToken
    });

    const loginCustomerId = creds.loginCustomerId;
    const customerConfig: any = {
        customer_id: adAccount.externalId.replace(/-/g, ''),
        refresh_token: adAccount.refreshToken
    };

    // Log credential state at debug level (previously info — too noisy in production)
    Logger.debug('Google Ads client config', {
        customerId: adAccount.externalId,
        hasLoginCustomerId: !!loginCustomerId,
        loginCustomerId: loginCustomerId ? `${loginCustomerId.substring(0, 4)}...` : null
    });

    if (loginCustomerId) {
        // Only add if explicitly set in credentials
        customerConfig.login_customer_id = loginCustomerId.replace(/-/g, '');
    } else {
        Logger.warn('No loginCustomerId configured - this may cause USER_PERMISSION_DENIED errors for MCC-managed accounts');
    }

    return {
        customer: client.Customer(customerConfig),
        currency: adAccount.currency || 'USD'
    };
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
