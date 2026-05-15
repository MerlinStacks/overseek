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

    EventBus.on(EVENTS.SHIPMENT.IN_TRANSIT, async (data) => {
        await automationEngine.processTrigger(data.accountId, 'SHIPMENT_IN_TRANSIT', data.shipment);
    });

    EventBus.on(EVENTS.SHIPMENT.OUT_FOR_DELIVERY, async (data) => {
        await automationEngine.processTrigger(data.accountId, 'SHIPMENT_OUT_FOR_DELIVERY', data.shipment);
    });

    EventBus.on(EVENTS.SHIPMENT.DELIVERY_ATTEMPTED, async (data) => {
        await automationEngine.processTrigger(data.accountId, 'SHIPMENT_DELIVERY_ATTEMPTED', data.shipment);
    });

    EventBus.on(EVENTS.SHIPMENT.DELIVERED, async (data) => {
        await automationEngine.processTrigger(data.accountId, 'SHIPMENT_DELIVERED', data.shipment);
    });

    EventBus.on(EVENTS.SHIPMENT.EXCEPTION, async (data) => {
        await automationEngine.processTrigger(data.accountId, 'SHIPMENT_EXCEPTION', data.shipment);
    });

    EventBus.on(EVENTS.ARTWORK.UPLOADED, async (data) => {
        await automationEngine.processTrigger(data.accountId, 'ARTWORK_UPLOADED', data.artwork);
    });

    EventBus.on(EVENTS.ARTWORK.APPROVAL_REQUESTED, async (data) => {
        await automationEngine.processTrigger(data.accountId, 'ARTWORK_APPROVAL_REQUESTED', data.artwork);
    });

    EventBus.on(EVENTS.ARTWORK.APPROVED, async (data) => {
        await automationEngine.processTrigger(data.accountId, 'ARTWORK_APPROVED', data.artwork);
    });

    EventBus.on(EVENTS.ARTWORK.CHANGES_REQUESTED, async (data) => {
        await automationEngine.processTrigger(data.accountId, 'ARTWORK_CHANGES_REQUESTED', data.artwork);
    });

    EventBus.on(EVENTS.ARTWORK.OVERRIDE_USED, async (data) => {
        await automationEngine.processTrigger(data.accountId, 'ARTWORK_OVERRIDE_USED', data.artwork);
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
