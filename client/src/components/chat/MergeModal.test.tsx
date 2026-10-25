import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MergeModal } from './MergeModal';

vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ token: 'token' }) }));
vi.mock('../../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: { id: 'account-1' } }) }));
vi.mock('../../utils/logger', () => ({ Logger: { error: vi.fn() } }));

describe('MergeModal', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('parses the paginated list response and merges the selected source into the current target', async () => {
        vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
            conversations: [{
                id: 'source-1',
                status: 'OPEN',
                guestName: 'Source Customer',
                createdAt: '2026-08-07T00:00:00Z',
                updatedAt: '2026-08-07T00:00:00Z',
                messages: [{ content: 'Source message' }],
            }],
        }), { status: 200 })));
        const onMerge = vi.fn().mockResolvedValue(undefined);

        render(<MergeModal
            isOpen
            onClose={vi.fn()}
            onMerge={onMerge}
            currentConversationId="target-1"
        />);

        const customer = await screen.findByText('Source Customer');
        fireEvent.click(customer.closest('button')!);

        await waitFor(() => expect(onMerge).toHaveBeenCalledWith('source-1'));
        expect(screen.getByText('Messages from the selected conversation will be merged into the current one')).toBeInTheDocument();
    });

    it('keeps the dialog open and shows a rejected merge', async () => {
        vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(JSON.stringify({ conversations: [{
            id: 'source', guestName: 'Source', status: 'OPEN', updatedAt: '2026-08-07T00:00:00Z',
        }] }))));
        const close = vi.fn();
        render(<MergeModal isOpen onClose={close} onMerge={vi.fn().mockRejectedValue(new Error('403'))} currentConversationId="target" />);
        fireEvent.click((await screen.findByText('Source')).closest('button')!);
        expect(await screen.findByRole('alert')).toHaveTextContent('Could not confirm merge');
        expect(close).not.toHaveBeenCalled();
    });
});
