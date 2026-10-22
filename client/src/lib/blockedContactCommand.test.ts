import { afterEach, expect, it, vi } from 'vitest';
import { changeBlockedContact } from './blockedContactCommand';
afterEach(() => vi.unstubAllGlobals());
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
