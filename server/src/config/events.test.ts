import { afterEach, describe, expect, it, vi } from 'vitest';
import { subscribeEventBus } from './events';
import { EventBus, EVENTS } from '../services/events';
import { NotificationEngine } from '../services/NotificationEngine';

vi.mock('../utils/logger', () => ({
    Logger: {
        debug: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
        warn: vi.fn()
    }
}));

vi.mock('../services/NotificationEngine', () => ({
    NotificationEngine: {
        init: vi.fn()
    }
}));

describe('event bus automation subscriptions', () => {
    afterEach(() => {
        EventBus.removeAllListeners();
        vi.clearAllMocks();
    });

    it('runs Order Created automations from processing paid order events only', async () => {
        const automationEngine = {
            processTrigger: vi.fn().mockResolvedValue(undefined)
        };
        const chatService = {
            handleIncomingEmail: vi.fn().mockResolvedValue(undefined)
        };
        const order = {
            id: 123,
            status: 'processing',
            billing: { email: 'customer@example.com' }
        };

        subscribeEventBus(chatService as any, automationEngine as any);

        EventBus.emit(EVENTS.ORDER.CREATED, { accountId: 'account-1', order });
        await Promise.resolve();

        expect(automationEngine.processTrigger).not.toHaveBeenCalled();

        EventBus.emit(EVENTS.ORDER.PAID, { accountId: 'account-1', order });

        await vi.waitFor(() => {
            expect(automationEngine.processTrigger).toHaveBeenCalledWith('account-1', 'ORDER_CREATED', order);
            expect(automationEngine.processTrigger).toHaveBeenCalledWith('account-1', 'ORDER_PAID', order);
        });
        expect(NotificationEngine.init).toHaveBeenCalledTimes(1);
    });

    it('does not run Order Created automations for on-hold paid order events', async () => {
        const automationEngine = {
            processTrigger: vi.fn().mockResolvedValue(undefined)
        };
        const chatService = {
            handleIncomingEmail: vi.fn().mockResolvedValue(undefined)
        };
        const order = {
            id: 123,
            status: 'on-hold',
            billing: { email: 'customer@example.com' }
        };

        subscribeEventBus(chatService as any, automationEngine as any);
        EventBus.emit(EVENTS.ORDER.PAID, { accountId: 'account-1', order });

        await vi.waitFor(() => {
            expect(automationEngine.processTrigger).toHaveBeenCalledWith('account-1', 'ORDER_PAID', order);
        });
        expect(automationEngine.processTrigger).not.toHaveBeenCalledWith('account-1', 'ORDER_CREATED', order);
    });
});
