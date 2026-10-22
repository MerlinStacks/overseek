import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ receipt: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), upsert: vi.fn() }, resource: vi.fn(), audit: vi.fn(), work: vi.fn(), transaction: vi.fn() }));
vi.mock('../../utils/prisma', () => ({ prisma: { $transaction: m.transaction, scopedOperation: m.receipt } }));
import { runShippingSettingsCommand } from './ShippingSettingsCommand';
const version = '2026-01-01T00:00:00.000Z', operationId = '58205113-2154-4f77-a486-7ff9d5671d92';
const body = () => ({ operationId, resourceId: 'carrier', version, data: {} });
beforeEach(() => {
    vi.resetAllMocks(); m.resource.mockResolvedValue({ id: 'carrier', updatedAt: new Date(version) }); m.receipt.findUnique.mockResolvedValue(null); m.receipt.updateMany.mockResolvedValue({ count: 1 }); m.work.mockResolvedValue({ carrierAccount: { id: 'carrier' } });
    m.transaction.mockImplementation(fn => fn({ $queryRaw: vi.fn(), scopedOperation: m.receipt, shippingCarrierAccount: { findFirst: m.resource }, shippingPrintStation: { findFirst: m.resource }, shippingPackagePreset: { findFirst: m.resource }, shippingAuditEvent: { create: m.audit } }));
});
it('rejects flat writes, stale versions and changed actors before applying settings', async () => {
    await expect(runShippingSettingsCommand('a', 'u', 'save', {}, m.work)).rejects.toThrow();
    await expect(runShippingSettingsCommand('a', 'u', 'save', { ...body(), version: null }, m.work)).rejects.toThrow('changed');
    expect(m.work).not.toHaveBeenCalled();
    await runShippingSettingsCommand('a', 'u', 'save', body(), m.work);
    m.receipt.findUnique.mockResolvedValue(m.receipt.create.mock.calls[0][0].data);
    await expect(runShippingSettingsCommand('a', 'other', 'save', body(), m.work)).rejects.toThrow('changed');
});
it('records local settings and receipt in the same transaction and replays without executing again', async () => {
    const result = await runShippingSettingsCommand('a', 'u', 'save', body(), m.work);
    expect(m.work).toHaveBeenCalledWith({}, expect.objectContaining({ scopedOperation: m.receipt }));
    m.receipt.findUnique.mockResolvedValue(m.receipt.create.mock.calls[0][0].data);
    expect(await runShippingSettingsCommand('a', 'u', 'save', body(), m.work)).toEqual(result);
    expect(m.work).toHaveBeenCalledOnce();
});
it('never persists or replays a station token', async () => {
    m.work.mockResolvedValue({ token: 'secret', printStation: { id: 'station' } });
    expect((await runShippingSettingsCommand('a', 'u', 'station-create', body(), m.work)).value).toMatchObject({ token: 'secret' });
    const receipt = m.receipt.create.mock.calls[0][0].data;
    expect(JSON.stringify(receipt)).not.toContain('secret'); m.receipt.findUnique.mockResolvedValue(receipt);
    const replay = await runShippingSettingsCommand('a', 'u', 'station-create', body(), m.work);
    expect(replay.value).toMatchObject({ tokenUnavailableOnReplay: true }); expect(replay.value).not.toHaveProperty('token');
});
it('keeps provider failures uncertain and never clears the gate or retries', async () => {
    m.work.mockRejectedValue(new Error('lost response'));
    await expect(runShippingSettingsCommand('a', 'u', 'test', body(), m.work)).rejects.toThrow('unconfirmed');
    expect(m.receipt.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { result: expect.objectContaining({ state: 'uncertain' }) } }));
    expect(m.receipt.update).not.toHaveBeenCalled(); expect(m.work).toHaveBeenCalledOnce();
});
it('rejects credential-bearing or foreign endpoints before any work', async () => {
    for (const data of [{ apiBaseUrl: 'https://internal.test/shipping/v1' }, { apiBaseUrl: 'https://user:pass@digitalapi.auspost.com.au/shipping/v1' }, { labelsEndpointPath: '//internal.test' }]) await expect(runShippingSettingsCommand('a', 'u', 'save', { ...body(), data }, m.work)).rejects.toThrow();
    expect(m.work).not.toHaveBeenCalled();
});
