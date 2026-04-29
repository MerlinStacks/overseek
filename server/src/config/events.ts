import { EventBus, EVENTS } from '../services/events';
import { AutomationEngine } from '../services/AutomationEngine';
import { ChatService } from '../services/ChatService';
import { Logger } from '../utils/logger';
import { NotificationEngine } from '../services/NotificationEngine';

export function subscribeEventBus(chatService: ChatService, automationEngine: AutomationEngine): void {
    EventBus.on(EVENTS.ORDER.CREATED, async (data) => {
        await automationEngine.processTrigger(data.accountId, 'ORDER_CREATED', data.order);
    });

    EventBus.on(EVENTS.ORDER.PAID, async (data) => {
        await automationEngine.processTrigger(data.accountId, 'ORDER_PAID', data.order);
    });

    EventBus.on(EVENTS.ORDER.COMPLETED, async (data) => {
        await automationEngine.processTrigger(data.accountId, 'ORDER_COMPLETED', data.order);
    });

    EventBus.on(EVENTS.ORDER.FIRST, async (data) => {
        await automationEngine.processTrigger(data.accountId, 'FIRST_ORDER', data.order);
    });

    EventBus.on(EVENTS.ORDER.STATUS_CHANGED, async (data) => {
        await automationEngine.processTrigger(data.accountId, 'ORDER_STATUS_CHANGED', {
            ...data.order,
            previousStatus: data.previousStatus,
            newStatus: data.newStatus
        });
    });

    EventBus.on(EVENTS.CUSTOMER.CREATED, async (data) => {
        await automationEngine.processTrigger(data.accountId, 'CUSTOMER_CREATED', data.customer);
    });

    EventBus.on(EVENTS.REVIEW.LEFT, async (data) => {
        await automationEngine.processTrigger(data.accountId, 'REVIEW_LEFT', data.review);
    });

    EventBus.on(EVENTS.EMAIL.RECEIVED, async (data: any) => {
        if (data.emailAccountId && !data.conversationId) {
            if (!data.fromEmail || !data.messageId) {
                Logger.warn('[App] Skipping malformed email event - missing required fields', {
                    hasFromEmail: !!data.fromEmail,
                    hasMessageId: !!data.messageId,
                    emailAccountId: data.emailAccountId
                });
                return;
            }
            try {
                Logger.info('[App] Processing incoming email', {
                    fromEmail: data.fromEmail,
                    subject: data.subject,
                    emailAccountId: data.emailAccountId
                });
                await chatService.handleIncomingEmail({
                    emailAccountId: data.emailAccountId,
                    fromEmail: data.fromEmail,
                    fromName: data.fromName,
                    subject: data.subject,
                    body: data.body,
                    html: data.html,
                    messageId: data.messageId,
                    inReplyTo: data.inReplyTo,
                    references: data.references,
                    attachments: data.attachments
                });
                Logger.info('[App] Successfully ingested email', {
                    fromEmail: data.fromEmail,
                    subject: data.subject
                });
            } catch (error) {
                Logger.error('[App] Failed to handle incoming email', { error, fromEmail: data.fromEmail });
            }
        }
    });

    NotificationEngine.init();
}
