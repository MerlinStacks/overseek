import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ account: { id: 'a', aiModel: 'google/gemini-2.5-flash' }, fetch: vi.fn(), refresh: vi.fn(), toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ token: 'token' }) }));
vi.mock('../../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: m.account, refreshAccounts: m.refresh }) }));
vi.mock('../../context/ToastContext', () => ({ useToast: () => m.toast }));
import { AISettings } from './AISettings';
beforeEach(() => {
    vi.clearAllMocks(); vi.stubGlobal('fetch', m.fetch);
    m.account = { id: 'a', aiModel: 'google/gemini-2.5-flash' };
    m.fetch.mockImplementation(async (url: string) => ({ ok: true, json: async () => url === '/api/ai/models' ? [{ id: 'google/gemini-2.5-flash', name: 'Gemini' }] : {} }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('saves a provider-declared model outside the former three-model list', async () => {
    render(<AISettings />);
    await waitFor(() => expect(screen.getByDisplayValue('Gemini')).toBeInTheDocument());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save AI Settings' }));
    await waitFor(() => expect(m.refresh).toHaveBeenCalledOnce());
    expect(JSON.parse(m.fetch.mock.calls.find(([, options]) => options.method === 'PUT')![1].body).aiModel).toBe('google/gemini-2.5-flash');
});
it('explains unavailable saved models instead of silently saving unusable configuration', async () => {
    m.fetch.mockResolvedValue({ ok: true, json: async () => [{ id: 'openai/gpt-4o', name: 'GPT-4o' }] });
    render(<AISettings />);
    expect(await screen.findByRole('alert')).toHaveTextContent('not in the current tool-capable catalog');
    expect(screen.getByRole('button', { name: 'Save AI Settings' })).toBeDisabled();
    expect(m.fetch.mock.calls.some(([, options]) => options.method === 'PUT')).toBe(false);
});
it('keeps catalog failures distinct from a successful empty capability list', async () => {
    m.fetch.mockResolvedValue({ ok: false }); render(<AISettings />);
    expect(await screen.findByRole('alert')).toHaveTextContent('availability could not be checked');
    expect(screen.queryByText(/not in the current tool-capable catalog/)).not.toBeInTheDocument();
});
