/**
 * SMS Service
 * 
 * Handles SMS sending via Twilio.
 * Credentials are stored per-account in SmsSettings model.
 */

import { prisma } from '../utils/prisma';
import { Logger } from '../utils/logger';

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

export class SmsService {
    // Cache credentials per account to avoid repeated DB lookups
    private credentialsCache: Map<string, TwilioCredentials | null> = new Map();

    /**
     * Send an SMS message.
     * @param to - Recipient phone number (E.164 format, e.g., +1234567890)
     * @param body - Message content (max 1600 chars for concatenated)
     * @param accountId - Account ID for fetching credentials
     */
    async sendSms(to: string, body: string, accountId: string): Promise<SmsResult> {
        if (!accountId) {
            return { success: false, error: 'Account ID required' };
        }

        try {
            const creds = await this.getCredentials(accountId);
            if (!creds) {
                Logger.warn('SMS not configured for account', { accountId });
                return { success: false, error: 'SMS not configured for this account' };
            }

            // Normalize phone number
            const normalizedTo = this.normalizePhoneNumber(to);
            if (!normalizedTo) {
                return { success: false, error: 'Invalid phone number' };
            }

            // Twilio API call
            const url = `https://api.twilio.com/2010-04-01/Accounts/${creds.accountSid}/Messages.json`;
            const auth = Buffer.from(`${creds.accountSid}:${creds.authToken}`).toString('base64');

            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Authorization': `Basic ${auth}`,
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: new URLSearchParams({
                    To: normalizedTo,
                    From: creds.fromNumber,
                    Body: body
                })
            });

            const data = await response.json();

            if (!response.ok) {
                Logger.error('Twilio API error', {
                    status: response.status,
                    error: data,
                    accountId
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

            return {
                success: true,
                messageId: data.sid
            };

        } catch (error) {
            Logger.error('SMS send failed', { error, accountId });
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
        // Check cache first
        if (this.credentialsCache.has(accountId)) {
            return this.credentialsCache.get(accountId) || null;
        }

        try {
            const settings = await prisma.smsSettings.findUnique({
                where: { accountId }
            });

            if (!settings || !settings.enabled) {
                this.credentialsCache.set(accountId, null);
                return null;
            }

            const creds: TwilioCredentials = {
                accountSid: settings.accountSid,
                authToken: settings.authToken,
                fromNumber: settings.fromNumber
            };

            this.credentialsCache.set(accountId, creds);
            return creds;

        } catch (error) {
            Logger.error('Failed to fetch SMS settings', { error, accountId });
            return null;
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
     * Normalize phone number to E.164 format.
     */
    private normalizePhoneNumber(phone: string): string | null {
        if (!phone) return null;

        // Remove all non-digit characters except leading +
        let normalized = phone.replace(/[^\d+]/g, '');

        // Ensure it starts with +
        if (!normalized.startsWith('+')) {
            // Assume US/CA if no country code
            if (normalized.length === 10) {
                normalized = '+1' + normalized;
            } else if (normalized.length === 11 && normalized.startsWith('1')) {
                normalized = '+' + normalized;
            } else {
                normalized = '+' + normalized;
            }
        }

        // Basic validation: must be 10-15 digits after +
        const digits = normalized.slice(1);
        if (digits.length < 10 || digits.length > 15) {
            return null;
        }

        return normalized;
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
