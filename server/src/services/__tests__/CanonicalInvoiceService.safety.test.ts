import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { INVOICE_SOURCE_CHANGED_BEFORE_RENDER, InvoicePreReservationConflict } from '../invoiceGenerationErrors';
const m = vi.hoisted(() => ({ find: vi.fn(), unique: vi.fn(), refreshed: vi.fn(), update: vi.fn(), render: vi.fn(), template: vi.fn(), order: vi.fn(), queue: vi.fn(), realpath: vi.fn(), stat: vi.fn(), open: vi.fn(), read: vi.fn(), close: vi.fn() }));
vi.mock('../../utils/prisma', () => ({ prisma: { invoiceArtifact: { findFirst: m.find, findUnique: m.unique, findUniqueOrThrow: m.refreshed, updateMany: m.update }, invoiceTemplate: { findFirst: m.template }, wooOrder: { findFirst: m.order } } }));
vi.mock('../InvoiceService', () => ({ InvoiceService: class { generateInvoicePdf = m.render; } }));
vi.mock('../queue/QueueFactory', () => ({ QueueFactory: { getQueue: () => ({ add: m.queue }) }, QUEUES: {} }));
vi.mock('../../utils/uploadPaths', () => ({ getUploadsDir: () => '/fixtures/uploads' }));
vi.mock('fs', () => ({ default: { realpathSync: m.realpath, lstatSync: m.stat, openSync: m.open, readSync: m.read, closeSync: m.close } }));
import { CanonicalInvoiceService } from '../CanonicalInvoiceService';
const hash = (str: string) => createHash('sha256').update(str).digest('hex');
const orderUpdatedAt = new Date(0);
const identity = { id: 'artifact', accountId: 'account', orderId: 'order', templateId: 'template', templateVersion: 'current', layoutHash: hash(`template:${hash('operational-a4-v6:{}')}:${orderUpdatedAt.toISOString()}`) };
const artifact = { ...identity, status: 'pending', renderer: 'pending', updatedAt: new Date(0), storagePath: null, fileSize: null, generatedAt: null };
describe('canonical generation admission and readiness', () => {
    const service = new CanonicalInvoiceService();
    beforeEach(() => { vi.resetAllMocks(); });
    it('reports an unavailable order without weakening account scope or queueing generation', async () => {
        m.template.mockResolvedValue({ id: 'template', layout: {} });
        m.order.mockResolvedValue(null);
        await expect(service.getOrQueue('account', '94156')).rejects.toMatchObject({ name: 'InvoiceOrderUnavailableError' });
        expect(m.order).toHaveBeenCalledWith({ where: { accountId: 'account', OR: [{ id: '94156' }, { wooId: 94156 }] }, select: { id: true, updatedAt: true } });
        expect(m.queue).not.toHaveBeenCalled();
    });
    it('recovers the latest issued PDF by scoped order even when the source revision has changed', async () => {
        const ready = { ...artifact, status: 'ready', renderer: 'pdfkit-primary', storagePath: '/fixtures/uploads/invoices/account/original.pdf', fileSize: 10, generatedAt: new Date(), mimeType: 'application/pdf' };
        m.order.mockResolvedValue({ id: 'order', updatedAt: new Date(ready.generatedAt.getTime() + 60_000) });
        m.find.mockResolvedValue(ready);
        m.realpath.mockImplementation((value: string) => value);
        m.stat.mockReturnValue({ isFile: () => true, isSymbolicLink: () => false, size: 10 });
        m.read.mockImplementation((_fd, buffer: Buffer) => buffer.write('%PDF-'));

        await expect(service.findIssuedInvoice('account', '94156')).resolves.toEqual(ready);
        expect(m.order).toHaveBeenCalledWith({ where: { accountId: 'account', OR: [{ id: '94156' }, { wooId: 94156 }] }, select: { id: true } });
        expect(m.find).toHaveBeenCalledWith(expect.objectContaining({ where: { accountId: 'account', orderId: 'order', status: 'ready' } }));
        expect(m.template).not.toHaveBeenCalled();
        expect(m.queue).not.toHaveBeenCalled();
    });
    it('does not search for issued PDFs if the order is not in the account', async () => {
        m.order.mockResolvedValue(null);
        await expect(service.findIssuedInvoice('account', '94156')).rejects.toMatchObject({ name: 'InvoiceOrderUnavailableError' });
        expect(m.find).not.toHaveBeenCalled();
    });
    it('requires reconciliation for an unreadable issued PDF rather than treating it as unissued', async () => {
        m.order.mockResolvedValue({ id: 'order' });
        m.find.mockResolvedValue({ ...artifact, status: 'ready', storagePath: null });
        await expect(service.findIssuedInvoice('account', '94156')).rejects.toMatchObject({ statusCode: 409 });
        expect(m.queue).not.toHaveBeenCalled();
    });
    it('polls by the entire immutable scope', async () => { m.find.mockResolvedValue({ ...artifact, status: 'uncertain' }); expect(await service.waitForReady(identity, 0)).toMatchObject({ status: 'uncertain' }); expect(m.find).toHaveBeenCalledWith({ where: identity }); });
    it('rejects bare-ID polling and unbounded waits', async () => { await expect(service.waitForReady('artifact' as never, 0)).rejects.toThrow('identity'); await expect(service.waitForReady(identity, 16000)).rejects.toThrow('bounds'); expect(m.find).not.toHaveBeenCalled(); });
    it('does not render if another worker owns the conditional claim', async () => { m.find.mockResolvedValue(artifact); m.update.mockResolvedValue({ count: 0 }); await service.processGenerationJob({ artifactId: identity.id, ...identity }); expect(m.render).not.toHaveBeenCalled(); expect(m.update).toHaveBeenCalledWith({ where: { ...identity, status: 'pending', updatedAt: new Date(0) }, data: { status: 'generating' } }); });
    it('defers a stale source before invoking the renderer', async () => {
        m.find.mockResolvedValue(artifact);
        m.update.mockResolvedValue({ count: 1 });
        m.template.mockResolvedValue({ id: 'template', layout: {} });
        m.order.mockResolvedValue({ updatedAt: new Date(1) });
        await service.processGenerationJob({ artifactId: identity.id, ...identity });
        expect(m.update).toHaveBeenLastCalledWith(expect.objectContaining({ where: { ...identity, status: 'generating' }, data: expect.objectContaining({ status: 'retryable' }) }));
        expect(m.render).not.toHaveBeenCalled();
    });
    it.each([true, false])('only defers typed renderer failures known to be before reservation (typed=%s)', async (typed) => {
        m.find.mockResolvedValue(artifact);
        m.update.mockResolvedValue({ count: 1 });
        m.template.mockResolvedValue({ id: 'template', layout: {} });
        m.order.mockResolvedValue({ updatedAt: orderUpdatedAt });
        const error = typed ? new InvoicePreReservationConflict(INVOICE_SOURCE_CHANGED_BEFORE_RENDER) : new Error('PDF write failed');
        m.render.mockRejectedValue(error);
        const work = service.processGenerationJob({ artifactId: identity.id, ...identity });
        if (typed) await expect(work).resolves.toBeUndefined();
        else await expect(work).rejects.toBe(error);
        expect(m.update).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: typed ? 'retryable' : 'uncertain' }) }));
    });
    it.each(['retryable', 'uncertain'])('re-admits %s pre-reservation evidence using one job ID for concurrent callers', async (status) => {
        const previous = { ...artifact, status, errorMessage: INVOICE_SOURCE_CHANGED_BEFORE_RENDER };
        const pending = { ...artifact, updatedAt: new Date(100), errorMessage: null };
        m.unique.mockResolvedValue(previous);
        m.refreshed.mockResolvedValue(pending);
        m.update.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
        m.template.mockResolvedValue({ id: 'template', layout: {} });
        m.order.mockResolvedValue({ id: 'order', updatedAt: orderUpdatedAt });

        await Promise.all([service.getOrQueue('account', '94156'), service.getOrQueue('account', '94156')]);
        expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ ...identity, status, updatedAt: previous.updatedAt, storagePath: null }) }));
        expect(m.queue).toHaveBeenCalledTimes(2);
        expect(m.queue.mock.calls[0]).toEqual(m.queue.mock.calls[1]);
        expect(m.queue).toHaveBeenCalledWith('generate-canonical-invoice', expect.objectContaining({ revision: 100 }), { jobId: 'invoice-canonical_artifact_100' });
    });
    it.each([{ errorMessage: 'PDF write failed' }, { errorMessage: INVOICE_SOURCE_CHANGED_BEFORE_RENDER, storagePath: '/possibly-issued.pdf' }])('does not re-admit uncertain work without no-reservation evidence: %j', async (evidence) => {
        const uncertain = { ...artifact, status: 'uncertain', ...evidence };
        m.unique.mockResolvedValue(uncertain);
        m.template.mockResolvedValue({ id: 'template', layout: {} });
        m.order.mockResolvedValue({ id: 'order', updatedAt: orderUpdatedAt });
        await expect(service.getOrQueue('account', '94156')).resolves.toEqual(uncertain);
        expect(m.update).not.toHaveBeenCalled();
        expect(m.queue).not.toHaveBeenCalled();
    });
    it('does not let a superseded queue job claim a re-admitted revision', async () => {
        m.find.mockResolvedValue({ ...artifact, updatedAt: new Date(100) });
        await service.processGenerationJob({ artifactId: identity.id, ...identity, revision: 0 });
        expect(m.update).not.toHaveBeenCalled();
        expect(m.render).not.toHaveBeenCalled();
    });
    it('requires scoped canonical PDF evidence and rejects escaped paths', () => { const ready = { ...artifact, status: 'ready', renderer: 'pdfkit-primary', storagePath: '/other/invoice.pdf', fileSize: 10, generatedAt: new Date(), mimeType: 'application/pdf' }; m.realpath.mockImplementation((value: string) => value); m.stat.mockReturnValue({ isFile: () => true, isSymbolicLink: () => false, size: 10 }); expect(service.isReadableReady(ready as never)).toBe(false); expect(service.isReadableReady({ ...ready, renderer: 'browser' } as never)).toBe(false); expect(m.open).not.toHaveBeenCalled(); });
});
