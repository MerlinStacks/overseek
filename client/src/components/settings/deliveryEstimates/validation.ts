import { methodKey, type DeliverySettings } from './types';

const daysValid = (value: number) => Number.isInteger(value) && value >= 0 && value <= 3650;
const idValid = (value: number) => Number.isInteger(value) && value >= 0 && value <= 2147483647;

/** Validate cross-field rules before replacing the entire settings document. Server remains authoritative. */
export function settingsErrors(settings: DeliverySettings): string[] {
    const errors: string[] = [];
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(settings.cutoffTime)) errors.push('Enter a cutoff time in HH:mm format.');
    try {
        if (!settings.timezone || settings.timezone.length > 100 || /^[+-]/.test(settings.timezone)) throw new Error();
        new Intl.DateTimeFormat('en', { timeZone: settings.timezone });
    } catch { errors.push('Enter a valid IANA timezone, such as Australia/Sydney.'); }
    if (!daysValid(settings.fallbackSupplierLeadTimeDays)) errors.push('Supplier fallback must be a whole number from 0 to 3650 calendar days.');
    for (const key of ['productionWeekdays', 'transitWeekdays'] as const) {
        const days = settings[key];
        if (!days.length || days.length > 7 || new Set(days).size !== days.length || days.some(day => !Number.isInteger(day) || day < 0 || day > 6)) {
            errors.push(`Select at least one ${key === 'productionWeekdays' ? 'production / work' : 'transit'} day.`);
        }
    }
    if (settings.closures.length > 3660) errors.push('At most 3660 closures are supported.');
    settings.closures.forEach((closure, index) => {
        const date = new Date(`${closure.date}T00:00:00Z`);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(closure.date) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== closure.date) {
            errors.push(`Closure ${index + 1}: choose a valid calendar date.`);
        }
        if ((closure.label?.length ?? 0) > 100) errors.push(`Closure ${index + 1}: label must be at most 100 characters.`);
    });
    if (settings.shippingMethods.length > 500) errors.push('At most 500 shipping mappings are supported.');
    settings.shippingMethods.forEach((row, index) => {
        const kind = row.mappingKind ?? 'core_instance';
        if ((kind === 'exact_rate') !== (row.rateId !== undefined) || (row.rateId !== undefined && !/^[\x21-\x7e]{1,200}(?![\s\S])/.test(row.rateId))) errors.push(`Shipping row ${index + 1}: exact mapping requires an actual opaque rate ID (1–200 printable non-space ASCII characters).`);
        if (kind === 'all_provider_rates' && row.allRatesConfirmed !== true) errors.push(`Shipping row ${index + 1}: explicitly confirm that every provider option shares this transit range.`);
        if (kind !== 'all_provider_rates' && row.allRatesConfirmed === true) errors.push(`Shipping row ${index + 1}: instance-wide confirmation is only valid for an all-provider-rates policy.`);
        if (!/^[a-zA-Z0-9_-]{1,100}$/.test(row.methodId) || !idValid(row.instanceId) || !idValid(row.zoneId)) errors.push(`Shipping row ${index + 1}: enter valid method, instance and zone IDs.`);
        if (!row.title || row.title.length > 200 || row.zoneName.length > 200) errors.push(`Shipping row ${index + 1}: enter a title (up to 200 characters); zone name must also fit 200 characters.`);
        if (!daysValid(row.minTransitDays) || !daysValid(row.maxTransitDays) || row.minTransitDays > row.maxTransitDays) errors.push(`Shipping row ${index + 1}: transit days must be whole numbers from 0 to 3650, minimum ≤ maximum.`);
    });
    const keys = settings.shippingMethods.map(methodKey);
    if (settings.defaultMethod?.rateId !== undefined && (!/^[\x21-\x7e]{1,200}(?![\s\S])/.test(settings.defaultMethod.rateId) || !settings.defaultMethod.mappingKind || settings.defaultMethod.mappingKind === 'core_instance')) errors.push('Default option must be a valid actual rate ID on an exact or instance-wide mapping.');
    if (new Set(keys).size !== keys.length) errors.push('Each shipping method / instance identity must be unique, even across zones.');
    if (settings.defaultMethod && !settings.shippingMethods.some(row => row.enabled && methodKey(row) === methodKey(settings.defaultMethod!))) {
        errors.push('Default method is unavailable. Select an enabled shipping row or clear the default.');
    }
    if (!Number.isInteger(settings.branding.fontSize) || settings.branding.fontSize < 12 || settings.branding.fontSize > 20) errors.push('Brand text size must be a whole number from 12 to 20 pixels.');
    return errors;
}
