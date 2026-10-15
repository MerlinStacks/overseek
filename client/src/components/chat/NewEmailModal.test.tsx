import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NewEmailModal } from './NewEmailModal';

vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ token: 'token', user: {} }) }));
vi.mock('../../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: { id: 'account-1' } }) }));
vi.mock('../../utils/logger', () => ({ Logger: { error: vi.fn() } }));
vi.mock('../../hooks/useCannedResponses', () => ({
    useCannedResponses: () => ({ cannedResponses: [], filteredCanned: [], showCanned: false, handleInputForCanned: vi.fn() })
}));
vi.mock('./InboxRichTextEditor', () => ({
    InboxRichTextEditor: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
        <textarea aria-label="Message" value={value} onChange={event => onChange(event.target.value)} />
    )
}));

describe('NewEmailModal SMS', () => {
    afterEach(() => {
        cleanup();
        vi.unstubAllGlobals();
    });

    it('offers SMS without credentials or email accounts and sends through compose-sms', async () => {
        const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (url) => new Response(
            JSON.stringify(url === '/api/sms/capabilities' ? { canSendSms: true } : [])
        ));
        vi.stubGlobal('fetch', fetchMock);
        const send = vi.fn();
        const open = vi.fn();
        vi.stubGlobal('XMLHttpRequest', class {
            upload = {};
            status = 200;
            responseText = JSON.stringify({ conversationId: 'sms-1' });
            onload?: () => void;
            open = open;
            setRequestHeader = vi.fn();
            send(data: FormData) { send(data); this.onload?.(); }
        });
        const onSent = vi.fn();
        render(<NewEmailModal onClose={vi.fn()} onSent={onSent} />);

        await screen.findByRole('option', { name: 'SMS' });
        fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'SMS' } });
        expect(screen.getByText('New SMS')).toBeInTheDocument();
        fireEvent.change(screen.getByPlaceholderText('+61400111222'), { target: { value: '+61400111222' } });
        fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Hello via SMS' } });
        fireEvent.click(screen.getByRole('button', { name: 'Send' }));

        await waitFor(() => expect(onSent).toHaveBeenCalledWith('sms-1'));
        expect(open).toHaveBeenCalledWith('POST', '/api/chat/compose-sms');
        expect(send.mock.calls[0][0].get('body')).toBe('Hello via SMS');
        expect(send.mock.calls[0][0].get('to')).toBe('+61400111222');
        expect(fetchMock).not.toHaveBeenCalledWith('/api/sms/settings', expect.anything());
    });

    it.each([false, undefined])('does not offer SMS when availability is %s', async (canSendSms) => {
        vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockImplementation(async (url) => new Response(
            JSON.stringify(url === '/api/sms/capabilities' ? { canSendSms } : [])
        )));
        render(<NewEmailModal onClose={vi.fn()} onSent={vi.fn()} />);
        await waitFor(() => expect(screen.getByText('No email accounts configured')).toBeInTheDocument());
        expect(screen.queryByRole('option', { name: 'SMS' })).not.toBeInTheDocument();
    });
});
