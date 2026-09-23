import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeliverySyncInputs } from './DeliverySyncInputs';
import { DeliverySyncPanel } from './DeliverySyncPanel';
import type { DeliverySyncInput } from '../../../hooks/useDeliverySyncInputs';

const fetchMock = vi.fn();
const props = { accountId: 'account-a', token: 'token-a', canEdit: true, disabled: false, onRetry: vi.fn() };
const item = (overrides: Partial<DeliverySyncInput> = {}): DeliverySyncInput => ({
    id: 'immutable/a', scope: 'product', entityId: 123, status: 'blocked', desiredRevision: '9007199254740993', ackRevision: '2',
    attempts: 3, proofRebuilds: 1, lastAcknowledgedAt: null, updatedAt: '2026-09-23T00:00:00Z', diagnostic: null,
    payloadSummary: { envelopeBytes: 12, isTombstone: false, variationCount: 0, targetCount: null, generatedAt: null, expiresAt: null, expiredAtObservation: false }, ...overrides,
});
const response = (data: unknown, status = 200) => ({ ok: status === 200, status, json: async () => data });
const page = (items = [item()], nextCursor: string | null = null) => response({ schemaVersion: 1, observedAt: 'now', items, nextCursor });
const open = () => fireEvent.click(screen.getByRole('button', { name: 'View blocked inputs' }));
const retry = () => screen.getAllByRole('button', { name: 'Retry this input' })[0];

describe('On-demand input diagnostics', () => {
    beforeEach(() => { fetchMock.mockReset().mockResolvedValue(page()); props.onRetry.mockReset(); vi.stubGlobal('fetch', fetchMock); });
    afterEach(() => vi.unstubAllGlobals());

    it('does not fetch until opened and shows legacy null reasons without guessing auth', async () => {
        render(<DeliverySyncInputs {...props} />);
        expect(fetchMock).not.toHaveBeenCalled(); open();
        await screen.findByText('Reason not captured for this input.');
        expect(screen.getByText(/Desired revision/)).toHaveTextContent('9007199254740993');
        expect(screen.queryByText(/authentication/i)).not.toBeInTheDocument();
        expect(fetchMock).toHaveBeenCalledWith('/api/delivery-estimates/sync/inputs?status=attention&limit=25', expect.objectContaining({ method: 'GET', headers: { Authorization: 'Bearer token-a', 'X-Account-ID': 'account-a' } }));
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('renders scopes, escaped remote diagnostics, account suppression and expired tombstones', async () => {
        const unsafe = '<img src=x onerror=alert(1)>';
        fetchMock.mockResolvedValue(page([item({ scope: 'settings', diagnostic: { source: 'remote', phase: 'capabilities', disposition: 'account_suppression', attemptedRevision: '3', occurredAt: 'now', httpStatus: 422, code: unsafe, reason: unsafe, message: unsafe } }), item({ id: 'inbound', scope: 'inbound', status: 'plugin_update_required', payloadSummary: { ...item().payloadSummary, expiredAtObservation: true, isTombstone: true } }), item({ id: 'product' })]));
        render(<DeliverySyncInputs {...props} />); open();
        await screen.findByText('Settings', { selector: 'h4' });
        expect(screen.getByText(/Inbound · WooCommerce product ID: 123/)).toBeInTheDocument();
        expect(screen.getByText(/Product · WooCommerce product ID: 123/)).toBeInTheDocument();
        expect(screen.getByText(/Account-suppressed/)).toHaveTextContent('not an independent input failure');
        expect(screen.getByText(/Source: remote/)).toHaveTextContent('Phase: capabilities · Attempted revision: 3');
        expect(screen.getByText(/Tombstone —/)).toHaveTextContent('Payload expired at observation');
        expect(screen.getByText(/Update the WooCommerce companion/)).toBeInTheDocument();
        expect(document.querySelector('img')).toBeNull();
        expect(document.querySelector('a')).toBeNull();
        expect(screen.getByText(unsafe)).toBeInTheDocument();
    });

    it.each([{ canEdit: false }, { disabled: true }])('guards retries with %o', async overrides => {
        render(<DeliverySyncInputs {...props} {...overrides} />); open();
        await screen.findByText(/Reason not captured/);
        const button = screen.queryByRole('button', { name: 'Retry this input' });
        if (button) { expect(button).toBeDisabled(); fireEvent.click(button); }
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it.each(['pending', 'synced', 'not_requested', 'unknown'])('never retries wrong state %s', async status => {
        fetchMock.mockResolvedValue(page([item({ status })]));
        render(<DeliverySyncInputs {...props} />); open(); await screen.findByText(/Reason not captured/);
        expect(screen.queryByRole('button', { name: 'Retry this input' })).toBeNull();
    });

    it.each([403, 404, 500])('handles GET %s explicitly without any fallback write', async status => {
        fetchMock.mockResolvedValueOnce(response(null, status));
        render(<DeliverySyncInputs {...props} />); open();
        expect(await screen.findByRole('alert')).toHaveTextContent(status === 404 ? 'Diagnostics unavailable' : status === 403 ? 'Permission denied' : 'HTTP 500');
        expect(fetchMock).toHaveBeenCalledTimes(1);
        fireEvent.click(screen.getByRole('button', { name: 'Refresh input diagnostics' }));
        await screen.findByText(/Reason not captured/);
        expect(fetchMock.mock.calls.every(([, options]) => options.method === 'GET')).toBe(true);
    });

    it('paginates opaque cursors and resets pagination for filters', async () => {
        fetchMock.mockResolvedValueOnce(page([item()], 'opaque+/='));
        render(<DeliverySyncInputs {...props} />); open(); await screen.findByText(/Reason not captured/);
        fetchMock.mockResolvedValueOnce(page([item({ id: 'second', entityId: 456 })]));
        fireEvent.click(screen.getByRole('button', { name: 'Next inputs' }));
        await screen.findByText(/product ID: 456/);
        expect(fetchMock.mock.calls[1][0]).toContain('cursor=opaque%2B%2F%3D');
        fireEvent.click(screen.getByRole('button', { name: 'Previous inputs' }));
        await screen.findByText(/product ID: 123/);
        fireEvent.change(screen.getByLabelText('Scope'), { target: { value: 'inbound' } });
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
        expect(fetchMock.mock.calls[3][0]).toBe('/api/delivery-estimates/sync/inputs?status=attention&limit=25&scope=inbound');
        fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'failed' } });
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));
        expect(fetchMock.mock.calls[4][0]).toContain('status=failed');
        expect(screen.getByRole('button', { name: 'Previous inputs' })).toBeDisabled();
    });

    it.each(['queued', 'rebuilding', 'already_running'])('retries only the immutable ID and refreshes GET-only for %s', async disposition => {
        fetchMock.mockResolvedValue(page([item(), item({ id: 'other' })]));
        render(<DeliverySyncInputs {...props} />); open(); await screen.findAllByText(/Reason not captured/);
        let finish!: (value: unknown) => void;
        fetchMock.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
        fireEvent.click(retry()); fireEvent.click(retry());
        expect(retry()).toBeDisabled();
        expect(fetchMock).toHaveBeenCalledTimes(2);
        const [url, options] = fetchMock.mock.calls[1];
        expect(url).toBe('/api/delivery-estimates/sync/inputs/immutable%2Fa/retry');
        expect(options.method).toBe('POST'); expect(options).not.toHaveProperty('body');
        await act(async () => finish(response({ accepted: true, disposition, inputId: 'immutable/a' })));
        await screen.findByText(/Completion is not confirmed/);
        expect(props.onRetry).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls.filter(([, options]) => options.method === 'POST')).toHaveLength(1);
        expect(fetchMock.mock.calls[2][1].method).toBe('GET');
    });

    it('reports POST permission errors without reporting acceptance or refreshing counts', async () => {
        render(<DeliverySyncInputs {...props} />); open(); await screen.findByText(/Reason not captured/);
        fetchMock.mockResolvedValueOnce(response(null, 403)); fireEvent.click(retry());
        await screen.findByText(/Permission denied/);
        expect(props.onRetry).not.toHaveBeenCalled(); expect(retry()).toBeEnabled();
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('reports a missing retry input without disabling other rows or falling back to a full sync', async () => {
        fetchMock.mockResolvedValue(page([item(), item({ id: 'other' })]));
        render(<DeliverySyncInputs {...props} />); open(); await screen.findAllByText(/Reason not captured/);
        fetchMock.mockResolvedValueOnce(response(null, 404)); fireEvent.click(retry());
        await screen.findByText(/This input was not found in this account/);
        for (const button of screen.getAllByRole('button', { name: 'Retry this input' })) expect(button).toBeEnabled();
        expect(screen.queryByText(/backend does not support/)).toBeNull();
        expect(props.onRetry).not.toHaveBeenCalled();
        expect(fetchMock).toHaveBeenCalledTimes(2);
        fetchMock.mockResolvedValueOnce(response({ accepted: true, disposition: 'queued', inputId: 'other' }, 200));
        fireEvent.click(screen.getAllByRole('button', { name: 'Retry this input' })[1]);
        await screen.findByText(/Completion is not confirmed/);
        expect(fetchMock.mock.calls.filter(([, options]) => options.method === 'POST').map(([url]) => url)).toEqual([
            '/api/delivery-estimates/sync/inputs/immutable%2Fa/retry', '/api/delivery-estimates/sync/inputs/other/retry',
        ]);
    });

    it.each(['GET', 'retry'] as const)('hides malformed %s response body excerpts', async request => {
        const malformed = { ok: true, status: 200, json: async () => JSON.parse('PRIVATE_PAYLOAD credentials=secret') };
        if (request === 'GET') fetchMock.mockResolvedValueOnce(malformed);
        render(<DeliverySyncInputs {...props} />); open();
        if (request === 'retry') {
            await screen.findByText(/Reason not captured/);
            fetchMock.mockResolvedValueOnce(malformed); fireEvent.click(retry());
        }
        await screen.findByText(request === 'GET' ? 'Unable to load diagnostics.' : /Unable to retry this input\./);
        expect(document.body.textContent).not.toMatch(/PRIVATE|credentials|secret|Unexpected token|valid JSON/);
        expect(props.onRetry).not.toHaveBeenCalled();
        expect(fetchMock).toHaveBeenCalledTimes(request === 'GET' ? 1 : 2);
    });

    it.each(['GET', 'retry'] as const)('hides arbitrary %s network exception messages', async request => {
        if (request === 'GET') fetchMock.mockRejectedValueOnce(new Error('PRIVATE_NETWORK credentials=secret'));
        render(<DeliverySyncInputs {...props} />); open();
        if (request === 'retry') {
            await screen.findByText(/Reason not captured/);
            fetchMock.mockRejectedValueOnce(new Error('PRIVATE_NETWORK credentials=secret')); fireEvent.click(retry());
        }
        await screen.findByText(request === 'GET' ? 'Unable to load diagnostics.' : /Unable to retry this input\./);
        expect(document.body.textContent).not.toMatch(/PRIVATE_NETWORK|credentials|secret/);
        expect(props.onRetry).not.toHaveBeenCalled();
    });

    it('recovers a failed page GET with the same cursor and does not show stale rows', async () => {
        fetchMock.mockResolvedValueOnce(page([item()], 'next-page'));
        render(<DeliverySyncInputs {...props} />); open(); await screen.findByText(/Reason not captured/);
        fetchMock.mockRejectedValueOnce(new Error('Network unavailable'));
        fireEvent.click(screen.getByRole('button', { name: 'Next inputs' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load diagnostics.');
        expect(screen.queryByRole('button', { name: 'Retry this input' })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Refresh input diagnostics' }));
        await screen.findByText(/Reason not captured/);
        expect(fetchMock.mock.calls[2][0]).toBe(fetchMock.mock.calls[1][0]);
        expect(fetchMock.mock.calls[2][0]).toContain('cursor=next-page');
    });

    it.each(['account', 'filter', 'close'])('aborts and drops stale GET when changing %s', async change => {
        let finish!: (value: unknown) => void;
        fetchMock.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
        const { rerender } = render(<DeliverySyncInputs {...props} />); open();
        const signal = fetchMock.mock.calls[0][1].signal;
        if (change === 'account') rerender(<DeliverySyncInputs {...props} accountId="account-b" />);
        if (change === 'filter') fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'failed' } });
        if (change === 'close') fireEvent.click(screen.getByRole('button', { name: 'Hide blocked inputs' }));
        expect(signal.aborted).toBe(true);
        await act(async () => finish(page([item({ entityId: 999 })])));
        expect(screen.queryByText(/product ID: 999/)).toBeNull();
        if (change === 'account') expect(fetchMock.mock.calls[1][1].headers['X-Account-ID']).toBe('account-b');
    });

    it('drops a previous account POST without refreshing the new account', async () => {
        const { rerender } = render(<DeliverySyncInputs {...props} />); open(); await screen.findByText(/Reason not captured/);
        let finish!: (value: unknown) => void;
        fetchMock.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })); fireEvent.click(retry());
        const signal = fetchMock.mock.calls[1][1].signal;
        rerender(<DeliverySyncInputs {...props} accountId="account-b" />);
        await screen.findByText(/Reason not captured/);
        await act(async () => finish(response({ accepted: true, disposition: 'queued', inputId: 'immutable/a' })));
        expect(signal.aborted).toBe(true); expect(props.onRetry).not.toHaveBeenCalled();
        expect(screen.queryByText(/Completion is not confirmed/)).toBeNull();
    });

    it('integrates with feature-off sync status and refreshes counts via GET after one retry', async () => {
        const status = { configurationSync: 'blocked', storefrontActivated: false, pendingCount: 0, syncedCount: 0, lastAcknowledgedAt: null, lastError: null };
        fetchMock.mockImplementation((url, options) => Promise.resolve(url === '/api/delivery-estimates/sync' ? response({ status }) : options.method === 'POST' ? response({ accepted: true, disposition: 'queued', inputId: 'immutable/a' }) : page()));
        render(<DeliverySyncPanel accountId={props.accountId} token={props.token} canEdit />);
        await screen.findByText(/Sync blocked/); expect(fetchMock).toHaveBeenCalledTimes(1);
        open(); await screen.findByText(/Reason not captured/); fireEvent.click(retry());
        await screen.findByText(/Completion is not confirmed/);
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));
        const requests = fetchMock.mock.calls.filter(([url]) => url === '/api/delivery-estimates/sync');
        expect(requests).toHaveLength(2); expect(requests.every(([, options]) => options.method === 'GET')).toBe(true);
        expect(within(screen.getByRole('region', { name: 'Blocked input diagnostics' })).getByText(/Completion is not confirmed/)).toBeInTheDocument();
    });
});
