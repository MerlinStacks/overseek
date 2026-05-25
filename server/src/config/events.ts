import { EventBus, EVENTS } from '../services/events';
import { AutomationEngine } from '../services/AutomationEngine';
import { ChatService } from '../services/ChatService';
import { Logger } from '../utils/logger';
import { NotificationEngine } from '../services/NotificationEngine';

function subscribeAutomationTrigger(
    eventName: string,
    triggerName: string,
    getPayload: (data: any) => unknown,
    automationEngine: AutomationEngine
): void {
    EventBus.on(eventName, async (data: any) => {
        try {
            await automationEngine.processTrigger(data.accountId, triggerName, getPayload(data));
        } catch (error) {
            Logger.error('[EventBus] Failed to process automation trigger', {
                error,
                eventName,
                triggerName,
                accountId: data?.accountId
            });
        }
    });
}

export function subscribeEventBus(chatService: ChatService, automationEngine: AutomationEngine): void {
    subscribeAutomationTrigger(EVENTS.ORDER.CREATED, 'ORDER_CREATED', data => data.order, automationEngine);
    subscribeAutomationTrigger(EVENTS.ORDER.PAID, 'ORDER_PAID', data => data.order, automationEngine);
    subscribeAutomationTrigger(EVENTS.ORDER.COMPLETED, 'ORDER_COMPLETED', data => data.order, automationEngine);
    subscribeAutomationTrigger(EVENTS.ORDER.FIRST, 'FIRST_ORDER', data => data.order, automationEngine);
    subscribeAutomationTrigger(EVENTS.ORDER.STATUS_CHANGED, 'ORDER_STATUS_CHANGED', data => ({
        ...data.order,
        previousStatus: data.previousStatus,
        newStatus: data.newStatus
    }), automationEngine);
    subscribeAutomationTrigger(EVENTS.SHIPMENT.RECEIVED_BY_CARRIER, 'SHIPMENT_RECEIVED_BY_CARRIER', data => data.shipment, automationEngine);
    subscribeAutomationTrigger(EVENTS.SHIPMENT.IN_TRANSIT, 'SHIPMENT_IN_TRANSIT', data => data.shipment, automationEngine);
    subscribeAutomationTrigger(EVENTS.SHIPMENT.OUT_FOR_DELIVERY, 'SHIPMENT_OUT_FOR_DELIVERY', data => data.shipment, automationEngine);
    subscribeAutomationTrigger(EVENTS.SHIPMENT.DELIVERY_ATTEMPTED, 'SHIPMENT_DELIVERY_ATTEMPTED', data => data.shipment, automationEngine);
    subscribeAutomationTrigger(EVENTS.SHIPMENT.DELIVERED, 'SHIPMENT_DELIVERED', data => data.shipment, automationEngine);
    subscribeAutomationTrigger(EVENTS.SHIPMENT.EXCEPTION, 'SHIPMENT_EXCEPTION', data => data.shipment, automationEngine);
    subscribeAutomationTrigger(EVENTS.ARTWORK.UPLOADED, 'ARTWORK_UPLOADED', data => data.artwork, automationEngine);
    subscribeAutomationTrigger(EVENTS.ARTWORK.APPROVAL_REQUESTED, 'ARTWORK_APPROVAL_REQUESTED', data => data.artwork, automationEngine);
    subscribeAutomationTrigger(EVENTS.ARTWORK.APPROVED, 'ARTWORK_APPROVED', data => data.artwork, automationEngine);
    subscribeAutomationTrigger(EVENTS.ARTWORK.CHANGES_REQUESTED, 'ARTWORK_CHANGES_REQUESTED', data => data.artwork, automationEngine);
    subscribeAutomationTrigger(EVENTS.ARTWORK.OVERRIDE_USED, 'ARTWORK_OVERRIDE_USED', data => data.artwork, automationEngine);
    subscribeAutomationTrigger(EVENTS.CUSTOMER.CREATED, 'CUSTOMER_CREATED', data => data.customer, automationEngine);
    subscribeAutomationTrigger(EVENTS.REVIEW.LEFT, 'REVIEW_LEFT', data => data.review, automationEngine);

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
