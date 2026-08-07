import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    updateMany: vi.fn(),
    findFirst: vi.fn(),
    render: vi.fn(),
}));

vi.mock('../../utils/prisma', () => ({ prisma: { wholesaleCatalogGeneration: { updateMany: mocks.updateMany, findFirst: mocks.findFirst } } }));
vi.mock('../../utils/logger', () => ({ Logger: { warn: vi.fn() } }));
vi.mock('../AuditService', () => ({ AuditActions: {}, AuditService: { log: vi.fn() } }));
vi.mock('./renderer', () => ({ renderWholesaleCatalog: mocks.render }));
vi.mock('./storage', () => ({ generationPdfPath: (id: string, temporary = false) => `/tmp/wholesale-worker-test/${id}/${temporary ? 'master.tmp.pdf' : 'master.pdf'}` }));

import { WholesaleCatalogWorker } from './worker';

describe('wholesale generation worker claim', () => {
    beforeEach(() => vi.clearAllMocks());

    it('exits harmlessly when another worker already claimed the queued generation', async () => {
        mocks.updateMany.mockResolvedValue({ count: 0 });
        await expect(WholesaleCatalogWorker.process({ data: { generationId: 'generation-1', accountId: 'account-1' } })).resolves.toBeUndefined();
        expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 'generation-1', accountId: 'account-1', status: 'QUEUED', cancelRequestedAt: null },
        }));
        expect(mocks.findFirst).not.toHaveBeenCalled();
        expect(mocks.render).not.toHaveBeenCalled();
    });
});
