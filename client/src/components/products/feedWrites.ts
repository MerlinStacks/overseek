export type FeedChannel = 'google' | 'meta' | 'pinterest' | 'similar';

export interface FeedWriteColumn {
    targetField: string;
    mappedValue: string | null;
    aiSuggestedValue: string | null;
    overrideValue: string | null;
    finalValue: string | null;
    isMissingRequired: boolean;
}

export interface FeedWriteRow {
    rowId: string;
    rowType: 'parent' | 'variation';
    wooId: number;
    variationWooId?: number;
    sku?: string | null;
    name: string;
    columns: FeedWriteColumn[];
}

export interface ProductFeedRowsResponse {
    channel: FeedChannel;
    mappings: Array<{ targetField: string; required?: boolean }>;
    rows: FeedWriteRow[];
}

const EXCLUDED_PRODUCT_FEED_FIELDS = new Set([
    'id',
    'mpn',
    'sku',
    'price',
    'sale_price',
    'link',
    'canonical_link',
    'image_link',
    'additional_image_link',
]);

export function isProductFeedWriteField(field: string): boolean {
    return !EXCLUDED_PRODUCT_FEED_FIELDS.has(field);
}

export function getFeedOverrideKey(row: FeedWriteRow, field: string): string {
    return row.variationWooId
        ? `${row.wooId}-${row.variationWooId}:${field}`
        : field;
}

export function formatFeedFieldLabel(field: string): string {
    return field
        .split('_')
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
}
