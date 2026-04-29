const CHANNEL_NAME = 'overseek-product-events';
const STORAGE_KEY = 'overseek-product-event';

export interface ProductChangeEvent {
    type: 'updated' | 'synced';
    productId: string;
    accountId: string;
    timestamp: number;
}

export type CrossTabResource = 'product' | 'order' | 'customer' | 'purchase-order';

export interface CrossTabEvent {
    resource: CrossTabResource;
    type: 'updated' | 'synced' | 'deleted' | 'merged' | 'tags-updated' | 'status-updated';
    accountId: string;
    resourceId?: string;
    timestamp: number;
}

function createBroadcastChannel(): BroadcastChannel | null {
    if (typeof BroadcastChannel === 'undefined') {
        return null;
    }

    return new BroadcastChannel(CHANNEL_NAME);
}

export function emitProductChange(event: Omit<ProductChangeEvent, 'timestamp'>): void {
    emitCrossTabEvent({
        resource: 'product',
        type: event.type,
        accountId: event.accountId,
        resourceId: event.productId,
    });
}

export function subscribeToProductChanges(
    listener: (event: ProductChangeEvent) => void
): () => void {
    return subscribeToCrossTabEvents((event) => {
        if (event.resource !== 'product' || !event.resourceId) {
            return;
        }

        listener({
            type: event.type === 'synced' ? 'synced' : 'updated',
            productId: event.resourceId,
            accountId: event.accountId,
            timestamp: event.timestamp,
        });
    });
}

export function emitCrossTabEvent(event: Omit<CrossTabEvent, 'timestamp'>): void {
    const payload: CrossTabEvent = {
        ...event,
        timestamp: Date.now(),
    };

    const channel = createBroadcastChannel();
    if (channel) {
        channel.postMessage(payload);
        channel.close();
    }

    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
        // Ignore storage write failures; BroadcastChannel may still have worked.
    }
}

export function subscribeToCrossTabEvents(
    listener: (event: CrossTabEvent) => void
): () => void {
    const channel = createBroadcastChannel();

    const handleChannelMessage = (message: MessageEvent<CrossTabEvent>) => {
        listener(message.data);
    };

    const handleStorage = (event: StorageEvent) => {
        if (event.key !== STORAGE_KEY || !event.newValue) {
            return;
        }

        try {
            listener(JSON.parse(event.newValue) as CrossTabEvent);
        } catch {
            // Ignore malformed payloads.
        }
    };

    channel?.addEventListener('message', handleChannelMessage);
    window.addEventListener('storage', handleStorage);

    return () => {
        channel?.removeEventListener('message', handleChannelMessage);
        channel?.close();
        window.removeEventListener('storage', handleStorage);
    };
}
