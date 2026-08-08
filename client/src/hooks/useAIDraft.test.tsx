import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAIDraft } from './useAIDraft';

vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ token: 'token' }) }));
vi.mock('../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: { id: 'account-1' } }) }));
vi.mock('../utils/logger', () => ({ Logger: { warn: vi.fn(), error: vi.fn() } }));

describe('useAIDraft', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('aborts and ignores a draft completed for a previous conversation', async () => {
        let complete!: (response: Response) => void;
        let requestSignal: AbortSignal | undefined;
        vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (_input, init) => {
            requestSignal = init?.signal || undefined;
            return new Promise<Response>(resolve => { complete = resolve; });
        }));
        const onDraftGenerated = vi.fn();
        const { result, rerender } = renderHook(
            ({ conversationId }) => useAIDraft({ conversationId, currentInput: '', onDraftGenerated }),
            { initialProps: { conversationId: 'conversation-1' } },
        );

        let generation!: Promise<void>;
        act(() => { generation = result.current.handleGenerateAIDraft(); });
        rerender({ conversationId: 'conversation-2' });
        expect(requestSignal?.aborted).toBe(true);
        complete(new Response(JSON.stringify({ draft: 'stale draft' }), { status: 200 }));
        await act(async () => generation);

        expect(onDraftGenerated).not.toHaveBeenCalled();
    });
});
