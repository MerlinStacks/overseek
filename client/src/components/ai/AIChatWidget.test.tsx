import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ account: { id: 'a' }, fetch: vi.fn() }));
vi.mock('../../context/AccountContext', async () => {
    const React = await import('react');
    const Context = React.createContext({ currentAccount: m.account });
    return { AccountProvider: Context.Provider, useAccount: () => React.useContext(Context) };
});
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ token: 'token' }) }));
import { AIChatWidget } from './AIChatWidget';
import { AccountProvider } from '../../context/AccountContext';
function Page() { return <MemoryRouter><AccountProvider {...{ value: { currentAccount: m.account } }}><AIChatWidget /></AccountProvider></MemoryRouter>; }
beforeEach(() => { vi.resetAllMocks(); m.account = { id: 'a' }; vi.stubGlobal('fetch', m.fetch); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
describe('AI widget account isolation', () => {
    it('aborts a timed-out request and restores its question', async () => {
        vi.useFakeTimers();
        m.fetch.mockImplementation((_url, { signal }) => new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        }));
        render(<Page />); fireEvent.click(screen.getByRole('button', { name: 'Open store analyst' }));
        fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Timed question' } });
        fireEvent.click(screen.getByRole('button', { name: 'Send question' }));
        await act(async () => { vi.advanceTimersByTime(60000); });
        expect(m.fetch.mock.calls[0][1].signal.aborted).toBe(true);
        expect(screen.getByRole('alert')).toHaveTextContent('timed out');
        expect(screen.getByRole('textbox')).toHaveValue('Timed question');
        expect(screen.getByRole('textbox')).not.toBeDisabled();
    });
    it('aborts old requests and hides private messages when changing accounts', async () => {
        let resolve!: (value: unknown) => void; m.fetch.mockReturnValueOnce(new Promise(r => { resolve = r; }));
        const view = render(<Page />); fireEvent.click(screen.getByRole('button', { name: 'Open store analyst' }));
        fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Private question' } }); fireEvent.click(screen.getByRole('button', { name: 'Send question' }));
        const signal = m.fetch.mock.calls[0][1].signal;
        m.account = { id: 'b' }; view.rerender(<Page />); expect(signal.aborted).toBe(true);
        await act(async () => { resolve({ ok: true, json: async () => ({ reply: 'Private reply' }) }); });
        fireEvent.click(screen.getByRole('button', { name: 'Open store analyst' })); expect(screen.queryByText('Private question')).toBeNull(); expect(screen.queryByText('Private reply')).toBeNull();
    });
    it('guards duplicate submits and restores a failed question for retry', async () => {
        let resolve!: (value: unknown) => void; m.fetch.mockReturnValueOnce(new Promise(r => { resolve = r; }));
        render(<Page />); fireEvent.click(screen.getByRole('button', { name: 'Open store analyst' })); const input = screen.getByRole('textbox'); fireEvent.change(input, { target: { value: 'Question' } });
        const form = input.closest('form')!; fireEvent.submit(form); fireEvent.submit(form); expect(m.fetch).toHaveBeenCalledOnce();
        await act(async () => { resolve({ ok: false, json: async () => ({ error: 'Failed' }) }); }); expect(screen.getByRole('alert')).toBeInTheDocument(); expect(input).toHaveValue('Question');
    });
    it('handles malformed AI output as an error instead of rendering it', async () => {
        m.fetch.mockResolvedValue({ ok: true, json: async () => ({ reply: {} }) }); render(<Page />); fireEvent.click(screen.getByRole('button', { name: 'Open store analyst' }));
        fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Question' } }); fireEvent.click(screen.getByRole('button', { name: 'Send question' })); await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    });
});
