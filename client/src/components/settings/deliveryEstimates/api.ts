import type { DeliverySettings, SettingsResponse } from './types';
import type { ShippingDiscovery } from './discovery';

export async function requestShippingMethods(accountId: string, token: string, signal: AbortSignal): Promise<ShippingDiscovery> {
    const response = await fetch('/api/delivery-estimates/shipping-methods', {
        method: 'GET', signal, headers: { Authorization: `Bearer ${token}`, 'X-Account-ID': accountId },
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new DeliverySettingsError(data?.error || `Shipping discovery failed (${response.status})`, response.status, data?.code);
    if (!['available', 'plugin_update_required'].includes(data?.status) || !Array.isArray(data?.methods) || !Array.isArray(data?.warnings)) {
        throw new Error('Invalid shipping discovery response. Please retry.');
    }
    return data;
}

/** Preserve feature/permission failures separately from recoverable network errors. */
export class DeliverySettingsError extends Error {
    constructor(message: string, public readonly status: number, public readonly code?: string) { super(message); }
}

/** GET and PUT use the same account scope and complete document contract. */
export async function requestSettings(accountId: string, token: string, signal: AbortSignal, settings?: DeliverySettings): Promise<SettingsResponse> {
    const response = await fetch('/api/delivery-estimates/settings', {
        method: settings ? 'PUT' : 'GET', signal,
        headers: { Authorization: `Bearer ${token}`, 'X-Account-ID': accountId, ...(settings ? { 'Content-Type': 'application/json' } : {}) },
        ...(settings ? { body: JSON.stringify(settings) } : {}),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
        const issues = Array.isArray(data?.issues) ? data.issues.map((issue: { path?: (string | number)[]; message?: string }) => `${issue.path?.join('.') || 'Settings'}: ${issue.message}`).join('; ') : '';
        throw new DeliverySettingsError([data?.error || `Request failed (${response.status})`, issues].filter(Boolean).join(': '), response.status, data?.code);
    }
    if (!data?.settings || !data?.status) throw new Error('Invalid settings response. Please retry.');
    return data;
}
