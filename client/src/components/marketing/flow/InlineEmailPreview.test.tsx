import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), account: { id: 'account' } }));
vi.mock('../../../context/AuthContext', () => ({ useAuth: () => ({ token: 'token' }) }));
vi.mock('../../../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: mocks.account }) }));
import { InlineEmailPreview } from './InlineEmailPreview';

beforeEach(() => {
    mocks.account = { id: 'account' }; mocks.fetch.mockReset();
    mocks.fetch.mockImplementation(async (url: string) => ({ ok: true, json: async () => url.endsWith('preview-orders') ? { orders: [{ id: 'order', number: '123', label: 'Alex' }] } : url.endsWith('preview-email') ? { html: '<p>Resolved</p>', subject: 'Hello Alex', previewText: 'Preview', orderId: null, missingTags: ['{{unknown}}'] } : { success: true } }));
    vi.stubGlobal('fetch', mocks.fetch);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const props = { html: '<p>Content</p>', subject: 'Hello {{customer.firstName}}', category: 'MARKETING' as const, onPreviewed: vi.fn(), onTestSent: vi.fn() };
it('renders resolved fields, device controls and missing-value diagnostics inline', async () => {
    render(<InlineEmailPreview {...props} />);
    expect(await screen.findByText(/Hello Alex/)).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('{{unknown}}');
    fireEvent.click(screen.getByRole('button', { name: 'Mobile' }));
    expect(screen.getByTitle('Inline email preview')).toHaveClass('w-[320px]');
    expect(screen.getByTitle('Inline email preview')).toHaveAttribute('sandbox', '');
});
it('fills the desktop column while retaining the compact stacked preview height', async () => {
    render(<InlineEmailPreview {...props} />);
    const frame = await screen.findByTitle('Inline email preview');
    expect(screen.getByRole('region', { name: 'Live email preview' })).toHaveClass('flex', 'flex-col', 'lg:flex-1');
    expect(frame).toHaveClass('h-64', 'lg:min-h-64', 'lg:flex-1', 'w-full');
    fireEvent.click(screen.getByRole('button', { name: 'Mobile' }));
    expect(frame).toHaveClass('w-[320px]', 'lg:flex-1');
});
it('pins both preview and test to explicit sample context rather than implicitly selecting a recent order', async () => {
    render(<InlineEmailPreview {...props} />); await screen.findByTitle('Inline email preview');
    const previewCall = mocks.fetch.mock.calls.find(([url]) => url.endsWith('preview-email'));
    expect(JSON.parse(previewCall![1].body).orderId).toBeNull();
    fireEvent.change(screen.getByLabelText('Test email recipient'), { target: { value: 'test@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send test' }));
    await screen.findByText(/Test accepted for sending/);
    const testCall = mocks.fetch.mock.calls.find(([url]) => url.endsWith('test-email'));
    expect(JSON.parse(testCall![1].body)).toMatchObject({ to: 'test@example.com', orderId: null });
});
it('requests a deliberately selected order and rejects late previous renders', async () => {
    const view = render(<InlineEmailPreview {...props} />);
    await screen.findByTitle('Inline email preview');
    const previous = mocks.fetch.mock.calls.find(([url]) => url.endsWith('preview-email'));
    fireEvent.change(screen.getByLabelText('Preview customer/order'), { target: { value: 'order' } });
    await waitFor(() => expect(mocks.fetch.mock.calls.filter(([url]) => url.endsWith('preview-email')).length).toBe(2));
    expect(previous![1].signal.aborted).toBe(true);
    expect(JSON.parse(mocks.fetch.mock.calls.filter(([url]) => url.endsWith('preview-email'))[1][1].body).orderId).toBe('order');
    view.unmount();
});
