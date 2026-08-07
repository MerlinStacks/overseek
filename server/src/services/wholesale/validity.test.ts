import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ add: vi.fn(), transaction: vi.fn(), log: vi.fn() }));
vi.mock('../../utils/prisma', () => ({ prisma: { $transaction: mocks.transaction, wholesaleCatalogGeneration: { updateMany: vi.fn() } } }));
vi.mock('../queue/QueueFactory', () => ({ QUEUES: { WHOLESALE_CATALOG_VALIDITY_UPDATE: 'validity' }, QueueFactory: { getQueue: () => ({ add: mocks.add }) } }));
vi.mock('../AuditService', () => ({ AuditActions: { WHOLESALE_VALIDITY_EXTENSION_REQUESTED: 'REQUESTED' }, AuditService: { log: mocks.log } }));

import { WholesaleGenerationService } from './generations';
import { snapshotWithValidity } from './validityWorker';

describe('wholesale commercial validity extension', () => {
    beforeEach(() => vi.clearAllMocks());

    it('allows revival within the original 30-day horizon and rejects stale dates beyond it', () => {
        const generation = { originalGeneratedAt: new Date('2026-08-01T00:00:00Z'), effectiveDate: new Date('2026-08-01T00:00:00Z') };
        expect(WholesaleGenerationService.validateExtendedValidUntil('2026-08-20', generation, new Date('2026-08-10T00:00:00Z'), 'UTC').toISOString()).toBe('2026-08-20T23:59:59.999Z');
        expect(() => WholesaleGenerationService.validateExtendedValidUntil('2026-09-01', generation, new Date('2026-08-10T00:00:00Z'), 'UTC')).toThrow(/30 days/);
        expect(() => WholesaleGenerationService.validateExtendedValidUntil('2026-08-09', generation, new Date('2026-08-10T00:00:00Z'), 'UTC')).toThrow(/future/);
    });

    it('marks an approved current generation updating and queues the next revision without changing live validity', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-08-07T00:00:00Z'));
        const generation = { id: 'generation-1', accountId: 'account-1', status: 'APPROVED', staleAt: null, validityArtifactStatus: 'CURRENT', validityRevision: 2, validUntil: new Date('2026-08-09'), originalGeneratedAt: new Date('2026-08-01'), effectiveDate: new Date('2026-08-01'), account: { timezone: 'UTC' }, inputSnapshot: {} };
        const tx = { $queryRawUnsafe: vi.fn(), wholesaleCatalogGeneration: { findFirst: vi.fn().mockResolvedValue(generation), updateMany: vi.fn().mockResolvedValue({ count: 1 }) } };
        mocks.transaction.mockImplementation((callback: any) => callback(tx));
        mocks.add.mockResolvedValue({});
        const result = await WholesaleGenerationService.extendValidity('account-1', 'generation-1', 'user-1', '2026-08-20');
        expect(tx.wholesaleCatalogGeneration.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { validityArtifactStatus: 'UPDATING', errorMessage: null } }));
        expect(mocks.add).toHaveBeenCalledWith('update-wholesale-catalog-validity', expect.objectContaining({ validityRevision: 3 }), expect.objectContaining({ attempts: 1 }));
        expect(result.validUntil).toEqual(generation.validUntil);
        expect(result.validityArtifactStatus).toBe('UPDATING');
        vi.useRealTimers();
    });

    it('changes only validity fields in the worker snapshot helper', () => {
        const snapshot: any = { snapshotVersion: 1, validUntil: 'old', account: {}, catalog: {}, branding: {}, defaults: {}, effectiveDate: 'date', categories: [] };
        expect(snapshotWithValidity(snapshot, new Date('2026-08-20T23:59:59.999Z'), 4)).toMatchObject({ validUntil: '2026-08-20T23:59:59.999Z', validityRevision: 4, catalog: {} });
        expect(snapshot.validUntil).toBe('old');
    });
});
