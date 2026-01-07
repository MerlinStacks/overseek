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
    SOCIAL: {
        MESSAGE_RECEIVED: 'social:message_received',
        MESSAGE_SENT: 'social:message_sent',
        ACCOUNT_CONNECTED: 'social:account_connected',
        ACCOUNT_DISCONNECTED: 'social:account_disconnected',
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
        Logger.debug(`Event Emitted: ${event}`, { args });
        return super.emit(event, ...args);
    }
}

export const EventBus = new SystemEventBus();
