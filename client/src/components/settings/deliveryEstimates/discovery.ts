import { methodKey, type DeliverySettings, type MethodIdentity } from './types';

export interface DiscoveredMethod extends MethodIdentity {
    zoneId: number;
    zoneName: string;
    title: string;
    enabled: boolean;
    provider: 'woocommerce' | 'weight_based' | 'unknown';
    rateIdentityScope: 'method_instance';
    requiresRateVerification: boolean;
    observedRates?: { rateId: string; title: string; capturedAt: string }[];
}
export interface ShippingDiscovery {
    status: 'available' | 'plugin_update_required';
    timezone?: string;
    methods: DiscoveredMethod[];
    warnings: string[];
    capabilities?: object;
}

/** Import only new identities. Discovery never overwrites merchant-owned draft fields. */
export function mergeDiscoveredMethods(settings: DeliverySettings, methods: DiscoveredMethod[]): DeliverySettings {
    const identities = new Set(settings.shippingMethods.map(row => `${row.methodId}:${row.instanceId}`));
    const shippingMethods = [...settings.shippingMethods];
    for (const method of methods) {
        if (identities.has(methodKey(method))) continue;
        identities.add(methodKey(method));
        shippingMethods.push({
            methodId: method.methodId, instanceId: method.instanceId, zoneId: method.zoneId,
            zoneName: method.zoneName, title: method.title, enabled: false,
            minTransitDays: 0, maxTransitDays: 0, fulfilmentType: 'delivery',
        });
    }
    return { ...settings, shippingMethods };
}
