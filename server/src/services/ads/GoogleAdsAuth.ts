/**
 * Google Ads OAuth & Authentication
 * 
 * Handles Google OAuth flow for Google Ads API access.
 * Extracted from GoogleAdsService for modularity.
 */

import { Logger } from '../../utils/logger';
import { GoogleAdsApi } from 'google-ads-api';
import { getCredentials } from './types';

export class GoogleAdsAuth {

    /**
     * Exchange Google OAuth authorization code for access/refresh tokens.
     * Called after user completes OAuth consent flow.
     */
    static async exchangeCode(
        code: string,
        redirectUri: string
    ): Promise<{ accessToken: string; refreshToken: string }> {
        const creds = await getCredentials('GOOGLE_ADS');
        if (!creds?.clientId || !creds?.clientSecret) {
            throw new Error('Google Ads credentials not configured. Please configure via Super Admin.');
        }

        const { clientId, clientSecret } = creds;

        const tokenUrl = 'https://oauth2.googleapis.com/token';
        const params = new URLSearchParams({
            code,
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: redirectUri,
            grant_type: 'authorization_code'
        });

        try {
            Logger.info('Exchanging Google OAuth code', { redirectUri, hasCode: !!code });

            const response = await fetch(tokenUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: params.toString()
            });

            const data = await response.json();

            Logger.info('Google token exchange response', {
                hasAccessToken: !!data.access_token,
                hasRefreshToken: !!data.refresh_token,
                error: data.error,
                tokenType: data.token_type
            });

            if (data.error) {
                throw new Error(data.error_description || data.error);
            }

            if (!data.access_token) {
                throw new Error('No access token received from Google');
            }

            if (!data.refresh_token) {
                Logger.warn('No refresh token received from Google. User may need to revoke app access at https://myaccount.google.com/permissions and re-authorize.');
            }

            return {
                accessToken: data.access_token,
                refreshToken: data.refresh_token || ''
            };
        } catch (error) {
            Logger.error('Failed to exchange Google OAuth code', { error });
            throw error;
        }
    }

    /**
     * Get the Google OAuth authorization URL for user consent.
     */
    static async getAuthUrl(redirectUri: string, state: string): Promise<string> {
        const creds = await getCredentials('GOOGLE_ADS');
        if (!creds?.clientId) {
            throw new Error('Google Ads credentials not configured. Please configure via Super Admin.');
        }

        const { clientId } = creds;

        const scopes = ['https://www.googleapis.com/auth/adwords'];

        const params = new URLSearchParams({
            client_id: clientId,
            redirect_uri: redirectUri,
            response_type: 'code',
            scope: scopes.join(' '),
            access_type: 'offline',
            prompt: 'consent',
            state
        });

        return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
    }

    /**
     * Fetch all accessible Google Ads customer accounts after OAuth.
     * Used to let user select which ad account to connect.
     */
    static async listCustomers(refreshToken: string): Promise<Array<{ id: string; name: string }>> {
        const creds = await getCredentials('GOOGLE_ADS');
        if (!creds?.clientId || !creds?.clientSecret || !creds?.developerToken) {
            throw new Error('Google Ads credentials not configured. Please configure via Super Admin.');
        }

        const { clientId, clientSecret, developerToken, loginCustomerId } = creds;

        try {
            const client = new GoogleAdsApi({
                client_id: clientId,
                client_secret: clientSecret,
                developer_token: developerToken
            });

            const response = await client.listAccessibleCustomers(refreshToken);
            const customerResourceNames = response.resource_names || [];
            const customerIds = customerResourceNames.map((rn: string) => rn.replace('customers/', ''));

            const results: Array<{ id: string; name: string }> = [];

            for (const customerId of customerIds) {
                try {
                    const customerConfig: any = {
                        customer_id: customerId.replace(/-/g, ''),
                        refresh_token: refreshToken
                    };

                    if (loginCustomerId) {
                        customerConfig.login_customer_id = loginCustomerId.replace(/-/g, '');
                    }

                    const customer = client.Customer(customerConfig);

                    const [info] = await customer.query(`
                        SELECT customer.descriptive_name, customer.id
                        FROM customer
                        LIMIT 1
                    `);

                    results.push({
                        id: customerId,
                        name: (info as any)?.customer?.descriptive_name || `Account ${customerId}`
                    });
                } catch {
                    results.push({ id: customerId, name: `Account ${customerId}` });
                }
            }

            return results;
        } catch (error) {
            Logger.error('Failed to list Google Ads customers', { error });
            throw error;
        }
    }
}
