import Fastify from 'fastify';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ authenticate: vi.fn(), order: vi.fn(), update: vi.fn(), queue: vi.fn(), wait: vi.fn(), ready: vi.fn() }));
vi.mock('./email/helpers', () => ({ authenticateRelayEmailAccount: m.authenticate }));
vi.mock('../utils/prisma', () => ({ prisma: { wooOrder: { findFirst: m.order, update: m.update } } }));
vi.mock('../services/CanonicalInvoiceService', () => ({
    InvoiceOrderUnavailableError: class extends Error {},
    MissingInvoiceTemplateError: class extends Error {},
    canonicalInvoiceService: { getOrQueue: m.queue, waitForReady: m.wait, isReadableReady: m.ready },
}));
import routes from './invoiceRelay';

let app: ReturnType<typeof Fastify>;
const settings = { prices_include_tax: true, tax_display_cart: 'incl', tax_display_shop: 'incl' };
const payload = { account_id: 'account', order_id: '123', ...settings };
beforeEach(async () => {
    vi.resetAllMocks();
    m.authenticate.mockResolvedValue({ accountId: 'account' });
    m.order.mockResolvedValue({ id: 'order', rawData: { ...settings, total: '50' } });
    m.queue.mockResolvedValue({ id: 'artifact' });
    m.wait.mockResolvedValue({ id: 'artifact', status: 'generating' });
    m.ready.mockReturnValue(false);
    app = Fastify();
    await app.register(routes);
});
afterEach(async () => { await app.close(); });
const request = () => app.inject({ method: 'POST', url: '/woocommerce-processing', headers: { 'x-relay-key': 'key' }, payload });

it('does not mutate the order or invalidate its artifact on repeated customer checks', async () => {
    expect((await request()).statusCode).toBe(202);
    expect((await request()).statusCode).toBe(202);
    expect(m.update).not.toHaveBeenCalled();
    expect(m.queue).toHaveBeenLastCalledWith('account', '123', { forceRegenerate: false });
});

it('merges changed tax settings without losing order data', async () => {
    m.order.mockResolvedValue({ id: 'order', rawData: { ...settings, tax_display_shop: 'excl', total: '50' } });
    await request();
    expect(m.update).toHaveBeenCalledExactlyOnceWith({ where: { id: 'order' }, data: { rawData: { ...settings, total: '50' } } });
});

it('returns the ready PDF on the next ordinary check without forcing regeneration', async () => {
    await request();
    m.wait.mockResolvedValue({ id: 'artifact', status: 'ready', storagePath: '/invoices/invoice.pdf', renderer: 'pdfkit-primary' });
    m.ready.mockReturnValue(true);
    const response = await request();
    expect(response.statusCode).toBe(200);
    expect(response.json().artifact_download_url).toContain('/api/invoices/relay/artifact/artifact?');
    expect(m.update).not.toHaveBeenCalled();
});

it('preserves reconciliation requirements instead of blindly retrying uncertain invoices', async () => {
    m.wait.mockResolvedValue({ id: 'artifact', status: 'uncertain' });
    const response = await request();
    expect(response.statusCode).toBe(409);
    expect(response.json().status).toBe('uncertain');
});

it('rejects another account before reading or changing an order', async () => {
    m.authenticate.mockResolvedValue({ accountId: 'other' });
    expect((await request()).statusCode).toBe(403);
    expect(m.order).not.toHaveBeenCalled();
    expect(m.queue).not.toHaveBeenCalled();
});
