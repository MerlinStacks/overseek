import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ receipt: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() }, transaction: vi.fn(), error: vi.fn() }));
vi.mock('../utils/prisma', () => ({ prisma: { $transaction: m.transaction, scopedOperation: m.receipt } }));
vi.mock('../utils/logger', () => ({ Logger: { error: m.error } }));
import { EVENTS, SystemEventBus } from './events';
beforeEach(() => { vi.resetAllMocks(); m.receipt.findUnique.mockResolvedValue(null); m.receipt.updateMany.mockResolvedValue({ count: 1 }); m.transaction.mockImplementation(fn => fn({ $queryRaw: vi.fn(), scopedOperation: m.receipt })); });
it('isolates synchronous and asynchronous subscribers and does not log payloads', async () => {
    const bus = new SystemEventBus(), observed = vi.fn();
    bus.on(EVENTS.ORDER.PAID, () => { throw new Error('sensitive-secret'); });
    bus.on(EVENTS.ORDER.PAID, async () => { throw new Error('sensitive-secret'); });
    bus.on(EVENTS.ORDER.PAID, observed);
    expect(bus.emit(EVENTS.ORDER.PAID, { accountId: 'a', private: 'sensitive-secret' })).toBe(true);
    await Promise.resolve(); expect(observed).toHaveBeenCalledOnce(); expect(m.error).toHaveBeenCalledTimes(2); expect(JSON.stringify(m.error.mock.calls)).not.toContain('sensitive-secret');
    expect(bus.emit('unknown-event', { accountId: 'a' })).toBe(false);
});
it('requires scoped durable occurrences, acknowledges required handlers and replays without delivering twice', async () => {
    const bus = new SystemEventBus(), handler = vi.fn().mockResolvedValue(undefined);
    const dispose = bus.subscribeRequired(EVENTS.EMAIL.RECEIVED, 'ingestion', handler);
    const payload = { accountId: 'a', occurrenceId: 'source-message', body: 'synthetic' };
    await bus.publishRequired(EVENTS.EMAIL.RECEIVED, payload);
    expect(handler).toHaveBeenCalledOnce();
    const complete = m.receipt.update.mock.calls.at(-1)![0].data;
    m.receipt.findUnique.mockResolvedValue(complete);
    await bus.publishRequired(EVENTS.EMAIL.RECEIVED, payload); expect(handler).toHaveBeenCalledOnce();
    dispose();
});
it('does not acknowledge a missing/failed consumer or automatically retry uncertainty', async () => {
    const bus = new SystemEventBus();
    bus.subscribeRequired(EVENTS.EMAIL.RECEIVED, 'ingestion', async () => { throw new Error('lost acknowledgement'); });
    await expect(bus.publishRequired(EVENTS.EMAIL.RECEIVED, { accountId: 'a', occurrenceId: 'msg' })).rejects.toThrow('unavailable');
    expect(m.receipt.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { result: expect.objectContaining({ state: 'uncertain' }) } }));
    m.receipt.findUnique.mockResolvedValue({ result: { state: 'uncertain' } });
    await expect(bus.publishRequired(EVENTS.EMAIL.RECEIVED, { accountId: 'a', occurrenceId: 'msg' })).rejects.toThrow('reconcile');
});
