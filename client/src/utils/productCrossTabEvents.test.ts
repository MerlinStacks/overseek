import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { emitCrossTabEvent, subscribeToCrossTabEvents } from './productCrossTabEvents';
const channels: FakeChannel[] = [];
class FakeChannel {
    handler: ((event: MessageEvent) => void) | null = null;
    closed = false;
    constructor() { channels.push(this); }
    postMessage = vi.fn();
    addEventListener(_name: string, handler: (event: MessageEvent) => void) { this.handler = handler; }
    removeEventListener() { this.handler = null; }
    close() { this.closed = true; }
}
beforeEach(() => { channels.length = 0; localStorage.clear(); vi.stubGlobal('BroadcastChannel', FakeChannel); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const event = () => ({ resource: 'product', type: 'updated', accountId: 'a', resourceId: 'p', timestamp: Date.now(), eventId: 'event-id' });
it('falls back to storage if construction or posting fails', () => {
    vi.stubGlobal('BroadcastChannel', class { constructor() { throw Error('blocked'); } });
    expect(() => emitCrossTabEvent({ resource: 'product', type: 'updated', accountId: 'a', resourceId: 'p' })).not.toThrow();
    expect(localStorage.getItem('overseek-product-event')).not.toBeNull();
    vi.stubGlobal('BroadcastChannel', FakeChannel); vi.spyOn(FakeChannel.prototype, 'close').mockImplementation(() => { throw Error('close'); });
    expect(() => emitCrossTabEvent({ resource: 'product', type: 'updated', accountId: 'a' })).not.toThrow();
});
it('validates, deduplicates transports, and suppresses late delivery after unsubscribe', () => {
    const listener = vi.fn(); const unsubscribe = subscribeToCrossTabEvents(listener); const handler = channels[0].handler!;
    handler({ data: event() } as MessageEvent);
    window.dispatchEvent(new StorageEvent('storage', { key: 'overseek-product-event', newValue: JSON.stringify(event()) }));
    expect(listener).toHaveBeenCalledTimes(1);
    for (const bad of [null, {}, { ...event(), eventId: 'stale', timestamp: Date.now() - 3600000 }, { ...event(), eventId: 'future', timestamp: Date.now() + 3600000 }, { ...event(), accountId: {} }]) handler({ data: bad } as MessageEvent);
    expect(listener).toHaveBeenCalledTimes(1); unsubscribe(); handler({ data: { ...event(), eventId: 'late' } } as MessageEvent); expect(listener).toHaveBeenCalledTimes(1); expect(channels[0].closed).toBe(true);
});
it('keeps storage subscriptions usable when channel setup fails', () => {
    vi.spyOn(FakeChannel.prototype, 'addEventListener').mockImplementation(() => { throw Error(); });
    const listener = vi.fn(); const unsubscribe = subscribeToCrossTabEvents(listener);
    window.dispatchEvent(new StorageEvent('storage', { key: 'overseek-product-event', newValue: JSON.stringify(event()) }));
    expect(listener).toHaveBeenCalledOnce(); unsubscribe();
});
