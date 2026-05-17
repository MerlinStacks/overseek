import { FastifyInstance } from 'fastify';
import { ChatService } from '../services/ChatService';
import { TwilioService } from '../services/TwilioService';
import { prisma } from '../utils/prisma';
import { Logger } from '../utils/logger';
import { requireAuthFastify } from '../middleware/auth';

export const createSmsRoutes = (chatService: ChatService) => async (fastify: FastifyInstance) => {

    const parseWebhookParams = async (request: any): Promise<Record<string, string>> => {
        const body = request.body;
        if (body && typeof body === 'object' && !Array.isArray(body)) {
            return body as Record<string, string>;
        }
        if (typeof body === 'string') {
            return Object.fromEntries(new URLSearchParams(body).entries());
        }

        const raw = await new Promise<string>((resolve, reject) => {
            let data = '';
            request.raw.setEncoding('utf8');
            request.raw.on('data', (chunk: string) => { data += chunk; });
            request.raw.on('end', () => resolve(data));
            request.raw.on('error', reject);
        });
        return Object.fromEntries(new URLSearchParams(raw).entries());
    };
    
    // Get SMS Settings
    fastify.get('/settings', { preHandler: requireAuthFastify }, async (request, reply) => {
        const accountId = request.accountId;
        if (!accountId) return reply.status(400).send({ error: 'Missing account ID' });

        const settings = await TwilioService.getSettings(accountId);
        return settings || {};
    });

    // Update SMS Settings
    fastify.post('/settings', { preHandler: requireAuthFastify }, async (request, reply) => {
        const accountId = request.accountId;
        if (!accountId) return reply.status(400).send({ error: 'Missing account ID' });

        const data = request.body as any;
        
        // Basic validation
        if (!data.accountSid || !data.authToken || !data.fromNumber) {
            return reply.status(400).send({ error: 'Missing required fields' });
        }

        const settings = await TwilioService.saveSettings(accountId, {
            accountSid: data.accountSid,
            authToken: data.authToken,
            fromNumber: data.fromNumber,
            enabled: data.enabled !== false,
            smsCostPerSegment: typeof data.smsCostPerSegment === 'number'
                ? data.smsCostPerSegment
                : Number.parseFloat(String(data.smsCostPerSegment || 0))
        });

        return settings;
    });

    // Twilio Webhook
    fastify.post('/webhook', async (request, reply) => {
        const params = await parseWebhookParams(request);
        const { From, To, Body, AccountSid } = params;

        if (!From || !Body) {
            Logger.warn('[SMS Webhook] Missing required params', { params });
            return reply.status(400).send({ error: 'Invalid request' });
        }

        try {
            const normalizedFrom = TwilioService.normalizeToE164(From, To || From);
            const normalizedTo = To ? TwilioService.normalizeToE164(To, To) : '';

            // 1. Find Account by Twilio AccountSid, fallback to destination number match
            let settings = AccountSid
                ? await prisma.smsSettings.findFirst({ where: { accountSid: AccountSid, enabled: true } })
                : null;

            if (!settings && normalizedTo) {
                const allEnabled = await prisma.smsSettings.findMany({ where: { enabled: true } });
                settings = allEnabled.find(s => TwilioService.normalizeToE164(s.fromNumber, s.fromNumber) === normalizedTo) || null;
            }

            if (!settings) {
                Logger.warn('[SMS Webhook] Unable to resolve account from webhook', {
                    AccountSid,
                    To,
                    normalizedTo
                });
                return reply.status(404).send({ error: 'Account not found' });
            }

            // 2. Validate Signature (Optional but recommended)
            // const signature = request.headers['x-twilio-signature'] as string;
            // const url = `https://${request.hostname}${request.url}`;
            // if (!TwilioService.validateRequest(settings.authToken, signature, url, params)) {
            //     Logger.warn('[SMS Webhook] Invalid signature');
            //     return reply.status(403).send({ error: 'Forbidden' });
            // }

            // 3. Find or Create Conversation
            let conversation = await prisma.conversation.findFirst({
                where: {
                    accountId: settings.accountId,
                    channel: 'SMS',
                    externalConversationId: normalizedFrom,
                    status: 'OPEN'
                }
            });

            if (!conversation) {
                // Check if we have a closed one to reopen? Or just create new?
                // Usually we reopen if recent, but for now let's create/reopen logic
                // If there's a closed one, we might want to append to it or start new.
                // Let's try to find ANY conversation with this number to link history?
                // For simplicity, let's create a new one if no OPEN one exists.
                
                conversation = await chatService.createConversation(settings.accountId);
                
                // Update channel and external ID
                await prisma.conversation.update({
                    where: { id: conversation.id },
                    data: {
                        channel: 'SMS',
                        externalConversationId: normalizedFrom,
                        // Try to link to WooCustomer if phone matches?
                        // This would require searching WooCustomers by phone.
                    }
                });
            }

            // 4. Add Message
            await chatService.addMessage(
                conversation.id,
                Body,
                'CUSTOMER',
                undefined, // senderId is null for external customers usually, or we could link to WooCustomer
                false,
                settings.accountId
            );

            // Twilio expects TwiML response or empty 200 OK
            reply.type('text/xml').send('<Response></Response>');

        } catch (error) {
            Logger.error('[SMS Webhook] Error processing message', { error });
            reply.status(500).send({ error: 'Internal Server Error' });
        }
    });
};
