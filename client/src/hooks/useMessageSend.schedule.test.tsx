import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ fetch: vi.fn(), getDraft: () => 'Draft message', saveDraft: vi.fn(), clearDraft: vi.fn() }));
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ token: 'token', user: { id: 'user' } }) }));
vi.mock('../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: { id: 'account' } }) }));
vi.mock('../context/SocketContext', () => ({ useSocket: () => ({ socket: null }) }));
vi.mock('./useDrafts', () => ({ useDrafts: () => m }));
vi.mock('./useSignaturePreference', () => ({ useSignaturePreference: () => ({ signatureEnabled: false, setSignatureEnabled: vi.fn() }) }));
vi.mock('../utils/logger', () => ({ Logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
import { useMessageSend } from './useMessageSend';
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('fetch', m.fetch); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe('scheduled-message result propagation', () => {
    it('rejects failed scheduling so the picker can show an error and allow retry', async () => {
        m.fetch.mockResolvedValue({ ok: false, json: async () => ({ error: 'Unavailable' }) });
        const { result } = renderHook(() => useMessageSend({ conversationId: 'conversation', onSendMessage: vi.fn() }));
        await act(async () => { await expect(result.current.handleScheduleMessage(new Date('2027-01-01'))).rejects.toThrow('Failed to schedule'); });
        expect(result.current.input).toBe('Draft message'); expect(m.clearDraft).not.toHaveBeenCalled(); expect(result.current.isScheduling).toBe(false);
    });
    it('clears the draft only after successful scheduling', async () => {
        m.fetch.mockResolvedValue({ ok: true });
        const { result } = renderHook(() => useMessageSend({ conversationId: 'conversation', onSendMessage: vi.fn() }));
        await act(async () => { await result.current.handleScheduleMessage(new Date('2027-01-01')); });
        expect(result.current.input).toBe(''); expect(m.clearDraft).toHaveBeenCalledWith('conversation');
    });
});
