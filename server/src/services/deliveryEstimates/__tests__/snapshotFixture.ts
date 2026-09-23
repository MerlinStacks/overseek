import type { DeliveryEstimateSnapshot } from '@overseek/core';
export const snapshotFixture = (): DeliveryEstimateSnapshot => ({
    version: 1, capturedAt: '2026-09-22T10:00:00Z', timezone: 'Australia/Sydney', fulfilmentType: 'delivery',
    method: { methodId: 'flat_rate', instanceId: 3, rateId: 'flat_rate:3', title: 'Standard' },
    dispatch: { min: '2026-09-23', max: '2026-09-24' },
    delivery: { min: '2026-09-25', max: '2026-09-28' }, collection: null
});
export const snapshotMetadata = (value: unknown) => [{ key: '_overseek_delivery_estimate_v1', value }];
