import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAttachments } from './useAttachments';

vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ token: 'token' }) }));
vi.mock('../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: { id: 'account-1' } }) }));
vi.mock('../utils/logger', () => ({ Logger: { error: vi.fn() } }));

class FailedUploadXhr {
    upload: { onprogress: ((event: ProgressEvent) => void) | null } = { onprogress: null };
    status = 502;
    responseText = JSON.stringify({
        error: 'Delivery to customer failed',
        message: {
            id: 'failed-1',
            content: 'Attachment',
            senderType: 'AGENT',
            createdAt: '2026-08-08T00:00:00Z',
            isInternal: false,
            clientRequestId: 'request-1',
            deliveryStatus: 'FAILED',
            deliveryError: 'Delivery to customer failed',
        },
    });
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onabort: (() => void) | null = null;
    open = vi.fn();
    setRequestHeader = vi.fn();
    send = vi.fn(() => this.onload?.());
    abort = vi.fn(() => this.onabort?.());
}

describe('useAttachments', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('surfaces a persisted failed attachment message through the send handler', async () => {
        vi.stubGlobal('XMLHttpRequest', FailedUploadXhr);
        const onSendMessage = vi.fn().mockResolvedValue(undefined);
        const { result } = renderHook(() => useAttachments({ conversationId: 'conversation-1', onSendMessage }));
        const file = new File(['file'], 'invoice.pdf', { type: 'application/pdf' });

        act(() => result.current.handleFileUpload({ target: { files: [file], value: '' } } as unknown as React.ChangeEvent<HTMLInputElement>));
        await act(async () => {
            await expect(result.current.sendMessageWithAttachments('Attachment', 'AGENT', false, 'EMAIL', undefined, 'request-1')).rejects.toThrow('Delivery to customer failed');
        });

        await waitFor(() => expect(onSendMessage).toHaveBeenCalledWith(
            'Attachment', 'AGENT', false, 'EMAIL', undefined, 'request-1',
            expect.objectContaining({ id: 'failed-1', deliveryStatus: 'FAILED' }),
        ));
        await waitFor(() => expect(result.current.attachmentError).toBe('Delivery to customer failed'));
        expect(result.current.stagedAttachments).toHaveLength(1);
    });
});
