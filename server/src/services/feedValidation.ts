import { feedDate, validGtin } from './feedProductData';

export interface FeedIssue {
    severity: 'error' | 'warning';
    field: string;
    code: string;
    message: string;
}

export interface FeedValidationColumn {
    targetField: string;
    sourceField?: string;
    finalValue: string | null;
    required?: boolean;
}

export function channelAvailability(status: string | null, channel?: string): string | null {
    if (channel !== 'meta') return status;
    return ({ in_stock: 'in stock', out_of_stock: 'out of stock', backorder: 'available for order' } as Record<string, string>)[status || ''] || status;
}

const LIMITS: Record<string, number> = {
    id: 50, title: 150, description: 5000, link: 2000, image_link: 2000,
    brand: 70, mpn: 70, item_group_id: 50, color: 100, size: 100, material: 200, pattern: 100,
};

const priceParts = (value: string) => value.match(/^(\d+(?:\.\d{1,2})?) ([A-Z]{3})$/);
const httpUrl = (value: string): boolean => {
    try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !!url.hostname && !url.username && !url.password; }
    catch { return false; }
};

export function validateFeedColumns(channel: string, columns: FeedValidationColumn[], now = new Date()): FeedIssue[] {
    if (channel !== 'google' && channel !== 'meta') return [];
    const values = Object.fromEntries(columns.map((column) => [column.targetField, (column.finalValue || '').trim()]));
    const issues: FeedIssue[] = [];
    const add = (field: string, code: string, message: string, severity: FeedIssue['severity'] = 'error') => {
        issues.push({ severity, field, code, message });
    };
    const required = new Set(['id', 'title', 'description', 'link', 'image_link', 'price', 'availability', 'condition']);
    columns.filter((column) => column.required).forEach((column) => required.add(column.targetField));
    required.forEach((field) => { if (!values[field]) add(field, 'missing_required', `Provide ${field.replace(/_/g, ' ')} for this product or variation.`); });
    Object.entries(values).forEach(([field, value]) => {
        const limit = channel === 'meta' && field === 'id' ? 100 : LIMITS[field];
        if (value && limit && [...value].length > limit) add(field, 'too_long', `${field} exceeds the ${limit}-character ${channel} limit.`);
    });
    ['link', 'image_link', 'canonical_link'].forEach((field) => {
        if (values[field] && !httpUrl(values[field])) add(field, 'invalid_url', `Use an absolute public HTTP(S) URL for ${field}.`);
    });
    if (values.additional_image_link) {
        if (values.additional_image_link.split(/[,\n]/).some((url) => url.trim() && !httpUrl(url.trim()))) {
            add('additional_image_link', 'invalid_url', 'An additional image URL is not an absolute HTTP(S) URL.');
        }
    }
    if (values.condition && !['new', 'used', 'refurbished'].includes(values.condition)) add('condition', 'invalid_condition', 'Condition must be new, used or refurbished.');
    const enums: Record<string, string[]> = {
        gender: ['male', 'female', 'unisex'],
        age_group: ['newborn', 'infant', 'toddler', 'kids', 'adult', ...(channel === 'meta' ? ['teen', 'all ages'] : [])],
        ...(channel === 'google' ? {
            size_type: ['regular', 'petite', 'plus', 'tall', 'big', 'maternity'],
            size_system: ['US', 'UK', 'EU', 'DE', 'FR', 'JP', 'CN', 'IT', 'BR', 'MEX', 'AU'],
        } : {}),
    };
    Object.entries(enums).forEach(([field, accepted]) => {
        if (values[field] && !accepted.includes(values[field])) add(field, 'invalid_variant_value', `Use a supported ${channel} ${field} value: ${accepted.join(', ')}.`);
    });
    const availability = channel === 'google'
        ? ['in_stock', 'out_of_stock', 'backorder', 'preorder']
        : ['in stock', 'out of stock', 'preorder', 'available for order', 'discontinued'];
    if (values.availability && !availability.includes(values.availability)) add('availability', 'invalid_availability', `Use a supported ${channel} availability value: ${availability.join(', ')}.`);
    const price = priceParts(values.price || '');
    if (values.price && !price) add('price', 'invalid_price', 'Use a non-negative amount and ISO currency, for example 19.95 AUD.');
    const sale = priceParts(values.sale_price || '');
    if (values.sale_price && !sale) add('sale_price', 'invalid_price', 'Use a non-negative sale amount and ISO currency.');
    if (price && sale && (price[2] !== sale[2] || Number(sale[1]) >= Number(price[1]))) {
        add('sale_price', 'invalid_sale_price', 'Sale price must be lower than the regular price and use the same currency.');
    }
    if (values.sale_price_effective_date) {
        const parts = values.sale_price_effective_date.split('/');
        const start = feedDate(parts[0]); const end = feedDate(parts[1]);
        if (parts.length !== 2 || !start || !end || start >= end || parts.some((part) => !/T.*(?:Z|[+-]\d{2}:?\d{2})$/.test(part))) add('sale_price_effective_date', 'invalid_sale_dates', 'Provide a valid ISO start/end sale range with timezones.');
        else if (now > end && values.sale_price) add('sale_price', 'expired_sale', 'This sale has ended; check the saved price/date override.');
        if (!values.sale_price) add('sale_price_effective_date', 'sale_dates_without_price', 'Sale dates are present without a sale price.', 'warning');
    }
    if (values.gtin && !validGtin(values.gtin)) add('gtin', 'invalid_gtin', 'GTIN must be a valid 8, 12, 13 or 14 digit barcode with a correct check digit.');
    if (values.identifier_exists && !['yes', 'no', 'true', 'false'].includes(values.identifier_exists)) add('identifier_exists', 'invalid_identifier_exists', 'Use yes or no for identifier_exists.');
    if (['no', 'false'].includes(values.identifier_exists) && (values.gtin || values.mpn)) {
        add('identifier_exists', 'identifier_conflict', 'Identifiers are supplied but identifier_exists says no. Confirm the correct manufacturer identifiers.');
    } else if (!values.gtin && !(values.brand && values.mpn) && !['no', 'false'].includes(values.identifier_exists)
        && columns.some((column) => column.targetField === 'gtin' && (column.sourceField === undefined || column.sourceField === 'gtin'))) {
        add('gtin', 'missing_identifiers', 'Confirm manufacturer identifiers. For genuinely identifier-free goods, set identifier_exists to no in the Google feed.', 'warning');
    }
    if (channel === 'google') {
        const needsDate = ['backorder', 'preorder'].includes(values.availability);
        if (needsDate && !values.availability_date) add('availability_date', 'missing_availability_date', 'Add an expected shipping date and display it on the product page.');
        if (values.availability_date) {
            const date = feedDate(values.availability_date);
            if (!date || !/T.*(?:Z|[+-]\d{2}:?\d{2})$/.test(values.availability_date) || values.availability_date.length > 25) add('availability_date', 'invalid_availability_date', 'Use an ISO shipping date with time and timezone.');
            else if (needsDate && (date <= now || date.getTime() > now.getTime() + 366 * 86400000)) add('availability_date', 'unusable_availability_date', 'Expected shipping must be in the future and no more than one year away.');
            if (!needsDate) add('availability_date', 'unexpected_availability_date', 'An availability date is only needed for backorder/preorder.', 'warning');
        }
    }
    if (channel === 'meta' && values.availability === 'available for order') {
        add('availability', 'meta_backorder', 'Backorder is exported as available for order. This is not a guarantee of ad delivery; check Commerce Manager.', 'warning');
    }
    return issues;
}
