import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ find: vi.fn(), update: vi.fn(), render: vi.fn(), template: vi.fn(), order: vi.fn(), queue: vi.fn(), realpath: vi.fn(), stat: vi.fn(), open: vi.fn(), read: vi.fn(), close: vi.fn() }));
vi.mock('../../utils/prisma', () => ({ prisma: { invoiceArtifact: { findFirst: m.find, updateMany: m.update }, invoiceTemplate: { findFirst: m.template }, wooOrder: { findFirst: m.order } } }));
vi.mock('../InvoiceService', () => ({ InvoiceService: class { generateInvoicePdf = m.render; } }));
vi.mock('../queue/QueueFactory', () => ({ QueueFactory: { getQueue: () => ({ add: m.queue }) }, QUEUES: {} }));
vi.mock('../../utils/uploadPaths', () => ({ getUploadsDir: () => '/fixtures/uploads' }));
vi.mock('fs', () => ({ default: { realpathSync: m.realpath, lstatSync: m.stat, openSync: m.open, readSync: m.read, closeSync: m.close } }));
import { CanonicalInvoiceService } from '../CanonicalInvoiceService';
const identity = { id: 'artifact', accountId: 'account', orderId: 'order', templateId: 'template', templateVersion: 'current', layoutHash: 'hash' };
const artifact = { ...identity, status: 'pending', renderer: 'pending', updatedAt: new Date(0) };
describe('canonical generation admission and readiness', () => {
    const service = new CanonicalInvoiceService();
    beforeEach(() => { vi.resetAllMocks(); });
    it('polls by the entire immutable scope', async () => { m.find.mockResolvedValue({ ...artifact, status: 'uncertain' }); expect(await service.waitForReady(identity, 0)).toMatchObject({ status: 'uncertain' }); expect(m.find).toHaveBeenCalledWith({ where: identity }); });
    it('rejects bare-ID polling and unbounded waits', async () => { await expect(service.waitForReady('artifact' as never, 0)).rejects.toThrow('identity'); await expect(service.waitForReady(identity, 16000)).rejects.toThrow('bounds'); expect(m.find).not.toHaveBeenCalled(); });
    it('does not render if another worker owns the conditional claim', async () => { m.find.mockResolvedValue(artifact); m.update.mockResolvedValue({ count: 0 }); await service.processGenerationJob({ artifactId: identity.id, ...identity }); expect(m.render).not.toHaveBeenCalled(); expect(m.update).toHaveBeenCalledWith({ where: { ...identity, status: 'pending', updatedAt: new Date(0) }, data: { status: 'generating' } }); });
    it('retains an uncertain terminal result if admitted source validation fails', async () => { m.find.mockResolvedValue(artifact); m.update.mockResolvedValue({ count: 1 }); m.template.mockResolvedValue(null); m.order.mockResolvedValue(null); await expect(service.processGenerationJob({ artifactId: identity.id, ...identity })).rejects.toThrow('source changed'); expect(m.update).toHaveBeenLastCalledWith(expect.objectContaining({ where: { ...identity, status: 'generating' }, data: expect.objectContaining({ status: 'uncertain' }) })); expect(m.render).not.toHaveBeenCalled(); });
    it('requires scoped canonical PDF evidence and rejects escaped paths', () => { const ready = { ...artifact, status: 'ready', renderer: 'pdfkit-primary', storagePath: '/other/invoice.pdf', fileSize: 10, generatedAt: new Date(), mimeType: 'application/pdf' }; m.realpath.mockImplementation((value: string) => value); m.stat.mockReturnValue({ isFile: () => true, isSymbolicLink: () => false, size: 10 }); expect(service.isReadableReady(ready as never)).toBe(false); expect(service.isReadableReady({ ...ready, renderer: 'browser' } as never)).toBe(false); expect(m.open).not.toHaveBeenCalled(); });
});
