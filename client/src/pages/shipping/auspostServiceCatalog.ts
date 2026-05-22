import type { AusPostServiceCatalogResponse } from './shippingApi';

export function serviceCodeOptionsFromCatalog(catalog: AusPostServiceCatalogResponse | undefined) {
    return uniqueSortedStrings([
        ...(catalog?.services || []).map((service) => service.code),
    ]);
}

export function serviceCodeLabelFormatter(catalog: AusPostServiceCatalogResponse | undefined) {
    const labelByCode = new Map((catalog?.services || []).map((service) => [service.code, service.label]));
    return (code: string) => labelByCode.has(code) ? `${code} - ${labelByCode.get(code)}` : code;
}

function uniqueSortedStrings(values: string[]): string[] {
    return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
        .sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }));
}
