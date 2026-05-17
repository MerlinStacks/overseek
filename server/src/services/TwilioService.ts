import { prisma } from '../utils/prisma';
import { Logger } from '../utils/logger';
import crypto from 'crypto';

const TWILIO_API_BASE = 'https://api.twilio.com/2010-04-01';
const MAX_SMS_LENGTH = 1600; // Limit to 10 segments

export class TwilioService {

    private static normalizeE164(value: string): string {
        const trimmed = String(value || '').trim();
        if (!trimmed) return '';

        // Twilio can provide values like "sms:+614..." or include formatting.
        const noPrefix = trimmed.replace(/^[a-zA-Z]+:/, '');
        const cleaned = noPrefix.replace(/[^\d+]/g, '');
        if (!cleaned) return '';

        const plusIndex = cleaned.indexOf('+');
        if (plusIndex !== -1) {
            const digits = cleaned.slice(plusIndex + 1).replace(/\D/g, '');
            return digits ? `+${digits}` : '';
        }

        if (cleaned.startsWith('00')) return `+${cleaned.slice(2).replace(/\D/g, '')}`;
        return cleaned.replace(/\D/g, '');
    }

    private static inferCountryCode(fromNumber: string): string {
        const normalized = this.normalizeE164(fromNumber);
        if (normalized.startsWith('+61')) return '+61';
        if (normalized.startsWith('+64')) return '+64';
        if (normalized.startsWith('+44')) return '+44';
        if (normalized.startsWith('+1')) return '+1';
        const match = normalized.match(/^\+(\d{1,3})/);
        return match ? `+${match[1]}` : '+1';
    }

    static normalizeToE164(input: string, fromNumber: string): string {
        const raw = this.normalizeE164(input);
        if (!raw) return '';
        if (raw.startsWith('+')) return raw;

        const cc = this.inferCountryCode(fromNumber);
        if (raw.startsWith('0')) return `${cc}${raw.slice(1)}`;
        if (cc === '+1' && raw.length === 10) return `+1${raw}`;
        return `${cc}${raw}`;
    }
    
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
        const normalizedTo = this.normalizeToE164(to, fromNumber);
        if (!normalizedTo || normalizedTo.replace(/\D/g, '').length < 10) {
            throw new Error('Invalid phone number format');
        }

        // Basic Auth
        const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');

        const formData = new URLSearchParams();
        formData.append('From', fromNumber);
        formData.append('To', normalizedTo);
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
    static async saveSettings(accountId: string, data: { accountSid: string; authToken: string; fromNumber: string; enabled: boolean; smsCostPerSegment?: number }) {
        const sanitizedCost =
            typeof data.smsCostPerSegment === 'number' && Number.isFinite(data.smsCostPerSegment)
                ? Math.max(0, data.smsCostPerSegment)
                : 0;

        return prisma.smsSettings.upsert({
            where: { accountId },
            update: {
                ...data,
                smsCostPerSegment: sanitizedCost,
            },
            create: {
                accountId,
                ...data,
                smsCostPerSegment: sanitizedCost,
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
