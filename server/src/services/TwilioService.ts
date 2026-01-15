import { prisma } from '../utils/prisma';
import { Logger } from '../utils/logger';
import crypto from 'crypto';

const TWILIO_API_BASE = 'https://api.twilio.com/2010-04-01';
const MAX_SMS_LENGTH = 1600; // Limit to 10 segments

export class TwilioService {
    
    /**
     * Send an SMS message via Twilio
     */
    static async sendSms(accountId: string, to: string, body: string) {
        if (body.length > MAX_SMS_LENGTH) {
            throw new Error(`Message too long. Maximum length is ${MAX_SMS_LENGTH} characters.`);
        }

        const settings = await prisma.smsSettings.findUnique({
            where: { accountId }
        });

        if (!settings || !settings.enabled) {
            throw new Error('SMS settings not configured or disabled for this account.');
        }

        const { accountSid, authToken, fromNumber } = settings;

        // Basic Auth
        const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');

        const formData = new URLSearchParams();
        formData.append('From', fromNumber);
        formData.append('To', to);
        formData.append('Body', body);

        try {
            const response = await fetch(`${TWILIO_API_BASE}/Accounts/${accountSid}/Messages.json`, {
                method: 'POST',
                headers: {
                    'Authorization': `Basic ${auth}`,
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: formData
            });

            const data = await response.json();

            if (!response.ok) {
                Logger.error('[TwilioService] Failed to send SMS', { error: data, accountId });
                throw new Error(data.message || 'Failed to send SMS');
            }

            return data;
        } catch (error) {
            Logger.error('[TwilioService] Error sending SMS', { error, accountId });
            throw error;
        }
    }

    /**
     * Validate Twilio Webhook Signature
     * https://www.twilio.com/docs/usage/security/webhooks/validate-webhooks
     */
    static validateRequest(authToken: string, twilioSignature: string, url: string, params: Record<string, any>): boolean {
        // 1. Sort keys
        const keys = Object.keys(params).sort();
        
        // 2. Concatenate
        let data = url;
        for (const key of keys) {
            data += key + params[key];
        }

        // 3. HMAC-SHA1
        const hmac = crypto.createHmac('sha1', authToken)
            .update(data)
            .digest('base64');

        return hmac === twilioSignature;
    }

    /**
     * Save or update SMS settings
     */
    static async saveSettings(accountId: string, data: { accountSid: string; authToken: string; fromNumber: string; enabled: boolean }) {
        return prisma.smsSettings.upsert({
            where: { accountId },
            update: data,
            create: {
                accountId,
                ...data
            }
        });
    }

    /**
     * Get SMS settings
     */
    static async getSettings(accountId: string) {
        return prisma.smsSettings.findUnique({
            where: { accountId }
        });
    }
}
