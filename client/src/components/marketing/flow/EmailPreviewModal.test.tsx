import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EmailPreviewModal } from './EmailPreviewModal';

vi.mock('../../../context/AuthContext', () => ({ useAuth: () => ({ token: 'token' }) }));
vi.mock('../../../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: { id: 'account' } }) }));
afterEach(() => vi.unstubAllGlobals());

describe('flow email preview', () => {
    it('renders resolved HTML and pins the same order for a test email', async () => {
        const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ html: '<p>Hello Emily</p><table><tr><td>Mug</td></tr></table>', subject: 'Hi Emily', orderId: 'selected-order' }) }).mockResolvedValueOnce({ ok: true });
        vi.stubGlobal('fetch', fetchMock);
        const onPreviewed = vi.fn();
        render(<EmailPreviewModal htmlContent="<p>Hello {{customer.firstName}}</p>{{cart.itemsTable}}" subject="Hi {{customer.firstName}}" onClose={vi.fn()} onPreviewed={onPreviewed} />);
        const iframe = await screen.findByTitle('Email Preview');
        expect(iframe.getAttribute('srcdoc')).toContain('Hello Emily');
        expect(iframe.getAttribute('srcdoc')).not.toContain('{{');
        expect(screen.getByText('Hi Emily')).toBeInTheDocument();
        fireEvent.load(iframe);
        expect(onPreviewed).toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Send Test' }));
        fireEvent.change(screen.getByPlaceholderText('your@email.com'), { target: { value: 'test@example.com' } });
        fireEvent.click(screen.getByRole('button', { name: 'Send Test Email' }));
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
        expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ orderId: 'selected-order', content: expect.stringContaining('{{cart.itemsTable}}') });
    });

    it('shows preview failures without marking the email as checked', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'Preview failed' }) }));
        const onPreviewed = vi.fn();
        render(<EmailPreviewModal htmlContent="<p>Content</p>" onClose={vi.fn()} onPreviewed={onPreviewed} />);
        expect(await screen.findByRole('alert')).toHaveTextContent('Preview failed');
        expect(onPreviewed).not.toHaveBeenCalled();
    });
});
