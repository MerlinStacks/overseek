import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ account: { id: 'a' }, allowed: true, canManage: true, fetch: vi.fn() }));
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ token: 't', user: { id: 'u' } }) }));
vi.mock('../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: m.account }) }));
vi.mock('../hooks/usePermissions', () => ({ usePermissions: () => ({ hasPermission: (permission: string) => permission === 'manage_marketing' ? m.canManage : m.allowed }) }));
import { AiManagerPage } from './AiManagerPage';
const item = { id: 'x', title: 'Review local content', text: 'Observe', type: 'SEO', source: 'LOCAL', priority: 3, confidence: null, status: 'pending', version: '2026-10-01T00:00:00.000Z', dataPoints: [] };
const response = (value: unknown) => ({ ok: true, json: async () => value });
beforeEach(() => { vi.clearAllMocks(); m.allowed = true; m.canManage = true; m.account = { id: 'a' }; vi.stubGlobal('fetch', m.fetch); m.fetch.mockImplementation(async (url: string) => response(url.endsWith('/health') ? { configured: { searchConsole: 0, googleAds: 1, metaAds: 0 }, providerHealth: 'unverified' } : { items: [item], coverage: { truncated: false, limit: 60 } })); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('separates configured records from health and requires versioned acknowledgements', async () => { render(<AiManagerPage />); await screen.findByText('Review local content'); expect(screen.getByText(/Not a connection-health check/)).toBeInTheDocument(); expect(screen.getByText(/confidence unavailable/)).toBeInTheDocument(); m.fetch.mockResolvedValueOnce({ ok: false, json: async () => ({}) }); fireEvent.click(screen.getByRole('button', { name: 'Dismiss' })); expect(await screen.findByRole('alert')).toHaveTextContent('reconcile'); const write = m.fetch.mock.calls.find(([, options]) => options.method === 'POST'); expect(JSON.parse(write?.[1].body)).toEqual({ status: 'dismissed', version: item.version }); expect(screen.getByRole('button', { name: 'Dismiss' })).toBeDisabled(); });
it('discards late old-account suggestions and hides reads on permission loss', async () => { let resolve!: (value: unknown) => void; m.fetch.mockReturnValueOnce(new Promise(r => { resolve = r; })); const view = render(<AiManagerPage />); await act(async () => {}); m.account = { id: 'b' }; view.rerender(<AiManagerPage />); await screen.findByText('Review local content'); await act(async () => resolve(response({ items: [{ ...item, title: 'Old account' }], coverage: { truncated: false, limit: 60 } }))); expect(screen.queryByText('Old account')).not.toBeInTheDocument(); m.allowed = false; view.rerender(<AiManagerPage />); expect(screen.queryByText('Review local content')).not.toBeInTheDocument(); });

const configured = { configured: { searchConsole: 0, googleAds: 1, metaAds: 2 }, providerHealth: 'unverified' };
const sample = [
    { ...item, id: 'priority', title: 'Priority recommendation', priority: 1, dataPoints: ['Observed signal'] },
    { ...item, id: 'pending', title: 'Pending recommendation' },
    { ...item, id: 'done', title: 'Recorded implementation', status: 'implemented', priority: 2 },
];

it('restores summary cards, configured-source panels and suggestion-card hierarchy without claiming provider health', async () => {
    m.fetch.mockImplementation(async (url: string) => response(url.endsWith('/health') ? configured : { items: sample, coverage: { truncated: true, limit: 60 } }));
    render(<AiManagerPage />);
    await screen.findByRole('heading', { name: 'Priority recommendation' });
    for (const [label, count] of [['Suggestions in view', '3'], ['Pending in view', '2'], ['High priority pending in view', '1'], ['Marked implemented in view', '1']]) {
        expect(screen.getByText(label).nextElementSibling).toHaveTextContent(count);
    }
    const sources = screen.getByRole('region', { name: 'Configured sources' });
    expect(within(sources).getByText('1 configured record')).toBeInTheDocument();
    expect(within(sources).getByText('2 configured records')).toBeInTheDocument();
    expect(screen.queryByText(/^Connected$|Healthy|confidence \d+%/)).toBeNull();
    const card = screen.getByRole('heading', { name: 'Priority recommendation' }).closest('article')!;
    expect(card).toHaveClass('border-t-red-400');
    expect(within(card).getByText('Observed signal')).toBeInTheDocument();
    expect(screen.getByText(/3 shown; more records exist/)).toHaveTextContent('Counts refer only to this view');
    expect(screen.getByText('How these suggestions work').closest('details')).not.toHaveAttribute('open');
    screen.getAllByRole('button').forEach(button => expect(button).toHaveAttribute('type', 'button'));
    expect(m.fetch.mock.calls.every(([, options]) => !options.method || options.method === 'GET')).toBe(true);
});

it('does not turn a failed suggestion read into zero counts or a no-suggestions claim', async () => {
    m.fetch.mockImplementation(async (url: string) => url.endsWith('/health') ? response(configured) : { ok: false });
    render(<AiManagerPage />);
    await screen.findByRole('button', { name: 'Retry suggestions' });
    expect(screen.getByText('Suggestions in view').nextElementSibling).toHaveTextContent('—');
    expect(screen.queryByText('No suggestions in this view.')).toBeNull();
    m.fetch.mockImplementation(async (url: string) => response(url.endsWith('/health') ? configured : { items: [], coverage: { truncated: false, limit: 60 } }));
    fireEvent.click(screen.getByRole('button', { name: 'Retry suggestions' }));
    await screen.findByText('No suggestions in this view.');
    expect(screen.getByText('Suggestions in view').nextElementSibling).toHaveTextContent('0');
});

it('keeps missing source configuration distinct from disconnected sources', async () => {
    m.fetch.mockImplementation(async (url: string) => url.endsWith('/health') ? { ok: false } : response({ items: [item], coverage: { truncated: false, limit: 60 } }));
    render(<AiManagerPage />);
    await screen.findByRole('button', { name: 'Retry sources' });
    expect(screen.queryByText(/0 configured records/)).toBeNull();
    expect(screen.getByText('Review local content')).toBeInTheDocument();
    expect(screen.queryByText(/Not Connected/)).toBeNull();
});

it('allows read-only users to filter without exposing mutation controls', async () => {
    m.canManage = false;
    render(<AiManagerPage />);
    await screen.findByText('Review local content');
    expect(screen.queryByRole('button', { name: /Refresh Suggestions/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Mark implemented/ })).toBeNull();
    fireEvent.change(screen.getByRole('combobox', { name: 'Status' }), { target: { value: 'expired' } });
    await waitFor(() => expect(m.fetch.mock.calls.some(([url]) => url.includes('status=expired'))).toBe(true));
    expect(m.fetch.mock.calls.every(([, options]) => !options.method || options.method === 'GET')).toBe(true);
});

it('serializes versioned self-reported status changes and disables other mutation buttons while pending', async () => {
    render(<AiManagerPage />);
    await screen.findByText('Review local content');
    let resolve!: (value: unknown) => void;
    m.fetch.mockReturnValueOnce(new Promise(r => { resolve = r; }));
    const mark = screen.getByRole('button', { name: 'Mark implemented (self-reported)' });
    fireEvent.click(mark);
    fireEvent.click(mark);
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Refresh Suggestions/ })).toBeDisabled();
    const writes = m.fetch.mock.calls.filter(([, options]) => options.method === 'POST');
    expect(writes).toHaveLength(1);
    expect(writes[0][0]).toBe('/api/ai-manager/suggestions/x/status');
    expect(JSON.parse(writes[0][1].body)).toEqual({ status: 'implemented', version: item.version });
    await act(async () => resolve(response({ success: true, version: '2026-10-02T00:00:00.000Z' })));
    await waitFor(() => expect(mark).toBeEnabled());
});

it('only refreshes recommendations on an explicit management action with an occurrence identity', async () => {
    render(<AiManagerPage />);
    await screen.findByText('Review local content');
    expect(m.fetch.mock.calls.some(([, options]) => options.method === 'POST')).toBe(false);
    m.fetch.mockResolvedValueOnce(response({ created: 0 }));
    fireEvent.click(screen.getByRole('button', { name: /Refresh Suggestions/ }));
    await waitFor(() => expect(m.fetch.mock.calls.some(([url]) => url.endsWith('/suggestions/refresh'))).toBe(true));
    const write = m.fetch.mock.calls.find(([, options]) => options.method === 'POST')!;
    expect(write[1].headers['X-Account-ID']).toBe('a');
    expect(JSON.parse(write[1].body).occurrence).toMatch(/^[0-9a-f-]{36}$/);
});
