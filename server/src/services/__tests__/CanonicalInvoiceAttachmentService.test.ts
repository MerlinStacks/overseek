import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CanonicalInvoiceAttachmentService } from '../CanonicalInvoiceAttachmentService';

const canonicalMocks = vi.hoisted(() => ({
    getOrQueue: vi.fn(),
    waitForReady: vi.fn(),
    isReadableReady: vi.fn(),
    processGenerationJob: vi.fn(),
    getArtifactById: vi.fn(),
}));

vi.mock('../CanonicalInvoiceService', () => ({
    canonicalInvoiceService: canonicalMocks,
}));

describe('CanonicalInvoiceAttachmentService', () => {
    const service = new CanonicalInvoiceAttachmentService();

    beforeEach(() => {
        vi.resetAllMocks();
    });

    it('returns ready artifact path without fallback', async () => {
        canonicalMocks.getOrQueue.mockResolvedValue({ id: 'art_1', templateId: 'tpl_1' });
        canonicalMocks.waitForReady.mockResolvedValue({ id: 'art_1', status: 'ready', storagePath: '/tmp/invoice-1.pdf' });
        canonicalMocks.isReadableReady.mockReturnValue(true);

        const result = await service.resolveAbsolutePath('acc_1', 'ord_1');

        expect(result).toEqual({
            absolutePath: '/tmp/invoice-1.pdf',
            artifactId: 'art_1',
        });
        expect(canonicalMocks.processGenerationJob).not.toHaveBeenCalled();
    });

    it('leaves pending generation for the admitted queue worker without a duplicate render', async () => {
        canonicalMocks.getOrQueue.mockResolvedValue({ id: 'art_2', templateId: 'tpl_2' });
        canonicalMocks.waitForReady.mockResolvedValue({ id: 'art_2', status: 'pending' });
        canonicalMocks.isReadableReady
            .mockReturnValueOnce(false)
            .mockReturnValueOnce(true);
        canonicalMocks.getArtifactById.mockResolvedValue({ id: 'art_2', status: 'ready', storagePath: '/tmp/invoice-2.pdf' });

        const result = await service.resolveAbsolutePath('acc_2', 'ord_2');

        expect(canonicalMocks.processGenerationJob).not.toHaveBeenCalled();
        expect(canonicalMocks.getArtifactById).not.toHaveBeenCalled();
        expect(canonicalMocks.waitForReady).toHaveBeenCalledWith({ id: 'art_2', templateId: 'tpl_2' }, 15000, 300);
        expect(result).toEqual({
            absolutePath: null,
            artifactId: 'art_2',
        });
    });

    it('returns null absolutePath when artifact never becomes readable', async () => {
        canonicalMocks.getOrQueue.mockResolvedValue({ id: 'art_3', templateId: 'tpl_3' });
        canonicalMocks.waitForReady.mockResolvedValue({ id: 'art_3', status: 'failed' });
        canonicalMocks.isReadableReady.mockReturnValue(false);

        const result = await service.resolveAbsolutePath('acc_3', 'ord_3');

        expect(result).toEqual({
            absolutePath: null,
            artifactId: 'art_3',
        });
        expect(canonicalMocks.processGenerationJob).not.toHaveBeenCalled();
    });
});
