import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const drafts = vi.hoisted(() => ({ getDraft: () => '', saveDraft: vi.fn(), clearDraft: vi.fn() }));
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ token: 'token', user: { id: 'user' } }) }));
vi.mock('../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: { id: 'account' } }) }));
vi.mock('../context/SocketContext', () => ({ useSocket: () => ({ socket: null }) }));
vi.mock('./useDrafts', () => ({ useDrafts: () => drafts }));
vi.mock('./useSignaturePreference', () => ({ useSignaturePreference: () => ({ signatureEnabled: false, setSignatureEnabled: vi.fn() }) }));
vi.mock('../utils/logger', () => ({ Logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { useMessageSend } from './useMessageSend';

beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('message undo countdown cleanup', () => {
    it.each([false, true])('stops the countdown after delivery (failure: %s)', async (fails) => {
        const onSendMessage = vi.fn().mockImplementation(async () => {
            if (fails) throw new Error('Delivery failed');
        });
        const { result, unmount } = renderHook(() => useMessageSend({ conversationId: 'conversation', onSendMessage }));
        act(() => result.current.setInput('Hello there'));
        act(() => result.current.handleSend());
        expect(result.current.pendingSend).not.toBeNull();
        await act(async () => { await vi.advanceTimersByTimeAsync(result.current.UNDO_DELAY_MS); });
        expect(onSendMessage).toHaveBeenCalledOnce();
        expect(result.current.pendingSend).toBeNull();
        expect(vi.getTimerCount()).toBe(0);
        unmount();
        expect(vi.getTimerCount()).toBe(0);
    });
});
