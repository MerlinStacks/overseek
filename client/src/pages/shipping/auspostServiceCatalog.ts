import type { AusPostServiceCatalogResponse } from './shippingApi';

export function serviceCodeOptionsFromCatalog(catalog: AusPostServiceCatalogResponse | undefined) {
    // Options are observed rows, never an assertion that reference codes are entitled.
    const genericCodes: string[] = [];
    const codes = uniqueStrings(catalogRows(catalog).map(service => service.code));
    return codes.sort((left, right) => {
        const leftGenericIndex = genericCodes.indexOf(left);
        const rightGenericIndex = genericCodes.indexOf(right);
        if (leftGenericIndex !== -1 || rightGenericIndex !== -1) {
            if (leftGenericIndex === -1) return 1;
            if (rightGenericIndex === -1) return -1;
            return leftGenericIndex - rightGenericIndex;
        }
        return serviceCodeNaturalLabel(catalog, left).localeCompare(serviceCodeNaturalLabel(catalog, right), undefined, { sensitivity: 'base' });
    });
}

export function serviceCodeLabelFormatter(catalog: AusPostServiceCatalogResponse | undefined) {
    return (code: string) => serviceCodeNaturalLabel(catalog, code);
}

export function serviceCodeNaturalLabel(catalog: AusPostServiceCatalogResponse | undefined, code: string, fallback?: string) {
    const normalizedCode = typeof code === 'string' ? code.trim().slice(0, 80) : '';
    const catalogLabel = catalogRows(catalog).find(service => service.code === normalizedCode)?.label;
    if (catalogLabel && catalogLabel !== normalizedCode && !looksLikeCode(catalogLabel)) return catalogLabel;
    if (Object.prototype.hasOwnProperty.call(AUSPOST_NATURAL_LABELS, normalizedCode)) return `${AUSPOST_NATURAL_LABELS[normalizedCode]} (reference only)`;
    const cleanedFallback = typeof fallback === 'string' ? fallback.trim().slice(0, 200) : '';
    if (cleanedFallback && cleanedFallback !== normalizedCode && !looksLikeCode(cleanedFallback)) return cleanedFallback;
    return normalizedCode ? `Unknown service ${normalizedCode}` : cleanedFallback || 'Unknown service';
}

const AUSPOST_NATURAL_LABELS: Record<string, string> = {
    AUS_PARCEL_REGULAR: 'Parcel Post',
    AUS_PARCEL_EXPRESS: 'Express Post',
    AUS_PARCEL_REGULAR_SIGNATURE: 'Parcel Post with Signature',
    AUS_PARCEL_EXPRESS_SIGNATURE: 'Express Post with Signature',
    S87384: 'Express Post',
    '3D55': 'Parcel Post + Signature',
    '3D61': 'Parcel Post + Signature',
    '3D67': 'Parcel Post + Signature',
    '3D73': 'Parcel Post + Signature',
    '3J55': 'Express Post + Signature',
    '3J61': 'Express Post + Signature',
    '3J67': 'Express Post + Signature',
    '3J73': 'Express Post + Signature',
    '7E55': 'Express Post satchel',
    '7E61': 'Express Post satchel',
    '7E67': 'Express Post satchel',
    '7E73': 'Express Post satchel',
};

function catalogRows(catalog: AusPostServiceCatalogResponse | undefined): Array<{ code: string; label: string }> {
    if (!catalog || !Array.isArray(catalog.services) || catalog.services.length > 500) return [];
    const rows = catalog.services;
    if (rows.some(row => !row || typeof row.code !== 'string' || !/^[A-Z0-9_-]{1,80}$/.test(row.code) || typeof row.label !== 'string' || !row.label.trim() || row.label.length > 200)) return [];
    if (new Set(rows.map(row => row.code)).size !== rows.length) return [];
    return rows;
}

function looksLikeCode(value: string) {
    return /^[A-Z0-9_-]{4,}$/.test(value.trim());
}

function uniqueStrings(values: string[]): string[] {
    return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
}
