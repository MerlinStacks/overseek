import type { SettingsResponse } from './types';

/** Fresh API fixture keeps interaction tests isolated. */
export function responseFixture(): SettingsResponse {
    return {
        settings: {
            cutoffTime: '14:00', timezone: 'UTC', fallbackSupplierLeadTimeDays: 30,
            productionWeekdays: [1, 2, 3, 4, 5], transitWeekdays: [1, 2, 3, 4, 5], closures: [],
            shippingMethods: [{ methodId: 'flat_rate', instanceId: 3, zoneId: 0, zoneName: 'Rest of world', title: 'Standard', enabled: true, minTransitDays: 1, maxTransitDays: 3, fulfilmentType: 'delivery' }],
            defaultMethod: { methodId: 'flat_rate', instanceId: 3 },
            branding: { textColor: null, accentColor: null, backgroundColor: null, fontSize: 14, spacing: 'compact', showIcon: false },
        },
        status: { syncStatus: 'plugin_update_required', storefrontActivated: false },
    };
}
