import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { EmailLogsPage } from './EmailLogsPage';
import { SmsLogsPage } from './SmsLogsPage';

const mocks = vi.hoisted(() => ({ emailEnabled: true, fetch: vi.fn(), account: { id: 'account' } }));
vi.mock('../hooks/useAccountFeature', () => ({ useAccountFeature: () => mocks.emailEnabled }));
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ token: 'token' }) }));
vi.mock('../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: mocks.account }) }));
vi.mock('../context/ToastContext', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
function Location() { const location = useLocation(); return <output aria-label="Current URL">{location.pathname}{location.search}</output>; }
function renderPage(url = '/emails/logs') {
    return render(<MemoryRouter initialEntries={[url]}><Location /><Routes><Route path="/emails/logs" element={<EmailLogsPage />} /><Route path="/sms/logs" element={<SmsLogsPage />} /></Routes></MemoryRouter>);
}
beforeEach(() => {
    mocks.account = { id: 'account' };
    mocks.emailEnabled = true; mocks.fetch.mockReset();
    mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ logs: [], total: 0 }) });
    vi.stubGlobal('fetch', mocks.fetch);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('message logs', () => {
    it('defaults to one combined chronological timeline', async () => {
        renderPage();
        expect(screen.getByRole('button', { name: 'BOTH' })).toHaveAttribute('aria-pressed', 'true');
        expect(await screen.findByText('No matching messages.')).toBeInTheDocument();
        expect(mocks.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/messages/logs?channel=both'), expect.anything());
    });
    it('switches channels while retaining common filters', async () => {
        renderPage('/emails/logs?status=FAILED');
        await screen.findByText('No matching messages.');
        for (const channel of ['EMAIL', 'SMS', 'BOTH']) {
            fireEvent.click(screen.getByRole('button', { name: channel }));
            await screen.findByText('No matching messages.');
            expect(screen.getByRole('combobox', { name: 'Status' })).toHaveValue('FAILED');
            expect(mocks.fetch.mock.lastCall?.[0]).toContain(`channel=${channel.toLowerCase()}`);
        }
    });
    it('updates shared source filters and clears them without resetting the channel', async () => {
        renderPage('/emails/logs?channel=email&status=FAILED');
        await screen.findByText('No matching messages.');
        fireEvent.change(screen.getByRole('combobox', { name: 'Type' }), { target: { value: 'MANUAL' } });
        await screen.findByText('No matching messages.');
        expect(screen.getByLabelText('Current URL')).toHaveTextContent('channel=email&status=FAILED&source=MANUAL');
        fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
        await screen.findByText('No matching messages.');
        expect(screen.getByLabelText('Current URL')).toHaveTextContent('/emails/logs?channel=email');
    });
    it('redirects legacy SMS links', async () => {
        renderPage('/sms/logs');
        await screen.findByText('No matching messages.');
        expect(screen.getByLabelText('Current URL')).toHaveTextContent('/emails/logs?channel=sms');
    });
    it('requests only SMS when email is disabled', async () => {
        mocks.emailEnabled = false; renderPage('/emails/logs?channel=email');
        await screen.findByText('No matching messages.');
        expect(screen.getByRole('button', { name: 'EMAIL' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'BOTH' })).toBeDisabled();
        expect(mocks.fetch.mock.calls.every(([url]) => String(url).includes('channel=sms'))).toBe(true);
    });
    it('does not present failed reads as an empty successful list', async () => {
        mocks.fetch.mockResolvedValue({ ok: false, json: async () => ({ error: 'Read failed' }) });
        renderPage(); expect(await screen.findByRole('alert')).toHaveTextContent('Read failed');
        expect(screen.queryByText('No matching messages.')).not.toBeInTheDocument();
    });
    it('aborts a previous account read and does not show its late messages', async () => {
        let resolve!: (value: unknown) => void;
        mocks.fetch.mockReturnValueOnce(new Promise(done => { resolve = done; }));
        const view = renderPage();
        await waitFor(() => expect(mocks.fetch).toHaveBeenCalled());
        const signal = mocks.fetch.mock.calls[0][1].signal;
        mocks.account = { id: 'next-account' }; view.rerender(<MemoryRouter><EmailLogsPage /></MemoryRouter>);
        await screen.findByText('No matching messages.'); expect(signal.aborted).toBe(true);
        resolve({ ok: true, json: async () => ({ logs: [{ id: 'late', to: 'private@example.com' }], total: 1 }) });
        expect(screen.queryByText('private@example.com')).not.toBeInTheDocument();
    });
});
