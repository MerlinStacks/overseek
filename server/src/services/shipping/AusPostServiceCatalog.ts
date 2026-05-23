export interface AusPostServiceCatalogItem {
    code: string;
    label: string;
}

export const AUSPOST_SERVICE_CATALOG_UPDATED_AT = '2026-05-22';

export const AUSPOST_SERVICE_CATALOG: AusPostServiceCatalogItem[] = [
    { code: 'AUS_PARCEL_REGULAR', label: 'Parcel Post' },
    { code: 'AUS_PARCEL_EXPRESS', label: 'Express Post' },
    { code: 'AUS_PARCEL_REGULAR_SIGNATURE', label: 'Parcel Post with Signature' },
    { code: 'AUS_PARCEL_EXPRESS_SIGNATURE', label: 'Express Post with Signature' },
    { code: '3D55', label: 'Parcel Post satchel 500g' },
    { code: '3D61', label: 'Parcel Post satchel 1kg' },
    { code: '3D67', label: 'Parcel Post satchel 3kg' },
    { code: '3D73', label: 'Parcel Post satchel 5kg' },
    { code: '7E55', label: 'Express Post satchel 500g' },
    { code: '7E61', label: 'Express Post satchel 1kg' },
    { code: '7E67', label: 'Express Post satchel 3kg' },
    { code: '7E73', label: 'Express Post satchel 5kg' },
    { code: 'INT_PARCEL_STD', label: 'International Standard' },
    { code: 'INT_PARCEL_EXP', label: 'International Express' },
    { code: 'INT_PARCEL_COURIER', label: 'International Courier' },
];

export function listAusPostServiceCatalog() {
    return {
        services: AUSPOST_SERVICE_CATALOG,
        updatedAt: AUSPOST_SERVICE_CATALOG_UPDATED_AT,
    };
}
