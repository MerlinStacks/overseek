export interface MethodIdentity { methodId: string; instanceId: number; mappingKind?: 'core_instance' | 'all_provider_rates' | 'exact_rate'; rateId?: string }
export interface ShippingMethod extends MethodIdentity {
    allRatesConfirmed?: boolean;
    zoneId: number;
    zoneName: string;
    title: string;
    enabled: boolean;
    minTransitDays: number;
    maxTransitDays: number;
    fulfilmentType: 'delivery' | 'collection';
}
export interface DeliverySettings {
    cutoffTime: string;
    timezone: string;
    fallbackSupplierLeadTimeDays: number;
    productionWeekdays: number[];
    transitWeekdays: number[];
    closures: { date: string; scope: 'work' | 'transit' | 'both'; label?: string }[];
    shippingMethods: ShippingMethod[];
    defaultMethod: MethodIdentity | null;
    branding: {
        textColor: string | null;
        accentColor: string | null;
        backgroundColor: string | null;
        fontSize: number;
        spacing: 'compact' | 'comfortable';
        showIcon: boolean;
    };
}
export interface SettingsResponse {
    settings: DeliverySettings;
    status: { syncStatus: string; storefrontActivated: boolean };
}
export interface SettingsFieldsProps {
    settings: DeliverySettings;
    onChange: (settings: DeliverySettings) => void;
}
/** Editable labels are not identity; exact mappings additionally retain the opaque option ID. */
export function methodKey(method: MethodIdentity): string {
    return `${method.methodId}:${method.instanceId}${method.mappingKind === 'exact_rate' ? `|exact_rate|${method.rateId}` : method.mappingKind === 'all_provider_rates' ? '|all_provider_rates' : ''}`;
}
