import type { AusPostServiceCatalogResponse } from './shippingApi';

export function serviceCodeOptionsFromCatalog(catalog: AusPostServiceCatalogResponse | undefined) {
    const genericCodes = GENERIC_AUSPOST_SERVICES.map((service) => service.code);
    const codes = uniqueStrings([
        ...genericCodes,
        ...(catalog?.services || []).map((service) => service.code),
    ]);
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
    const normalizedCode = code.trim();
    const catalogLabel = (catalog?.services || []).find((service) => service.code === normalizedCode)?.label;
    if (AUSPOST_NATURAL_LABELS[normalizedCode]) return AUSPOST_NATURAL_LABELS[normalizedCode];
    const inferredLabel = inferAusPostServiceLabel(normalizedCode);
    if (inferredLabel) return inferredLabel;
    if (catalogLabel && catalogLabel !== normalizedCode && !looksLikeCode(catalogLabel)) return catalogLabel;
    const cleanedFallback = fallback?.trim();
    if (cleanedFallback && cleanedFallback !== normalizedCode && !looksLikeCode(cleanedFallback)) return cleanedFallback;
    return normalizedCode ? `AusPost service ${normalizedCode}` : cleanedFallback || 'AusPost service';
}

const AUSPOST_NATURAL_LABELS: Record<string, string> = {
    AUS_PARCEL_REGULAR: 'Parcel Post',
    AUS_PARCEL_EXPRESS: 'Express Post',
    AUS_PARCEL_REGULAR_SIGNATURE: 'Parcel Post with Signature',
    AUS_PARCEL_EXPRESS_SIGNATURE: 'Express Post with Signature',
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

const GENERIC_AUSPOST_SERVICES = [
    { code: 'AUS_PARCEL_REGULAR', label: 'Parcel Post' },
    { code: 'AUS_PARCEL_EXPRESS', label: 'Express Post' },
    { code: 'AUS_PARCEL_REGULAR_SIGNATURE', label: 'Parcel Post with Signature' },
    { code: 'AUS_PARCEL_EXPRESS_SIGNATURE', label: 'Express Post with Signature' },
];

function looksLikeCode(value: string) {
    return /^[A-Z0-9_-]{4,}$/.test(value.trim());
}

function inferAusPostServiceLabel(code: string) {
    const match = code.match(/^([37])([A-Z])(55|61|67|73)$/);
    if (!match) return null;

    const service = match[1] === '7' ? 'Express Post' : 'Parcel Post';
    const packageType = match[2] === 'D' ? ' satchel' : '';
    const weightBySuffix: Record<string, string> = {
        '55': '500g',
        '61': '1kg',
        '67': '3kg',
        '73': '5kg',
    };

    return `${service}${packageType} ${weightBySuffix[match[3]]}`;
}

function uniqueStrings(values: string[]): string[] {
    return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
}
