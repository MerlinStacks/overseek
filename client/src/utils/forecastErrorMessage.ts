/** Explain known planning failures without displaying raw database/provider errors. */
export function forecastErrorMessage(error: unknown): string {
    const message = error instanceof Error ? error.message : '';
    const status = error && typeof error === 'object' && 'status' in error ? error.status : null;
    if (status === 401) return 'Your session could not be refreshed. Please sign in again or retry.';
    if (status === 403) return 'You do not have permission to view inventory forecasts for this account.';
    if (status === 429) return 'Too many forecast requests. Please wait a moment and retry.';
    if (message.includes('nested/cyclic')) return 'Inventory forecasts are unavailable because a bill of materials contains nested or cyclic components. Multi-level demand planning is not supported yet.';
    if (message.startsWith('BOM ') || message === 'Invalid BOM demand quantity/waste' || message === 'Invalid BOM mapping quantities') return 'Inventory forecasts are unavailable because bill-of-materials data could not be fully resolved. Check component references, active status, quantities and waste factors.';
    if (message.startsWith('Historical sales') || message.startsWith('Invalid historical sales')) return 'Inventory forecasts are unavailable because sales history could not be read completely. Retry and check the order search index if this continues.';
    return `Unable to load inventory forecasts${typeof status === 'number' ? ` (HTTP ${status})` : ''}. Please retry. If this continues, check server logs for the inventory forecast error.`;
}
