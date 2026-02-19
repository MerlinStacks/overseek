import { EventEmitter } from 'events';
import { Logger } from '../utils/logger';

// Event Types
export const EVENTS = {
    ORDER: {
        SYNCED: 'order:synced',
        CREATED: 'order:created',
        COMPLETED: 'order:completed',
    },
    PRODUCT: {
        SYNCED: 'product:synced',
    },
    REVIEW: {
        SYNCED: 'review:synced',
        LEFT: 'review:left',
    },
    EMAIL: {
        RECEIVED: 'email:received'
    },
    CHAT: {
        MESSAGE_RECEIVED: 'chat:message_received',
    },
    STOCK: {
        MISMATCH: 'stock:mismatch',
    },
    SOCIAL: {
        MESSAGE_RECEIVED: 'social:message_received',
        MESSAGE_SENT: 'social:message_sent',
        ACCOUNT_CONNECTED: 'social:account_connected',
        ACCOUNT_DISCONNECTED: 'social:account_disconnected',
    },
    AD: {
        ALERT: 'ad:alert', // AI Marketing Co-Pilot Phase 6
    },
    INVENTORY: {
        STOCKOUT_ALERT: 'inventory:stockout_alert', // Predictive Inventory Forecasting
    },
    SYNC: {
        FAILURE_THRESHOLD: 'sync:failure_threshold'
    },
    SEO: {
        RANK_CHANGE: 'seo:rank_change',
        KEYWORD_ALERT: 'seo:keyword_alert',
    }
};

class SystemEventBus extends EventEmitter {
    constructor() {
        super();
        this.on('error', (err) => {
            Logger.error('EventBus Error', { error: err.message });
        });
    }

    // Typed emit wrapper could be added here for stricter types
    emit(event: string, ...args: any[]): boolean {
        // Why no args: serializing full event payloads (orders, products) on
        // every emit caused significant GC pressure from repeated JSON.stringify.
        Logger.debug(`Event Emitted: ${event}`);
        return super.emit(event, ...args);
    }
}

export const EventBus = new SystemEventBus();
