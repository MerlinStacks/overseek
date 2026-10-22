import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ token: 't', user: { id: 'u' } }) }));
vi.mock('../../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: { id: 'a' } }) }));
import VisitorProfileModal from './VisitorProfileModal';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const observation = (id: string) => ({ session: { id: 's', visitorId: id, lastActiveAt: '2026-01-01T00:00:00.000Z' }, stats: { totalEvents: 0 } });
it('does not fetch a mismatched account and does not use localStorage authority', () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    render(<VisitorProfileModal accountId="other" visitorId="v" onClose={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent('matching account'); expect(fetch).not.toHaveBeenCalled();
});
it('encodes identity, abandons stale requests and never invents direct/desktop/purchase completion', async () => {
    let resolve!: (value: Response) => void;
    const fetch = vi.fn().mockImplementationOnce(() => new Promise(r => { resolve = r; })).mockResolvedValueOnce(new Response(JSON.stringify(observation('new')))); vi.stubGlobal('fetch', fetch);
    const view = render(<VisitorProfileModal accountId="a" visitorId="old/id" onClose={vi.fn()} />);
    expect(fetch.mock.calls[0][0]).toContain('old%2Fid');
    view.rerender(<VisitorProfileModal accountId="a" visitorId="new" onClose={vi.fn()} />);
    await screen.findByText(/Visitor new/);
    await act(async () => resolve(new Response(JSON.stringify(observation('old/id')))));
    expect(screen.queryByText(/Visitor old/)).not.toBeInTheDocument();
    expect(screen.getByText(/not inferred as direct/)).toBeInTheDocument();
});
