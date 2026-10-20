import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ account: { id: 'a' }, fetch: vi.fn() }));
vi.mock('../../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: m.account }) }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ token: 'token' }) }));
import { MacrosDropdown } from './MacrosDropdown';
beforeEach(() => { vi.resetAllMocks(); m.account = { id: 'a' }; vi.stubGlobal('fetch', m.fetch); m.fetch.mockResolvedValue({ ok: true, json: async () => [{ id: 'macro', name: 'Resolve', actions: [] }] }); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe('macro execution safeguards', () => {
    it('guards duplicate execution and surfaces HTTP errors', async () => {
        render(<MacrosDropdown conversationId="conversation" />); fireEvent.click(screen.getByRole('button', { name: 'Quick actions' })); const button = await screen.findByRole('button', { name: /Resolve\s*0 actions/ });
        let resolve!: (value: unknown) => void; m.fetch.mockReturnValueOnce(new Promise(r => { resolve = r; })); fireEvent.click(button); fireEvent.click(button);
        expect(m.fetch.mock.calls.filter(([, options]) => options.method === 'POST')).toHaveLength(1); await act(async () => { resolve({ ok: false }); }); expect(screen.getByRole('alert')).toHaveTextContent('Could not complete');
    });
    it('does not apply late execution callbacks after changing conversations', async () => {
        const executed = vi.fn(); const view = render(<MacrosDropdown conversationId="first" onExecuted={executed} />); fireEvent.click(screen.getByRole('button', { name: 'Quick actions' })); await screen.findByRole('button', { name: /Resolve\s*0 actions/ });
        let resolve!: (value: unknown) => void; m.fetch.mockReturnValueOnce(new Promise(r => { resolve = r; })); fireEvent.click(screen.getByRole('button', { name: /Resolve\s*0 actions/ })); const signal = m.fetch.mock.calls.at(-1)![1].signal;
        view.rerender(<MacrosDropdown conversationId="second" onExecuted={executed} />); await act(async () => { resolve({ ok: true }); }); expect(signal.aborted).toBe(true); expect(executed).not.toHaveBeenCalled();
    });
});
