/**
 * Meta Messaging Service (Facebook Messenger & Instagram DMs)
 * Handles Meta Graph API v18.0 messaging operations.
 * 
 * Why: Enables unified inbox to receive and send messages through
 * Facebook Pages and Instagram Business accounts.
 */

import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';
import { EventBus, EVENTS } from '../events';

const GRAPH_API_VERSION = 'v18.0';
const GRAPH_API_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

interface MetaMessagePayload {
    recipientId: string;
    message: string;
    messageType?: 'RESPONSE' | 'UPDATE' | 'MESSAGE_TAG';
}

interface MetaWebhookEntry {
    id: string;
    time: number;
    messaging?: MetaWebhookMessage[];
}

interface MetaWebhookMessage {
    sender: { id: string };
    recipient: { id: string };
    timestamp: number;
    message?: {
        mid: string;
        text?: string;
        attachments?: Array<{
            type: string;
            payload: { url?: string };
        }>;
    };
    read?: { watermark: number };
    delivery?: { mids: string[]; watermark: number };
}

export class MetaMessagingService {
    /**
     * Send a message via Facebook Messenger or Instagram DM.
     * Requires the page/IG account to be connected with messaging permissions.
     */
    static async sendMessage(
        socialAccountId: string,
        payload: MetaMessagePayload
    ): Promise<{ messageId: string } | null> {
        try {
            const socialAccount = await prisma.socialAccount.findUnique({
                where: { id: socialAccountId },
            });

            if (!socialAccount || !socialAccount.isActive) {
                Logger.warn('[MetaMessaging] Social account not found or inactive', { socialAccountId });
                return null;
            }

            const { platform, accessToken, externalId } = socialAccount;

            // Determine the correct endpoint based on platform
            const endpoint = platform === 'INSTAGRAM'
                ? `${GRAPH_API_BASE}/${externalId}/messages`
                : `${GRAPH_API_BASE}/${externalId}/messages`;

            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    recipient: { id: payload.recipientId },
                    message: { text: payload.message },
                    messaging_type: payload.messageType || 'RESPONSE',
                }),
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(JSON.stringify(errorData));
            }

            const data = await response.json();

            Logger.info('[MetaMessaging] Message sent', {
                platform,
                recipientId: payload.recipientId,
                messageId: data.message_id,
            });

            EventBus.emit(EVENTS.SOCIAL.MESSAGE_SENT, {
                platform,
                socialAccountId,
                messageId: data.message_id,
            });

            return { messageId: data.message_id };
        } catch (error: any) {
            Logger.error('[MetaMessaging] Failed to send message', {
                socialAccountId,
                error: error.message,
            });
            return null;
        }
    }

    /**
     * Process incoming webhook events from Meta.
     * Creates or updates conversations based on incoming messages.
     */
    static async processWebhookEvent(
        entries: MetaWebhookEntry[]
    ): Promise<void> {
        for (const entry of entries) {
            const pageId = entry.id;

            // Find the social account by externalId (page ID)
            const socialAccount = await prisma.socialAccount.findFirst({
                where: {
                    externalId: pageId,
                    platform: { in: ['FACEBOOK', 'INSTAGRAM'] },
                    isActive: true,
                },
                include: { account: true },
            });

            if (!socialAccount) {
                Logger.warn('[MetaMessaging] No social account found for page', { pageId });
                continue;
            }

            for (const event of entry.messaging || []) {
                await this.handleMessageEvent(socialAccount, event);
            }
        }
    }

    /**
     * Handle individual message events (new message, read, delivery).
     */
    private static async handleMessageEvent(
        socialAccount: any,
        event: MetaWebhookMessage
    ): Promise<void> {
        const { sender, message, read, delivery } = event;

        // Skip if it's our own message (sent by the page)
        if (sender.id === socialAccount.externalId) {
            return;
        }

        // Handle read receipts
        if (read) {
            Logger.debug('[MetaMessaging] Read receipt', { watermark: read.watermark });
            return;
        }

        // Handle delivery confirmations
        if (delivery) {
            Logger.debug('[MetaMessaging] Delivery confirmation', { mids: delivery.mids });
            return;
        }

        // Handle new incoming message
        if (message) {
            await this.handleIncomingMessage(socialAccount, sender.id, message, event.timestamp);
        }
    }

    /**
     * Create or update conversation and add the incoming message.
     */
    private static async handleIncomingMessage(
        socialAccount: any,
        senderId: string,
        message: NonNullable<MetaWebhookMessage['message']>,
        timestamp: number
    ): Promise<void> {
        const accountId = socialAccount.accountId;
        const platform = socialAccount.platform as 'FACEBOOK' | 'INSTAGRAM';
        const channel = platform === 'FACEBOOK' ? 'FACEBOOK' : 'INSTAGRAM';

        // Build external conversation ID (platform + page + sender)
        const externalConversationId = `${platform}:${socialAccount.externalId}:${senderId}`;

        // Find or create conversation
        let conversation = await prisma.conversation.findFirst({
            where: {
                accountId,
                externalConversationId,
            },
        });

        if (!conversation) {
            // Fetch sender profile for display name
            const senderProfile = await this.getUserProfile(socialAccount.accessToken, senderId);
            const guestName = senderProfile?.name || `${platform} User`;

            conversation = await prisma.conversation.create({
                data: {
                    accountId,
                    channel,
                    externalConversationId,
                    socialAccountId: socialAccount.id,
                    guestName,
                    status: 'OPEN',
                    priority: 'MEDIUM',
                },
            });

            Logger.info('[MetaMessaging] Created new conversation', {
                conversationId: conversation.id,
                channel,
                senderId,
            });
        } else {
            // Re-open conversation if it was closed
            if (conversation.status !== 'OPEN') {
                await prisma.conversation.update({
                    where: { id: conversation.id },
                    data: { status: 'OPEN', updatedAt: new Date() },
                });
            }
        }

        // Build message content
        let content = message.text || '';
        if (message.attachments?.length) {
            const attachmentLinks = message.attachments
                .filter(a => a.payload?.url)
                .map(a => `[Attachment: ${a.type}](${a.payload.url})`)
                .join('\n');
            content = content ? `${content}\n\n${attachmentLinks}` : attachmentLinks;
        }

        // Create the message
        const newMessage = await prisma.message.create({
            data: {
                conversationId: conversation.id,
                content,
                contentType: message.attachments?.length ? 'FILE' : 'TEXT',
                senderType: 'CUSTOMER',
                senderId: senderId,
            },
        });

        Logger.info('[MetaMessaging] Message received and stored', {
            conversationId: conversation.id,
            messageId: newMessage.id,
            platform,
        });

        // Emit event for real-time updates
        EventBus.emit(EVENTS.SOCIAL.MESSAGE_RECEIVED, {
            accountId,
            conversationId: conversation.id,
            messageId: newMessage.id,
            platform,
            senderId,
        });
    }

    /**
     * Fetch user profile from Meta Graph API.
     */
    private static async getUserProfile(
        accessToken: string,
        userId: string
    ): Promise<{ name?: string; profilePic?: string } | null> {
        try {
            const url = new URL(`${GRAPH_API_BASE}/${userId}`);
            url.searchParams.set('fields', 'name,profile_pic');
            url.searchParams.set('access_token', accessToken);

            const response = await fetch(url.toString());
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            return await response.json();
        } catch (error: any) {
            Logger.warn('[MetaMessaging] Failed to fetch user profile', {
                userId,
                error: error.message,
            });
            return null;
        }
    }

    /**
     * Get Instagram Business Account ID linked to a Facebook Page.
     * Required for IG DM integration.
     */
    static async getInstagramBusinessAccount(
        pageAccessToken: string,
        pageId: string
    ): Promise<{ igUserId: string; username: string } | null> {
        try {
            const url = new URL(`${GRAPH_API_BASE}/${pageId}`);
            url.searchParams.set('fields', 'instagram_business_account{id,username}');
            url.searchParams.set('access_token', pageAccessToken);

            const response = await fetch(url.toString());
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();
            const igAccount = data.instagram_business_account;
            if (!igAccount) {
                return null;
            }

            return {
                igUserId: igAccount.id,
                username: igAccount.username,
            };
        } catch (error: any) {
            Logger.error('[MetaMessaging] Failed to get Instagram business account', {
                pageId,
                error: error.message,
            });
            return null;
        }
    }

    /**
     * Verify webhook signature for security.
     */
    static verifyWebhookSignature(
        signature: string,
        payload: string,
        appSecret: string
    ): boolean {
        const crypto = require('crypto');
        const expectedSignature = 'sha256=' + crypto
            .createHmac('sha256', appSecret)
            .update(payload)
            .digest('hex');

        return crypto.timingSafeEqual(
            Buffer.from(signature),
            Buffer.from(expectedSignature)
        );
    }

    /**
     * List Facebook Pages the user has access to.
     * Used during OAuth to let user select which page to connect.
     */
    static async listUserPages(
        userAccessToken: string
    ): Promise<Array<{ id: string; name: string; accessToken: string }>> {
        try {
            const url = new URL(`${GRAPH_API_BASE}/me/accounts`);
            url.searchParams.set('fields', 'id,name,access_token');
            url.searchParams.set('access_token', userAccessToken);

            const response = await fetch(url.toString());
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();
            // Map snake_case from API to camelCase for our code
            return (data.data || []).map((page: any) => ({
                id: page.id,
                name: page.name,
                accessToken: page.access_token,
            }));
        } catch (error: any) {
            Logger.error('[MetaMessaging] Failed to list user pages', {
                error: error.message,
            });
            return [];
        }
    }
}
