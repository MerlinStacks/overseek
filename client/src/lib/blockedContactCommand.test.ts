import { afterEach, expect, it, vi } from 'vitest';
import { changeBlockedContact } from './blockedContactCommand';
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
it('requires matching scoped preflight and sends observed versions with one stable operation', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response({ accountId: 'a', email: 'user@example.com', version: null, conversationVersion: '2026-01-01T00:00:00.000Z' })).mockImplementationOnce(async (_url, options) => response({ success: true, accountId: 'a', email: 'user@example.com', blocked: true, operationId: JSON.parse(options.body).operationId }));
    vi.stubGlobal('fetch', fetch);
    await changeBlockedContact('token', 'a', { conversationId: 'synthetic-success' }, true);
    expect(fetch.mock.calls[1][0]).toBe('/api/chat/synthetic-success/block');
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toMatchObject({ version: null, conversationVersion: '2026-01-01T00:00:00.000Z', operationId: expect.any(String) });
});
it('rejects a foreign preflight and retains a lost post acknowledgement instead of admitting replay', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response({ accountId: 'foreign', email: 'user@example.com', version: null }));
    vi.stubGlobal('fetch', fetch);
    await expect(changeBlockedContact('token', 'a', { email: 'foreign@example.com' }, false)).rejects.toThrow('scope');
    expect(fetch).toHaveBeenCalledOnce();
    fetch.mockResolvedValueOnce(response({ accountId: 'a', email: 'lost@example.com', version: null })).mockRejectedValueOnce(new Error('network lost'));
    await expect(changeBlockedContact('token', 'a', { email: 'lost@example.com' }, false)).rejects.toThrow('Reconcile operation');
    const calls = fetch.mock.calls.length;
    await expect(changeBlockedContact('token', 'a', { email: 'lost@example.com' }, false)).rejects.toThrow('pending/unconfirmed');
    expect(fetch).toHaveBeenCalledTimes(calls);
});

it('supports older browsers without AbortSignal composition or throwIfAborted', async () => {
    vi.spyOn(AbortSignal, 'any').mockImplementation(() => { throw new Error('Unsupported'); });
    vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => { throw new Error('Unsupported'); });
    vi.spyOn(AbortSignal.prototype, 'throwIfAborted').mockImplementation(() => { throw new Error('Unsupported'); });
    const fetch = vi.fn().mockResolvedValueOnce(response({ accountId: 'a', email: 'user@example.com', version: null }))
        .mockImplementationOnce(async (_url, options) => response({ success: true, accountId: 'a', email: 'user@example.com', blocked: true, operationId: JSON.parse(options.body).operationId }));
    vi.stubGlobal('fetch', fetch);
    await changeBlockedContact('token', 'a', { conversationId: 'older-browser' }, true, new AbortController().signal);
    expect(fetch).toHaveBeenCalledTimes(2);
});

it('does not submit after cancellation during preflight and allows a fresh preflight', async () => {
    const controller = new AbortController();
    const fetch = vi.fn(async () => {
        controller.abort();
        return response({ accountId: 'a', email: 'user@example.com', version: null });
    });
    vi.stubGlobal('fetch', fetch);
    await expect(changeBlockedContact('token', 'a', { conversationId: 'cancelled' }, true, controller.signal)).rejects.toThrow('cancelled');
    expect(fetch).toHaveBeenCalledOnce();
    fetch.mockRejectedValueOnce(new Error('fresh preflight'));
    await expect(changeBlockedContact('token', 'a', { conversationId: 'cancelled' }, true)).rejects.toThrow('fresh preflight');
});
