import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ label: { findFirst: vi.fn(), update: vi.fn() }, event: { findUnique: vi.fn(), findFirst: vi.fn(), upsert: vi.fn() }, receipt: { findUnique: vi.fn(), create: vi.fn() }, config: vi.fn(), order: vi.fn(), audit: vi.fn(), refresh: vi.fn(), transaction: vi.fn() }));
vi.mock('../../../utils/prisma', () => ({ prisma: { $transaction: m.transaction, shippingLabel: m.label, shippingTrackingEvent: m.event, shippingCarrierAccount: { findFirst: m.config }, wooOrder: { findUnique: m.order }, shippingAuditEvent: { create: m.audit } } }));
vi.mock('../AusPostShippingTrackingAdapter', () => ({ ausPostShippingTrackingAdapter: { refreshTracking: m.refresh } }));
vi.mock('../../../utils/logger', () => ({ Logger: { warn: vi.fn(), error: vi.fn() } }));
import { shippingTrackingService } from '../ShippingTrackingService';
import { resolveMergeTags } from '../../MergeTagResolver';
import { TrackingReadError } from '../TrackingAdmission';
const occurredAt = '2026-01-01T00:00:00.000Z';
const scan = () => ({ eventCode: 'DELIVERED', description: 'Delivered', occurredAt });
beforeEach(() => {
    vi.resetAllMocks();
    m.transaction.mockImplementation(fn => fn({ $queryRaw: vi.fn(), shippingLabel: m.label, shippingTrackingEvent: m.event, shippingCarrierAccount: { findFirst: m.config }, wooOrder: { findUnique: m.order }, scopedOperation: m.receipt }));
    m.label.findFirst.mockResolvedValue({ id: 'label', accountId: 'a', wooOrderId: 7, carrier: 'AUSPOST', trackingNumber: 'synthetic', latestTrackingOccurredAt: null });
    m.event.findUnique.mockResolvedValue(null); m.event.findFirst.mockResolvedValue(null); m.event.upsert.mockImplementation(async ({ create }) => ({ id: 'event', ...create }));
    m.config.mockResolvedValue({ config: {} }); m.receipt.findUnique.mockResolvedValue(null);
    m.order.mockResolvedValue({ id: 'order', number: '7', billingEmail: 'synthetic@example.test', rawData: {} });
});
it('updates chronological summaries in the event transaction without claiming a full poll succeeded', async () => {
    const result = await shippingTrackingService.recordTrackingEvent('a', 'label', scan());
    expect(result.normalized.normalizedState).toBe('delivered');
    expect(m.label.update).toHaveBeenCalledWith({ where: { id: 'label', accountId: 'a' }, data: expect.objectContaining({ latestTrackingStatus: 'delivered', latestTrackingOccurredAt: new Date(occurredAt) }) });
    expect(m.label.update.mock.calls[0][0].data).not.toHaveProperty('trackingSyncedAt');
});
it('does not regress a newer label summary or dispatch from an older scan', async () => {
    m.label.findFirst.mockResolvedValue({ id: 'label', accountId: 'a', wooOrderId: 7, latestTrackingOccurredAt: new Date('2026-02-01T00:00:00Z') });
    await shippingTrackingService.recordTrackingEvent('a', 'label', scan());
    expect(m.event.upsert).toHaveBeenCalledOnce(); expect(m.label.update).not.toHaveBeenCalled(); expect(m.receipt.create).not.toHaveBeenCalled();
});
it('consults existing source scans rather than assuming a newly added null summary head means no history', async () => {
    m.event.findFirst.mockResolvedValue({ occurredAt: new Date('2026-02-01T00:00:00Z') });
    await shippingTrackingService.recordTrackingEvent('a', 'label', scan());
    expect(m.label.update).not.toHaveBeenCalled();
});
it('requires explicit automation opt-in and queues frozen work instead of dispatching inline', async () => {
    await shippingTrackingService.recordTrackingEvent('a', 'label', scan()); expect(m.receipt.create).not.toHaveBeenCalled();
    m.config.mockResolvedValue({ config: { trackingAutomationAllowlist: ['SHIPMENT_DELIVERED'] } });
    await shippingTrackingService.recordTrackingEvent('a', 'label', scan());
    expect(m.receipt.create).toHaveBeenCalledWith({ data: expect.objectContaining({ accountId: 'a', kind: 'critical-event-outbox', result: expect.objectContaining({ state: 'pending', payload: expect.objectContaining({ shipment: expect.objectContaining({ email: 'synthetic@example.test', shipmentStatus: 'delivered' }) }) }) }) });
});
it('never creates new automation for an already recorded scan', async () => {
    m.event.findUnique.mockResolvedValue({ id: 'event' }); m.config.mockResolvedValue({ config: { trackingAutomationAllowlist: ['SHIPMENT_DELIVERED'] } });
    await shippingTrackingService.recordTrackingEvent('a', 'label', scan()); expect(m.receipt.create).not.toHaveBeenCalled();
});
it('corrects an existing unknown summary when its same scan is now recognized without replaying customer automation', async () => {
    m.label.findFirst.mockResolvedValue({ id: 'label', accountId: 'a', wooOrderId: 7, latestTrackingOccurredAt: new Date(occurredAt), latestTrackingStatus: 'unknown' });
    m.event.findUnique.mockResolvedValue({ id: 'event' });
    m.config.mockResolvedValue({ config: { trackingAutomationAllowlist: ['SHIPMENT_DELIVERED'] } });
    await shippingTrackingService.recordTrackingEvent('a', 'label', { eventCode: 'SCAN-123', status: 'Delivered', occurredAt });
    expect(m.label.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ latestTrackingStatus: 'delivered' }) }));
    expect(m.receipt.create).not.toHaveBeenCalled();
});
it('rejects absent/future source time and bounded malformed observations rather than inventing now', async () => {
    for (const input of [{ eventCode: 'DELIVERED' }, { ...scan(), occurredAt: 'not-a-date' }, { ...scan(), occurredAt: '2099-01-01T00:00:00.000Z' }, { ...scan(), description: 'x'.repeat(2001) }]) await expect(shippingTrackingService.recordTrackingEvent('a', 'label', input)).rejects.toThrow();
    expect(m.event.upsert).not.toHaveBeenCalled();
});
it('reports partial imports as unacknowledged, preserving real freshness and source receipts', async () => {
    m.refresh.mockResolvedValue([scan()]); m.event.upsert.mockRejectedValue(new Error('source storage failed'));
    await expect(shippingTrackingService.refreshTrackingFromCarrier('a', 'label')).rejects.toThrow('partial');
    expect(m.label.update).toHaveBeenCalledWith({ where: { id: 'label', accountId: 'a' }, data: { trackingLastOutcome: 'partial' } });
});
it('does not infer positive milestones from negation or compound unknown text', () => {
    expect(shippingTrackingService.normalizeTrackingEvent({ description: 'Not delivered; returned to sender' })).toMatchObject({ normalizedState: 'unknown', customerEmailSafe: false });
    expect(shippingTrackingService.normalizeTrackingEvent({ eventCode: 'ON_BOARD_FOR_DELIVERY' })).toMatchObject({ normalizedState: 'out_for_delivery' });
    expect(shippingTrackingService.normalizeTrackingEvent({ description: 'Delivered' })).toMatchObject({ normalizedState: 'delivered', terminal: true });
});
it('recognizes exact status text alongside opaque codes and refuses contradictory milestones', () => {
    expect(shippingTrackingService.normalizeTrackingEvent({ eventCode: 'SCAN-123', status: 'Delivered', description: 'Delivered' })).toMatchObject({ normalizedState: 'delivered', terminal: true });
    expect(shippingTrackingService.normalizeTrackingEvent({ eventCode: 'SCAN-123', description: 'On board for delivery' })).toMatchObject({ normalizedState: 'out_for_delivery' });
    expect(shippingTrackingService.normalizeTrackingEvent({ eventCode: 'IN_TRANSIT', status: 'Delivered' })).toMatchObject({ normalizedState: 'unknown', customerEmailSafe: false });
    expect(shippingTrackingService.normalizeTrackingEvent({ eventCode: 'DELIVERED', description: 'Not delivered' })).toMatchObject({ normalizedState: 'unknown', customerEmailSafe: false });
});
it('preserves the nested shipment context consumed by automation email merge tags', async () => {
    m.label.findFirst.mockResolvedValue({ id: 'label', accountId: 'a', wooOrderId: 7, trackingNumber: 'TRACK123', carrier: 'AUSPOST', serviceName: 'Parcel Post' });
    m.order.mockResolvedValue({ id: 'order', number: '7', billingEmail: 'synthetic@example.test', rawData: { status: 'processing' } });
    m.config.mockResolvedValue({ config: { trackingAutomationAllowlist: ['SHIPMENT_DELIVERED'] } });
    await shippingTrackingService.recordTrackingEvent('a', 'label', { ...scan(), location: 'Sydney' });
    const context = m.receipt.create.mock.calls[0][0].data.result.payload.shipment;
    expect(context.status).toBe('processing');
    expect(context.shipment.latestScanTime).toBe(occurredAt);
    expect(resolveMergeTags('{{shipment.status}}|{{shipment.latestScanDescription}}|{{shipment.latestScanLocation}}|{{shipment.trackingNumber}}', context)).toBe('delivered|Delivered|Sydney|TRACK123');
});
it('classifies failed carrier reads as retryable only before importing any scans', async () => {
    m.refresh.mockRejectedValue(new Error('connection refused'));
    await expect(shippingTrackingService.refreshTrackingFromCarrier('a', 'label')).rejects.toBeInstanceOf(TrackingReadError);
    expect(m.event.upsert).not.toHaveBeenCalled(); expect(m.audit).not.toHaveBeenCalled();
    m.refresh.mockResolvedValue([scan()]); m.audit.mockRejectedValue(new Error('lost acknowledgement after import'));
    await expect(shippingTrackingService.refreshTrackingFromCarrier('a', 'label')).rejects.not.toBeInstanceOf(TrackingReadError);
    expect(m.event.upsert).toHaveBeenCalled();
});
