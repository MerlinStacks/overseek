/**
 * SMS Service
 * 
 * Handles SMS sending via Twilio.
 * Credentials are stored per-account in SmsSettings model.
 */

import { prisma } from '../utils/prisma';
import { Logger } from '../utils/logger';
import { recordSmsLog, SmsLogContext } from './SmsLogService';
import { TwilioService } from './TwilioService';

interface TwilioCredentials {
    accountSid: string;
    authToken: string;
    fromNumber: string;
}

interface SmsResult {
    success: boolean;
    messageId?: string;
    error?: string;
}

const SMS_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const MAX_SMS_LENGTH = 1600;

async function safeTwilioJson(response: Response, accountId: string): Promise<any> {
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
        const bodySnippet = (await response.text()).slice(0, 200);
        Logger.warn('Twilio returned non-JSON response', { status: response.status, contentType, bodySnippet, accountId });
        return { message: 'Twilio returned a non-JSON response' };
    }

    return response.json();
}

interface CachedCreds {
    creds: TwilioCredentials | null;
    cachedAt: number;
}

export class SmsService {
    // Cache credentials per account to avoid repeated DB lookups (TTL: 1 hour)
    private credentialsCache: Map<string, CachedCreds> = new Map();

    /**
     * Send an SMS message.
     * @param to - Recipient phone number (E.164 format, e.g., +1234567890)
     * @param body - Message content (max 1600 chars for concatenated)
     * @param accountId - Account ID for fetching credentials
     */
    async sendSms(to: string, body: string, accountId: string, context: SmsLogContext = {}): Promise<SmsResult> {
        if (!accountId) {
            return { success: false, error: 'Account ID required' };
        }

        if (body.length > MAX_SMS_LENGTH) {
            await recordSmsLog({ accountId, to, body, status: 'FAILED', errorMessage: `Message too long. Maximum length is ${MAX_SMS_LENGTH} characters.`, ...context });
            return {
                success: false,
                error: `Message too long. Maximum length is ${MAX_SMS_LENGTH} characters.`
            };
        }

        try {
            const creds = await this.getCredentials(accountId);
            if (!creds) {
                Logger.warn('SMS not configured for account', { accountId });
                await recordSmsLog({ accountId, to, body, status: 'FAILED', errorMessage: 'SMS not configured for this account', ...context });
                return { success: false, error: 'SMS not configured for this account' };
            }

            // Normalize phone number
            // Infer the recipient's country from the account's Twilio number.
            // WooCommerce commonly stores local numbers (for example 0491...
            // in Australia), which must have the trunk zero replaced by +61.
            const normalizedTo = TwilioService.normalizeToE164(to, creds.fromNumber);
            const normalizedDigits = normalizedTo.replace(/\D/g, '');
            if (!normalizedTo || normalizedDigits.length < 10 || normalizedDigits.length > 15) {
                await recordSmsLog({ accountId, to, from: creds.fromNumber, body, status: 'FAILED', errorMessage: 'Invalid phone number', ...context });
                return { success: false, error: 'Invalid phone number' };
            }

            // Twilio API call
            const url = `https://api.twilio.com/2010-04-01/Accounts/${creds.accountSid}/Messages.json`;
            const auth = Buffer.from(`${creds.accountSid}:${creds.authToken}`).toString('base64');

            const formData = new URLSearchParams({
                To: normalizedTo,
                From: creds.fromNumber,
                Body: body
            });
            const appUrl = process.env.APP_URL?.trim().replace(/\/+$/, '');
            if (appUrl?.startsWith('https://')) formData.append('StatusCallback', `${appUrl}/api/sms/status`);

            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Authorization': `Basic ${auth}`,
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: formData
            });

            const data = await safeTwilioJson(response, accountId);

            if (!response.ok) {
                Logger.error('Twilio API error', {
                    status: response.status,
                    error: data,
                    accountId
                });
                await recordSmsLog({
                    accountId, to: normalizedTo, from: creds.fromNumber, body, status: 'FAILED',
                    errorMessage: data.message || 'Failed to send SMS', errorCode: data.code, ...context
                });
                return {
                    success: false,
                    error: data.message || 'Failed to send SMS'
                };
            }

            Logger.info('SMS sent successfully', {
                messageId: data.sid,
                to: normalizedTo,
                accountId
            });
            await recordSmsLog({
                accountId, to: normalizedTo, from: creds.fromNumber, body,
                status: data.status || 'QUEUED', messageId: data.sid,
                segments: data.num_segments, price: data.price, priceUnit: data.price_unit,
                ...context
            });

            return {
                success: true,
                messageId: data.sid
            };

        } catch (error) {
            Logger.error('SMS send failed', { error, accountId });
            await recordSmsLog({
                accountId, to, body, status: 'FAILED',
                errorMessage: error instanceof Error ? error.message : 'Unknown error', ...context
            });
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }

    /**
     * Fetch Twilio credentials for a specific account.
     */
    private async getCredentials(accountId: string): Promise<TwilioCredentials | null> {
        // Check cache first (with TTL)
        const cached = this.credentialsCache.get(accountId);
        if (cached && Date.now() - cached.cachedAt < SMS_CACHE_TTL_MS) {
            return cached.creds;
        }

        try {
            const settings = await prisma.smsSettings.findUnique({
                where: { accountId }
            });

            if (!settings || !settings.enabled) {
                this.evictStaleEntries();
                this.credentialsCache.set(accountId, { creds: null, cachedAt: Date.now() });
                return null;
            }

            const creds: TwilioCredentials = {
                accountSid: settings.accountSid,
                authToken: settings.authToken,
                fromNumber: settings.fromNumber
            };

            this.evictStaleEntries();
            this.credentialsCache.set(accountId, { creds, cachedAt: Date.now() });
            return creds;

        } catch (error) {
            Logger.error('Failed to fetch SMS settings', { error, accountId });
            return null;
        }
    }

    /** Evict expired entries to prevent unbounded cache growth. */
    private evictStaleEntries(): void {
        if (this.credentialsCache.size < 100) return;
        const now = Date.now();
        for (const [key, entry] of this.credentialsCache) {
            if (now - entry.cachedAt >= SMS_CACHE_TTL_MS) {
                this.credentialsCache.delete(key);
            }
        }
    }

    /**
     * Clear credentials cache (e.g., when settings are updated).
     */
    clearCache(accountId?: string): void {
        if (accountId) {
            this.credentialsCache.delete(accountId);
        } else {
            this.credentialsCache.clear();
        }
    }

    /**
     * Check if SMS is configured for an account.
     */
    async isConfigured(accountId: string): Promise<boolean> {
        const creds = await this.getCredentials(accountId);
        return creds !== null;
    }
}

// Singleton instance
export const smsService = new SmsService();
