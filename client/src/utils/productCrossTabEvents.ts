const CHANNEL_NAME = 'overseek-product-events';
const STORAGE_KEY = 'overseek-product-event';
import { isRecord } from './responseValidation';

interface ProductChangeEvent {
    type: 'updated' | 'synced';
    productId: string;
    accountId: string;
    timestamp: number;
}

type CrossTabResource = 'product' | 'order' | 'customer' | 'purchase-order';

interface CrossTabEvent {
    resource: CrossTabResource;
    type: 'updated' | 'synced' | 'deleted' | 'merged' | 'tags-updated' | 'status-updated';
    accountId: string;
    resourceId?: string;
    timestamp: number;
    eventId?: string;
}

function createBroadcastChannel(): BroadcastChannel | null {
    if (typeof BroadcastChannel === 'undefined') {
        return null;
    }

    try { return new BroadcastChannel(CHANNEL_NAME); } catch { return null; }
}

const text = (value: unknown): value is string => typeof value === 'string' && !!value.trim() && value.length <= 500;
function decode(value: unknown): CrossTabEvent | null {
    if (!isRecord(value) || !['product', 'order', 'customer', 'purchase-order'].includes(value.resource as string) ||
        !['updated', 'synced', 'deleted', 'merged', 'tags-updated', 'status-updated'].includes(value.type as string) || !text(value.accountId) ||
        value.resourceId !== undefined && !text(value.resourceId) || value.eventId !== undefined && !text(value.eventId) ||
        typeof value.timestamp !== 'number' || !Number.isSafeInteger(value.timestamp) || value.timestamp <= 0 || value.timestamp > Date.now() + 60000 || Date.now() - value.timestamp > 300000) return null;
    return { resource: value.resource as CrossTabResource, type: value.type as CrossTabEvent['type'], accountId: value.accountId,
        resourceId: value.resourceId as string | undefined, timestamp: value.timestamp, eventId: value.eventId as string | undefined };
}
function close(channel: BroadcastChannel | null) { try { channel?.close(); } catch { /* Optional transport. */ } }

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

export function emitCrossTabEvent(event: Omit<CrossTabEvent, 'timestamp' | 'eventId'>): void {
    const payload = decode({
        ...event,
        timestamp: Date.now(),
        eventId: (() => { try { return crypto.randomUUID(); } catch { return `${Date.now()}-${Math.random().toString(36).slice(2)}`; } })(),
    });
    if (!payload) return;

    const channel = createBroadcastChannel();
    if (channel) {
        try { channel.postMessage(payload); } catch { /* Try storage below. */ }
        finally { close(channel); }
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
    let active = true;
    const seen = new Map<string, number>();
    // Events are untrusted refresh hints. Consumers must refetch using their own authenticated account.
    const deliver = (value: unknown) => {
        if (!active) return;
        const event = decode(value); if (!event) return;
        const now = Date.now();
        for (const [id, time] of seen) if (now - time > 300000) seen.delete(id);
        const id = event.eventId ?? JSON.stringify(event);
        if (seen.has(id)) return;
        if (seen.size >= 500) seen.delete(seen.keys().next().value!);
        seen.set(id, now);
        listener(event);
    };

    const handleChannelMessage = (message: MessageEvent<CrossTabEvent>) => {
        deliver(message.data);
    };

    const handleStorage = (event: StorageEvent) => {
        if (event.key !== STORAGE_KEY || !event.newValue || event.newValue.length > 10000) {
            return;
        }

        try {
            deliver(JSON.parse(event.newValue));
        } catch {
            // Ignore malformed payloads.
        }
    };

    try { channel?.addEventListener('message', handleChannelMessage); } catch { close(channel); }
    window.addEventListener('storage', handleStorage);

    return () => {
        active = false;
        try { channel?.removeEventListener('message', handleChannelMessage); } catch { /* Optional transport. */ }
        close(channel);
        window.removeEventListener('storage', handleStorage);
    };
}
