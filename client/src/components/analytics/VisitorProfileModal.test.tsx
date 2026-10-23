import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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

const event = (id: string, type = 'pageview', minute = '00') => ({ id, type, createdAt: `2026-10-23T01:${minute}:00.000Z`, pageTitle: `Page ${id}`, url: 'https://shop.example.test/product' });
const profile = () => ({
    session: { id: 's', visitorId: 'v', lastActiveAt: '2026-10-23T02:00:00.000Z', city: 'Melbourne', country: 'AU', deviceType: 'desktop', browser: 'Chrome' },
    stats: { totalEvents: 20, totalVisits: 3 },
    visits: [
        { id: 'older', visitNumber: 2, startedAt: '2026-10-22T01:00:00.000Z', endedAt: '2026-10-22T01:05:00.000Z', events: [{ ...event('old'), createdAt: '2026-10-22T01:00:00.000Z' }] },
        { id: 'latest', visitNumber: 3, startedAt: '2026-10-23T01:00:00.000Z', endedAt: '2026-10-23T01:05:00.000Z', events: [event('second', 'product_view', '02'), event('first')] },
    ],
});
const respond = (value: unknown) => new Response(JSON.stringify(value));

it('restores the profile summary and opens the latest visit with a chronological timeline', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond(profile())));
    render(<VisitorProfileModal accountId="a" visitorId="v" onClose={vi.fn()} />);
    await screen.findByRole('heading', { name: 'Anonymous visitor' });
    expect(screen.getByRole('dialog', { name: 'Visitor profile' })).toBeInTheDocument();
    expect(screen.getByText('Recorded events').nextElementSibling).toHaveTextContent('20');
    expect(screen.getByText('Recorded visits').nextElementSibling).toHaveTextContent('3');
    expect(screen.getByRole('complementary', { name: 'Visitor details' })).toHaveTextContent('Melbourne, AU');
    const history = screen.getByRole('region', { name: 'Visit history' });
    const buttons = within(history).getAllByRole('button');
    expect(buttons[0]).toHaveTextContent('Visit #3');
    expect(buttons[0]).toHaveAttribute('aria-expanded', 'true');
    expect(buttons[1]).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Page old')).toBeNull();
    const timeline = screen.getByRole('list', { name: 'Activity timeline' });
    expect(within(timeline).getAllByRole('listitem').map(item => item.textContent)).toEqual([expect.stringContaining('Page first'), expect.stringContaining('Page second')]);
    fireEvent.click(buttons[1]);
    expect(screen.getByText('Page old')).toBeVisible();
    expect(document.getElementById(buttons[1].getAttribute('aria-controls')!)).toBeVisible();
    fireEvent.click(buttons[0]);
    expect(screen.queryByText('Page first')).toBeNull();
});

it('keeps coverage notes collapsed instead of crowding the visitor summary', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond(profile())));
    render(<VisitorProfileModal accountId="a" visitorId="v" onClose={vi.fn()} />);
    await screen.findByText('Anonymous visitor');
    const note = screen.getByText(/Missing sources are not inferred as direct/);
    const details = note.closest('details')!;
    expect(details).not.toHaveAttribute('open');
    fireEvent.click(screen.getByText('About this activity data'));
    expect(details).toHaveAttribute('open');
    expect(screen.queryByText('Direct')).toBeNull();
});

it('preserves unknown visit counts, zero money/quantity and purchase limitations in legacy timelines', async () => {
    const data = observation('v');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond({ ...data, session: { ...data.session, events: [{ ...event('purchase', 'purchase'), payload: { quantity: 0, total: 0, currency: 'AUD', orderId: 42 } }] } })));
    render(<VisitorProfileModal accountId="a" visitorId="v" onClose={vi.fn()} />);
    await screen.findByText('Purchase recorded');
    expect(screen.getByText('Recorded visits').nextElementSibling).toHaveTextContent('—');
    expect(screen.getByText('Quantity: 0')).toBeInTheDocument();
    expect(screen.getByText('Total: AUD 0')).toBeInTheDocument();
    expect(screen.getByText('Payment and completion not verified.')).toBeInTheDocument();
    expect(screen.queryByText('Purchase completed')).toBeNull();
    expect(screen.getByRole('img')).toHaveAccessibleName(/Unknown device.*Unknown browser/);
});

it('does not hide pageviews just because a product-view event has the same URL', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond(profile())));
    render(<VisitorProfileModal accountId="a" visitorId="v" onClose={vi.fn()} />);
    await screen.findByText('Page first');
    expect(screen.getByText('Page second')).toBeInTheDocument();
    expect(screen.getAllByRole('link')).toHaveLength(2);
});

it('never makes unsafe event URLs clickable and does not guess a missing currency', async () => {
    const data = observation('v');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond({ ...data, session: { ...data.session, events: [{ ...event('unsafe'), url: 'javascript:alert(1)', payload: { price: 10 } }] } })));
    render(<VisitorProfileModal accountId="a" visitorId="v" onClose={vi.fn()} />);
    await screen.findByText('Page unsafe');
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('Unit price: Monetary basis unavailable')).toBeInTheDocument();
});

it('provides a scoped retry without presenting a failed request as visitor-not-found', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response('', { status: 503 })).mockResolvedValueOnce(respond(profile()));
    vi.stubGlobal('fetch', fetch);
    render(<VisitorProfileModal accountId="a" visitorId="v" onClose={vi.fn()} />);
    await screen.findByRole('alert');
    expect(screen.queryByText('Visitor not found')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry visitor activity' }));
    await screen.findByText('Melbourne, AU');
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1][1].headers['X-Account-ID']).toBe('a');
});

it('rejects a mismatched visitor response instead of displaying another profile', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond(observation('someone-else'))));
    render(<VisitorProfileModal accountId="a" visitorId="v" onClose={vi.fn()} />);
    await screen.findByRole('alert');
    expect(screen.queryByText(/Visitor someone-else/)).toBeNull();
});
