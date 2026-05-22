import type { AusPostServiceCatalogResponse } from './shippingApi';

export function serviceCodeOptionsFromCatalog(catalog: AusPostServiceCatalogResponse | undefined) {
    return uniqueSortedStrings([
        ...(catalog?.services || []).map((service) => service.code),
    ]);
}

export function serviceCodeLabelFormatter(catalog: AusPostServiceCatalogResponse | undefined) {
    const labelByCode = new Map((catalog?.services || []).map((service) => [service.code, service.label]));
    return (code: string) => {
        const label = labelByCode.get(code);
        if (!label) return code;
        return label === code ? code : `${code} - ${label}`;
    };
}

export function serviceCodeNaturalLabel(catalog: AusPostServiceCatalogResponse | undefined, code: string, fallback?: string) {
    const normalizedCode = code.trim();
    const catalogLabel = (catalog?.services || []).find((service) => service.code === normalizedCode)?.label;
    if (catalogLabel) return catalogLabel;
    if (AUSPOST_NATURAL_LABELS[normalizedCode]) return AUSPOST_NATURAL_LABELS[normalizedCode];
    const cleanedFallback = fallback?.trim();
    if (cleanedFallback && cleanedFallback !== normalizedCode && !looksLikeCode(cleanedFallback)) return cleanedFallback;
    return normalizedCode || cleanedFallback || 'AusPost service';
}

const AUSPOST_NATURAL_LABELS: Record<string, string> = {
    AUS_PARCEL_REGULAR: 'Regular Parcel Post',
    AUS_PARCEL_EXPRESS: 'Express Post',
    AUS_PARCEL_REGULAR_SIGNATURE: 'Regular Parcel Post with Signature on Delivery',
    AUS_PARCEL_EXPRESS_SIGNATURE: 'Express Post with Signature on Delivery',
    S87384: 'Express Post',
    '3D55': 'Parcel Post satchel 500g',
    '3D61': 'Parcel Post satchel 1kg',
    '3D67': 'Parcel Post satchel 3kg',
    '3D73': 'Parcel Post satchel 5kg',
    '7E55': 'Express Post satchel 500g',
    '7E61': 'Express Post satchel 1kg',
    '7E67': 'Express Post satchel 3kg',
    '7E73': 'Express Post satchel 5kg',
};

function looksLikeCode(value: string) {
    return /^[A-Z0-9_-]{4,}$/.test(value.trim());
}

function uniqueSortedStrings(values: string[]): string[] {
    return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
        .sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }));
}
