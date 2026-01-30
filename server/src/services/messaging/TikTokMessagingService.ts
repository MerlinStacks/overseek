/**
 * TikTok Messaging Service
 * Handles TikTok Business Messaging API interactions.
 * 
 * Why: Enables unified inbox to receive and respond to TikTok DMs
 * from business accounts.
 * 
 * Note: TikTok has a 48-hour reply window - businesses can only
 * respond within 48 hours of the customer's last message.
 * Also unavailable in EEA, Switzerland, and UK.
 */

import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';
import { EventBus, EVENTS } from '../events';

const TIKTOK_API_BASE = 'https://open.tiktokapis.com/v2';

interface TikTokMessagePayload {
    recipientOpenId: string;
    message: string;
}

interface TikTokWebhookEvent {
    event: string;
    create_time: number;
    from_user_open_id: string;
    to_user_open_id: string;
    message_id: string;
    message?: {
        type: 'text' | 'image' | 'video' | 'link';
        text?: string;
        image_url?: string;
        video_url?: string;
    };
}

export class TikTokMessagingService {
    /**
     * Check if we're within the 48-hour reply window.
     * TikTok only allows responses within 48 hours of customer's last message.
     */
    static isWithinReplyWindow(lastCustomerMessageAt: Date): boolean {
        const windowMs = 48 * 60 * 60 * 1000; // 48 hours in ms
        const elapsed = Date.now() - lastCustomerMessageAt.getTime();
        return elapsed < windowMs;
    }

    /**
     * Get time remaining in reply window (in hours).
     */
    static getReplyWindowRemaining(lastCustomerMessageAt: Date): number {
        const windowMs = 48 * 60 * 60 * 1000;
        const elapsed = Date.now() - lastCustomerMessageAt.getTime();
        const remaining = (windowMs - elapsed) / (60 * 60 * 1000);
        return Math.max(0, remaining);
    }

    /**
     * Send a message via TikTok Business Messaging.
     */
    static async sendMessage(
        socialAccountId: string,
        payload: TikTokMessagePayload
    ): Promise<{ messageId: string } | null> {
        try {
            const socialAccount = await prisma.socialAccount.findUnique({
                where: { id: socialAccountId },
            });

            if (!socialAccount || !socialAccount.isActive) {
                Logger.warn('[TikTokMessaging] Social account not found or inactive', { socialAccountId });
                return null;
            }

            // Check reply window by finding the last customer message
            const conversation = await prisma.conversation.findFirst({
                where: {
                    socialAccountId,
                    externalConversationId: { contains: payload.recipientOpenId },
                },
                include: {
                    messages: {
                        where: { senderType: 'CUSTOMER' },
                        orderBy: { createdAt: 'desc' },
                        take: 1,
                    },
                },
            });

            if (conversation?.messages[0]) {
                const lastMessage = conversation.messages[0];
                if (!this.isWithinReplyWindow(lastMessage.createdAt)) {
                    Logger.warn('[TikTokMessaging] Reply window expired', {
                        conversationId: conversation.id,
                        lastMessageAt: lastMessage.createdAt,
                    });
                    throw new Error('TikTok 48-hour reply window has expired. Cannot send message.');
                }
            }

            const { accessToken } = socialAccount;

            const response = await fetch(`${TIKTOK_API_BASE}/message/send/`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    receiver_open_id: payload.recipientOpenId,
                    message_type: 'text',
                    text: payload.message,
                }),
            });

            const data = await response.json();

            if (data.error?.code !== 'ok') {
                throw new Error(data.error?.message || 'TikTok API error');
            }

            Logger.info('[TikTokMessaging] Message sent', {
                recipientOpenId: payload.recipientOpenId,
                messageId: data.data?.message_id,
            });

            EventBus.emit(EVENTS.SOCIAL.MESSAGE_SENT, {
                platform: 'TIKTOK',
                socialAccountId,
                messageId: data.data?.message_id,
            });

            return { messageId: data.data?.message_id };
        } catch (error: any) {
            Logger.error('[TikTokMessaging] Failed to send message', {
                socialAccountId,
                error: error.message,
            });
            throw error;
        }
    }

    /**
     * Process incoming webhook events from TikTok.
     */
    static async processWebhookEvent(
        event: TikTokWebhookEvent
    ): Promise<void> {
        const toOpenId = event.to_user_open_id; // Our business account

        // Find the social account by externalId
        const socialAccount = await prisma.socialAccount.findFirst({
            where: {
                externalId: toOpenId,
                platform: 'TIKTOK',
                isActive: true,
            },
            include: { account: true },
        });

        if (!socialAccount) {
            Logger.warn('[TikTokMessaging] No social account found', { toOpenId });
            return;
        }

        // Handle message events
        if (event.event === 'message' && event.message) {
            await this.handleIncomingMessage(socialAccount, event);
        }
    }

    /**
     * Handle incoming TikTok DM.
     */
    private static async handleIncomingMessage(
        socialAccount: any,
        event: TikTokWebhookEvent
    ): Promise<void> {
        const accountId = socialAccount.accountId;
        const senderId = event.from_user_open_id;

        // Build external conversation ID
        const externalConversationId = `TIKTOK:${socialAccount.externalId}:${senderId}`;

        // Find or create conversation
        let conversation = await prisma.conversation.findFirst({
            where: {
                accountId,
                externalConversationId,
            },
        });

        if (!conversation) {
            conversation = await prisma.conversation.create({
                data: {
                    accountId,
                    channel: 'TIKTOK',
                    externalConversationId,
                    socialAccountId: socialAccount.id,
                    guestName: 'TikTok User', // TikTok may not provide name
                    status: 'OPEN',
                    priority: 'MEDIUM',
                },
            });

            Logger.info('[TikTokMessaging] Created new conversation', {
                conversationId: conversation.id,
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
        let content = '';
        const msg = event.message!;

        switch (msg.type) {
            case 'text':
                content = msg.text || '';
                break;
            case 'image':
                content = `[Image](${msg.image_url})`;
                break;
            case 'video':
                content = `[Video](${msg.video_url})`;
                break;
            default:
                content = `[${msg.type} message]`;
        }

        // Create the message
        const newMessage = await prisma.message.create({
            data: {
                conversationId: conversation.id,
                content,
                contentType: msg.type === 'text' ? 'TEXT' : 'FILE',
                senderType: 'CUSTOMER',
                senderId: senderId,
            },
        });

        Logger.info('[TikTokMessaging] Message received and stored', {
            conversationId: conversation.id,
            messageId: newMessage.id,
        });

        // Emit event for real-time updates
        EventBus.emit(EVENTS.SOCIAL.MESSAGE_RECEIVED, {
            accountId,
            conversationId: conversation.id,
            messageId: newMessage.id,
            platform: 'TIKTOK',
            senderId,
            replyWindowExpires: new Date(Date.now() + 48 * 60 * 60 * 1000),
        });
    }

    /**
     * Verify TikTok webhook signature.
     */
    static verifyWebhookSignature(
        signature: string,
        timestamp: string,
        payload: string,
        clientSecret: string
    ): boolean {
        const crypto = require('crypto');
        const message = timestamp + payload;
        const expectedSignature = crypto
            .createHmac('sha256', clientSecret)
            .update(message)
            .digest('hex');

        return crypto.timingSafeEqual(
            Buffer.from(signature),
            Buffer.from(expectedSignature)
        );
    }

    /**
     * Exchange authorization code for access token.
     */
    static async exchangeAuthCode(
        code: string,
        clientKey: string,
        clientSecret: string,
        redirectUri: string
    ): Promise<{ accessToken: string; refreshToken: string; openId: string; expiresIn: number } | null> {
        try {
            const response = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: new URLSearchParams({
                    client_key: clientKey,
                    client_secret: clientSecret,
                    code,
                    grant_type: 'authorization_code',
                    redirect_uri: redirectUri,
                }),
            });

            const data = await response.json();
            if (data.error) {
                throw new Error(data.error_description || data.error);
            }

            return {
                accessToken: data.access_token,
                refreshToken: data.refresh_token,
                openId: data.open_id,
                expiresIn: data.expires_in,
            };
        } catch (error: any) {
            Logger.error('[TikTokMessaging] Token exchange failed', {
                error: error.message,
            });
            return null;
        }
    }

    /**
     * Refresh access token using refresh token.
     */
    static async refreshAccessToken(
        refreshToken: string,
        clientKey: string,
        clientSecret: string
    ): Promise<{ accessToken: string; refreshToken: string; expiresIn: number } | null> {
        try {
            const response = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: new URLSearchParams({
                    client_key: clientKey,
                    client_secret: clientSecret,
                    grant_type: 'refresh_token',
                    refresh_token: refreshToken,
                }),
            });

            const data = await response.json();
            if (data.error) {
                throw new Error(data.error_description || data.error);
            }

            return {
                accessToken: data.access_token,
                refreshToken: data.refresh_token,
                expiresIn: data.expires_in,
            };
        } catch (error: any) {
            Logger.error('[TikTokMessaging] Token refresh failed', {
                error: error.message,
            });
            return null;
        }
    }
}
