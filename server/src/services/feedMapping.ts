import { prisma } from '../utils/prisma';
import type { Prisma } from '@prisma/client';
import { Logger } from '../utils/logger';
import type { Job } from 'bullmq';
import crypto from 'crypto';
import { getFeedFieldCharacterLimit } from '../utils/feedFieldLimits';
import { feedAttribute, feedAvailabilityDate, feedIdentifier, feedIdentifierExists, feedMeta, feedPricing } from './feedProductData';
import { channelAvailability, validateFeedColumns, type FeedIssue } from './feedValidation';
import { isFeedVariable, platformVariantValue, resolvedVariantRaw, variantAttributeField, variantLandingLink } from './feedVariants';

export interface FeedScanHealth {
    generatedAt: string;
    scannedProducts: number;
    included: number;
    excluded: number;
    exclusions: Record<string, number>;
    errors: number;
    warnings: number;
    issues: Array<FeedIssue & { rowId: string; wooId: number; variationWooId?: number; name: string }>;
    excludedExamples: Array<{ rowId: string; name: string; reason: string }>;
}

export const FEED_FEATURE_KEY = 'FEED_EXPORTS';

export type FeedChannel = 'google' | 'meta' | 'pinterest' | 'similar';
export type VariationMode =
    | 'automatic'
    | 'variable_parent'
    | 'all_variations'
    | 'default_variation'
    | 'first_variation'
    | 'last_variation'
    | 'variable_and_variations';

export type FeedRefreshMode = 'manual' | 'auto_on_sync' | '1h' | '3h' | '12h' | '24h';

export interface FeedFieldMapping {
    targetField: string;
    sourceField: string;
    fallbackSourceField?: string;
    required?: boolean;
}

export interface GoogleProductCategoryOption {
    id: string;
    path: string;
}

export interface FeedProductFilters {
    excludeOutOfStockProducts: boolean;
    excludeUnpublishedProducts: boolean;
    backordersAsInStock?: boolean;
}

interface FeedFeatureConfig {
    mappings?: Partial<Record<FeedChannel, FeedFieldMapping[]>>;
    refreshModes?: Partial<Record<FeedChannel, FeedRefreshMode>>;
    maxBulkOptimizeRows?: number;
    productTypeCategoryPriority?: string[];
    excludeOutOfStockProducts?: boolean;
    excludeUnpublishedProducts?: boolean;
    backordersAsInStock?: boolean;
}

interface FeedAccountContext {
    name?: string | null;
    currency?: string | null;
    timezone?: string | null;
}

const DEFAULT_REFRESH_MODE: FeedRefreshMode = 'manual';
const ALLOWED_REFRESH_MODES: FeedRefreshMode[] = ['manual', 'auto_on_sync', '1h', '3h', '12h', '24h'];
const DEFAULT_MAX_BULK_OPTIMIZE_ROWS = 5000;
const DEFAULT_PRODUCT_FILTERS: FeedProductFilters = {
    excludeOutOfStockProducts: false,
    excludeUnpublishedProducts: false,
};
const LOCKED_FEED_FIELDS = new Set(['id', 'sku']);
const SHARED_REWRITE_FIELDS = new Set(['title', 'description']);
const GOOGLE_LOCAL_INVENTORY_FIELDS = new Set(['store_code']);
const GOOGLE_LOCAL_INVENTORY_SOURCES = new Set(['storeCode']);
const FEED_CHANNELS: FeedChannel[] = ['google', 'meta', 'pinterest', 'similar'];
const GOOGLE_PRODUCT_TAXONOMY_URL = 'https://www.google.com/basepages/producttype/taxonomy-with-ids.en-US.txt';
const GOOGLE_PRODUCT_TAXONOMY_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

let googleProductCategoryCache: { fetchedAt: number; options: GoogleProductCategoryOption[] } | null = null;
let googleProductCategoryRequest: Promise<GoogleProductCategoryOption[]> | null = null;

const DEFAULT_MAPPINGS: Record<FeedChannel, FeedFieldMapping[]> = {
    google: [
        { targetField: 'id', sourceField: 'wooId', required: true },
        { targetField: 'title', sourceField: 'name', required: true },
        { targetField: 'description', sourceField: 'description', fallbackSourceField: 'short_description', required: true },
        { targetField: 'item_group_id', sourceField: 'itemGroupId' },
        { targetField: 'link', sourceField: 'permalink', required: true },
        { targetField: 'image_link', sourceField: 'mainImage', required: true },
        { targetField: 'additional_image_link', sourceField: 'additionalImages' },
        { targetField: 'video_link', sourceField: 'videoLink' },
        { targetField: 'condition', sourceField: 'condition', required: true },
        { targetField: 'google_product_category', sourceField: 'googleProductCategory' },
        { targetField: 'product_type', sourceField: 'productType' },
        { targetField: 'gtin', sourceField: 'gtin' },
        { targetField: 'mpn', sourceField: 'mpn' },
        { targetField: 'price', sourceField: 'price', required: true },
        { targetField: 'sale_price', sourceField: 'salePrice' },
        { targetField: 'sale_price_effective_date', sourceField: 'salePriceEffectiveDate' },
        { targetField: 'availability', sourceField: 'stockStatus', required: true },
        { targetField: 'availability_date', sourceField: 'availabilityDate' },
        { targetField: 'color', sourceField: 'color' },
        { targetField: 'size', sourceField: 'size' },
        { targetField: 'material', sourceField: 'material' },
        { targetField: 'pattern', sourceField: 'pattern' },
        { targetField: 'age_group', sourceField: 'age_group' },
        { targetField: 'gender', sourceField: 'gender' },
        { targetField: 'size_type', sourceField: 'size_type' },
        { targetField: 'size_system', sourceField: 'size_system' },
        { targetField: 'brand', sourceField: 'brand' },
        { targetField: 'canonical_link', sourceField: 'canonicalLink' },
        { targetField: 'custom_label_0', sourceField: 'name' },
        { targetField: 'identifier_exists', sourceField: 'identifierExists' },
    ],
    meta: [
        { targetField: 'id', sourceField: 'wooId', required: true },
        { targetField: 'item_group_id', sourceField: 'itemGroupId' },
        { targetField: 'title', sourceField: 'name', required: true },
        { targetField: 'description', sourceField: 'description', fallbackSourceField: 'short_description' },
        { targetField: 'link', sourceField: 'permalink', required: true },
        { targetField: 'image_link', sourceField: 'mainImage', required: true },
        { targetField: 'additional_image_link', sourceField: 'additionalImages' },
        { targetField: 'video[0].url', sourceField: 'videoLink' },
        { targetField: 'price', sourceField: 'price', required: true },
        { targetField: 'sale_price', sourceField: 'salePrice' },
        { targetField: 'sale_price_effective_date', sourceField: 'salePriceEffectiveDate' },
        { targetField: 'availability', sourceField: 'stockStatus' },
        { targetField: 'color', sourceField: 'color' },
        { targetField: 'size', sourceField: 'size' },
        { targetField: 'material', sourceField: 'material' },
        { targetField: 'pattern', sourceField: 'pattern' },
        { targetField: 'age_group', sourceField: 'age_group' },
        { targetField: 'gender', sourceField: 'gender' },
        { targetField: 'brand', sourceField: 'brand' },
        { targetField: 'condition', sourceField: 'condition' },
        { targetField: 'google_product_category', sourceField: 'googleProductCategory' },
        { targetField: 'product_type', sourceField: 'productType' },
        { targetField: 'gtin', sourceField: 'gtin' },
        { targetField: 'mpn', sourceField: 'mpn' },
    ],
    pinterest: [
        { targetField: 'id', sourceField: 'wooId', required: true },
        { targetField: 'title', sourceField: 'name', required: true },
        { targetField: 'description', sourceField: 'description', fallbackSourceField: 'short_description' },
        { targetField: 'link', sourceField: 'permalink', required: true },
        { targetField: 'image_link', sourceField: 'mainImage', required: true },
        { targetField: 'additional_image_link', sourceField: 'additionalImages' },
        { targetField: 'video_link', sourceField: 'videoLink' },
        { targetField: 'price', sourceField: 'price', required: true },
        { targetField: 'sale_price', sourceField: 'salePrice' },
        { targetField: 'availability', sourceField: 'stockStatus' },
        { targetField: 'condition', sourceField: 'condition' },
        { targetField: 'product_type', sourceField: 'productType' },
        { targetField: 'google_product_category', sourceField: 'googleProductCategory' },
        { targetField: 'gtin', sourceField: 'gtin' },
        { targetField: 'mpn', sourceField: 'mpn' },
    ],
    similar: [
        { targetField: 'id', sourceField: 'wooId', required: true },
        { targetField: 'title', sourceField: 'name', required: true },
        { targetField: 'description', sourceField: 'description', fallbackSourceField: 'short_description' },
        { targetField: 'link', sourceField: 'permalink' },
        { targetField: 'image_link', sourceField: 'mainImage' },
        { targetField: 'price', sourceField: 'price' },
    ],
};

function stripHtml(value: string | null | undefined): string | null {
    if (!value) return null;
    return value
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/<\/p\s*>/gi, ' ')
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&quot;/gi, '"')
        .replace(/&#039;|&apos;/gi, "'")
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/\s+/g, ' ')
        .replace(/\s+([,.;:!?])/g, '$1')
        .trim() || null;
}

function normalizeCurrency(currency?: string | null): string {
    return /^[A-Z]{3}$/i.test(currency || '') ? String(currency).toUpperCase() : 'USD';
}

function formatFeedPrice(value: unknown, currency?: string | null): string | null {
    if (value == null || value === '') return null;
    const raw = String(value).trim();
    if (!raw) return null;
    if (/\s[A-Z]{3}$/i.test(raw)) {
        return raw.replace(/\s([a-z]{3})$/i, (_, code) => ` ${String(code).toUpperCase()}`);
    }

    const amount = Number(raw.replace(/[^0-9.-]/g, ''));
    const formattedAmount = Number.isFinite(amount) ? amount.toFixed(2) : raw;
    return `${formattedAmount} ${normalizeCurrency(currency)}`;
}

function normalizeStockStatus(status: unknown): string | null {
    if (!status) return null;
    const normalized = String(status).trim().toLowerCase().replace(/[\s-]+/g, '_');
    if (normalized === 'instock' || normalized === 'in_stock') return 'in_stock';
    if (normalized === 'outofstock' || normalized === 'out_of_stock') return 'out_of_stock';
    if (normalized === 'onbackorder' || normalized === 'backorder' || normalized === 'backorders') return 'backorder';
    return normalized;
}

function isOutOfStock(status: unknown): boolean {
    return normalizeStockStatus(status) === 'out_of_stock';
}

/** Feed-only availability override; never changes Woo inventory or quantities. */
function withFeedAvailability<T extends { rawData?: unknown; stockStatus?: string | null }>(product: T, enabled: boolean, parent?: T): T {
    if (!enabled) return product;
    const raw = (product.rawData || {}) as any;
    const parentRaw = (parent?.rawData || {}) as any;
    const status = normalizeStockStatus(product.stockStatus || raw.stock_status || parent?.stockStatus || parentRaw.stock_status);
    const owner = raw.manage_stock === 'parent' && parent ? parentRaw : raw;
    const allowsBackorders = owner.backorders === 'yes' || owner.backorders === 'notify'
        || owner.backorders_allowed === true
        || (owner.backorders == null && owner.backorders_allowed == null && status === 'backorder');
    return allowsBackorders && (status === 'out_of_stock' || status === 'backorder')
        ? { ...product, stockStatus: 'instock' }
        : product;
}

function isPublished(product: { status?: string | null; rawData?: unknown }): boolean {
    const rawData = product.rawData as { status?: unknown } | null;
    return String(product.status || rawData?.status || '').trim().toLowerCase() === 'publish';
}

function getProductType(rawData: any, categoryPriority: string[] = []): string | null {
    const categories: Array<{ name: string; sourceIndex: number }> = Array.isArray(rawData?.categories)
        ? rawData.categories
            .map((category: any, sourceIndex: number) => ({ name: String(category?.name || ''), sourceIndex }))
            .filter((category: { name: string }) => !!category.name)
        : [];
    const priorityByName = new Map(categoryPriority.map((name, index) => [name.toLowerCase(), index]));
    categories.sort((a, b) => {
        const aPriority = priorityByName.get(a.name.toLowerCase()) ?? Number.MAX_SAFE_INTEGER;
        const bPriority = priorityByName.get(b.name.toLowerCase()) ?? Number.MAX_SAFE_INTEGER;
        return aPriority - bPriority || a.sourceIndex - b.sourceIndex;
    });

    return rawData?.product_type
        || rawData?.productType
        || (categories.length > 0 ? categories.map((category) => category.name).join(' > ') : null)
        || null;
}

function getBrand(rawData: any, account?: FeedAccountContext): string | null {
    return rawData?.brands?.[0]?.name || rawData?.brand || account?.name || null;
}

function getRawMetaValue(rawData: any, keys: string[]): string | null {
    if (!Array.isArray(rawData?.meta_data)) return null;
    const normalizedKeys = new Set(keys.map((key) => key.toLowerCase()));
    const match = rawData.meta_data.find((item: any) => normalizedKeys.has(String(item?.key || '').toLowerCase()));
    return match?.value ? String(match.value) : null;
}

function getVideoLink(rawData: any): string | null {
    const direct = rawData?.video_link
        || rawData?.videoLink
        || rawData?.video_url
        || rawData?.videoUrl
        || rawData?.product_video_url
        || rawData?.productVideoUrl
        || getRawMetaValue(rawData, ['_tvpg_video_url', 'video_link', 'video link', '_video_link', 'video_url', '_video_url', 'product_video_url', '_product_video_url']);

    if (direct) return String(direct);

    if (Array.isArray(rawData?.videos)) {
        const video = rawData.videos.find((item: any) => item?.src || item?.url || item?.video_url || item?.video_link);
        return video ? String(video.src || video.url || video.video_url || video.video_link) : null;
    }

    return null;
}

function variationsInheritMainVideo(rawData: any): boolean {
    return getRawMetaValue(rawData, ['_tvpg_use_same_video'])?.toLowerCase() === 'yes';
}

function mergeMappingsWithDefaults(channel: FeedChannel, mappings?: FeedFieldMapping[]): FeedFieldMapping[] {
    if (!mappings || mappings.length === 0) return DEFAULT_MAPPINGS[channel];

    const normalizedMappings = mappings
        .filter((mapping) => channel !== 'google'
            || (!GOOGLE_LOCAL_INVENTORY_FIELDS.has(mapping.targetField)
                && !GOOGLE_LOCAL_INVENTORY_SOURCES.has(mapping.sourceField)))
        .map((mapping) => (
            channel === 'meta' && mapping.targetField === 'video_link'
                ? { ...mapping, targetField: 'video[0].url' }
                : mapping
        ));
    const savedByTarget = new Map(normalizedMappings.map((mapping) => [mapping.targetField, mapping]));
    const merged = DEFAULT_MAPPINGS[channel].map((defaultMapping) => savedByTarget.get(defaultMapping.targetField) || defaultMapping);
    const defaultTargets = new Set(DEFAULT_MAPPINGS[channel].map((mapping) => mapping.targetField));
    const customMappings = normalizedMappings.filter((mapping) => !defaultTargets.has(mapping.targetField));

    return [...merged, ...customMappings];
}

function getBaseTargetField(field: string): string {
    const parts = field.split(':');
    return parts[parts.length - 1] || field;
}

function parseGoogleProductTaxonomy(text: string): GoogleProductCategoryOption[] {
    return text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#'))
        .map((line) => {
            const match = line.match(/^(\d+)\s+-\s+(.+)$/);
            if (!match) return null;
            return { id: match[1], path: match[2] };
        })
        .filter((option): option is GoogleProductCategoryOption => !!option);
}

function normalizeChannel(channel: string): FeedChannel {
    const value = channel.toLowerCase();
    if (value === 'google' || value === 'meta' || value === 'pinterest' || value === 'similar') {
        return value;
    }
    throw new Error('Unsupported feed channel');
}

function selectFeedVariations(variations: any[], raw: any, mode: VariationMode): any[] {
    if (mode === 'variable_parent') return [];
    if (mode === 'first_variation') return variations.slice(0, 1);
    if (mode === 'last_variation') return variations.slice(-1);
    if (mode !== 'default_variation') return variations;
    const defaults = Array.isArray(raw?.default_attributes) ? raw.default_attributes : [];
    const matched = variations.filter((variation) => {
        const attrs = Array.isArray(variation.rawData?.attributes) ? variation.rawData.attributes : [];
        return defaults.length > 0 && defaults.every((def: any) => attrs.some((attr: any) =>
            String(attr?.name || '').toLowerCase() === String(def?.name || '').toLowerCase()
            && String(attr?.option || '').toLowerCase() === String(def?.option || '').toLowerCase(),
        ));
    });
    return matched.length ? matched : variations.slice(0, 1);
}

function variantIssues(variation: any, parent: any, columns: any[], channel: FeedChannel, siblingFields: string[]): FeedIssue[] {
    if (channel !== 'google' && channel !== 'meta') return [];
    const issues: FeedIssue[] = [];
    const add = (field: string, code: string, message: string) => issues.push({ field, code, message, severity: 'warning' });
    const values = Object.fromEntries(columns.map((column) => [column.targetField, column.finalValue]));
    if (values.item_group_id !== String(parent.wooId)) add('item_group_id', 'variant_group_mismatch', 'Use the same parent group ID for sibling variations. A custom mapping or override differs from the detected parent.');
    const raw = resolvedVariantRaw(variation.rawData, parent.rawData);
    const parentAttributes = Array.isArray(parent.rawData?.attributes) ? parent.rawData.attributes : [];
    const dimensions = [...parentAttributes.filter((attr: any) => attr.variation === true), ...raw.attributes];
    const expected = new Set([...siblingFields, ...dimensions.map(variantAttributeField).filter(Boolean)]);
    expected.forEach((field) => {
        if (!values[field]) add(field, 'missing_variant_attribute', `The product varies by ${field}, but this variation has no unambiguous ${field} value. Sync its selected option or provide a feed override.`);
    });
    const unsupported = [...new Set(dimensions.filter((attr) => !variantAttributeField(attr)).map((attr) => attr.name || attr.slug || `attribute ${attr.id}`))];
    if (unsupported.length) add('item_group_id', 'unsupported_variant_dimensions', `No standard variant field was guessed for: ${unsupported.join(', ')}. These choices remain in the title/landing-page selection. Check platform grouping eligibility, especially on Google.`);
    if (raw.attributes.some((attr: any) => !attr.option && !(Array.isArray(attr.options) && attr.options.length === 1))) {
        add('link', 'ambiguous_variant_selection', 'This variation has an unspecified/Any option. No combinations or product details were invented; confirm the landing-page selection.');
    }
    const landingLink = variantLandingLink(variation, parent);
    if (!landingLink.preselected && values.link === landingLink.url) {
        add('link', 'variant_link_selection', 'A variant-specific Woo permalink or actual taxonomy option slugs are missing. The fallback identifies the variation, but attribute preselection is not verified. Resync its Woo permalink.');
    }
    return issues;
}

/** Bounded raw-data reads; stable tie-breaking avoids missing equal updatedAt values. */
async function* feedProductBatches(args: Prisma.WooProductFindManyArgs): AsyncGenerator<any[]> {
    let cursor: string | undefined;
    do {
        const products = await prisma.wooProduct.findMany({
            ...args, take: 250,
            orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
            ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        });
        if (!products.length) return;
        yield products;
        if (products.length < 250) return;
        cursor = products[products.length - 1].id;
    } while (cursor);
}

function getModernSourceValue(sourceField: string, product: any, account?: FeedAccountContext, parent?: any, channel?: FeedChannel): string | null | undefined {
    const raw = product.rawData || {};
    switch (sourceField) {
        case 'price': return formatFeedPrice(feedPricing(product, account?.timezone || 'UTC').price, account?.currency);
        case 'salePrice': return formatFeedPrice(feedPricing(product, account?.timezone || 'UTC').salePrice, account?.currency);
        case 'salePriceEffectiveDate': return feedPricing(product, account?.timezone || 'UTC').salePriceEffectiveDate;
        case 'gtin': return feedIdentifier(raw, 'gtin');
        case 'mpn': return feedIdentifier(raw, 'mpn');
        case 'brand': return getBrand(raw) || (parent ? getBrand(parent.rawData) : null);
        case 'googleProductCategory': return raw.google_product_category || raw.googleProductCategory || parent?.rawData?.google_product_category || parent?.rawData?.googleProductCategory || null;
        case 'additionalImages': {
            if (!parent) return undefined;
            const images = [...(Array.isArray(raw.images) ? raw.images : []), ...(Array.isArray(parent.rawData?.images) ? parent.rawData.images : [])];
            const main = raw.image?.src || parent.mainImage || parent.rawData?.images?.[0]?.src;
            const otherVariantImages = new Set((parent.variations || []).filter((sibling: any) => sibling.wooId !== product.wooId).map((sibling: any) => sibling.rawData?.image?.src).filter(Boolean));
            const urls = [...new Set<string>(images.map((image: any) => image?.src).filter((url: unknown): url is string => typeof url === 'string' && !!url && url !== main && !otherVariantImages.has(url)))];
            const selected = channel === 'google' ? urls.slice(0, 10) : urls;
            return selected.length ? selected.join(',') : null;
        }
        case 'identifierExists': return feedIdentifierExists(raw) ?? (parent ? feedIdentifierExists({ identifier_exists: feedMeta(parent.rawData, ['identifier_exists', '_identifier_exists']) }) : null);
        case 'availabilityDate': return feedAvailabilityDate(raw, account?.timezone || 'UTC');
        case 'color': case 'size': case 'material': case 'pattern': case 'age_group': case 'gender': case 'size_type': case 'size_system':
            return platformVariantValue(sourceField, feedAttribute(raw, sourceField) || (parent ? feedAttribute(parent.rawData, sourceField) : null), channel);
        default: return undefined;
    }
}

function getSourceValue(sourceField: string, product: any, account?: FeedAccountContext, categoryPriority: string[] = [], channel?: FeedChannel): string | null {
    if (channel === 'google' || channel === 'meta') {
        if (sourceField === 'itemGroupId') return null; // Group identifiers belong to variant rows, not standalone products.
        const modern = getModernSourceValue(sourceField, product, account, undefined, channel);
        if (modern !== undefined) return modern;
    }
    switch (sourceField) {
        case 'wooId': return String(product.wooId);
        case 'sku': return product.sku || product.rawData?.sku || null;
        case 'itemGroupId': return String(product.wooId);
        case 'name': return product.name || null;
        case 'description': return stripHtml(product.rawData?.description);
        case 'short_description': return stripHtml(product.rawData?.short_description);
        case 'permalink': return product.permalink || product.rawData?.permalink || null;
        case 'canonicalLink': return product.permalink || product.rawData?.permalink || null;
        case 'mainImage': return product.mainImage || product.rawData?.images?.[0]?.src || null;
        case 'videoLink': return getVideoLink(product.rawData);
        case 'price': return formatFeedPrice(product.price ?? product.rawData?.price, account?.currency);
        case 'stockStatus': {
            const status = product.stockStatus || product.rawData?.stock_status;
            return channelAvailability(normalizeStockStatus(status), channel);
        }
        case 'brand': return getBrand(product.rawData, account);
        case 'additionalImages': {
            const images = Array.isArray(product.rawData?.images) ? product.rawData.images.slice(1) : [];
            const urls = images.map((img: any) => img?.src).filter(Boolean);
            return urls.length > 0 ? urls.join(',') : null;
        }
        case 'condition': return product.rawData?.condition || 'new';
        case 'googleProductCategory': return product.rawData?.google_product_category || product.rawData?.googleProductCategory || null;
        case 'productType': return getProductType(product.rawData, categoryPriority);
        case 'gtin': return product.rawData?.gtin || product.rawData?._gtin || null;
        case 'mpn': return product.rawData?.mpn || product.rawData?._mpn || product.sku || null;
        case 'salePrice': return formatFeedPrice(product.rawData?.sale_price, account?.currency);
        case 'salePriceEffectiveDate': return product.rawData?.sale_price_effective_date || null;
        case 'identifierExists': return 'yes';
        default: return null;
    }
}

function getVariationSourceValue(sourceField: string, variation: any, parent: any, account?: FeedAccountContext, categoryPriority: string[] = [], channel?: FeedChannel): string | null {
    if (channel === 'google' || channel === 'meta') {
        variation = { ...variation, rawData: resolvedVariantRaw(variation.rawData, parent.rawData) };
        if (sourceField === 'permalink') return variantLandingLink(variation, parent).url;
        const modern = getModernSourceValue(sourceField, variation, account, parent, channel);
        if (modern !== undefined) return modern;
    }
    switch (sourceField) {
        case 'wooId': return `${parent.wooId}-${variation.wooId}`;
        case 'sku': return variation.sku || variation.rawData?.sku || null;
        case 'itemGroupId': return String(parent.wooId);
        case 'name': {
            const attrs = Array.isArray(variation.rawData?.attributes)
                ? variation.rawData.attributes
                    .map((a: any) => a?.option)
                    .filter(Boolean)
                    .join(' / ')
                : '';
            return attrs ? `${parent.name} - ${attrs}` : parent.name;
        }
        case 'description': return stripHtml(variation.rawData?.description || parent.rawData?.description);
        case 'short_description': return stripHtml(variation.rawData?.short_description || parent.rawData?.short_description);
        case 'permalink': return variation.rawData?.permalink || parent.permalink || parent.rawData?.permalink || null;
        case 'canonicalLink': return parent.permalink || parent.rawData?.permalink || null;
        case 'mainImage': return variation.rawData?.image?.src || parent.mainImage || parent.rawData?.images?.[0]?.src || null;
        case 'videoLink': return variationsInheritMainVideo(parent.rawData)
            ? getVideoLink(parent.rawData)
            : getVideoLink(variation.rawData) || getVideoLink(parent.rawData);
        case 'price': return formatFeedPrice(variation.price ?? variation.rawData?.price ?? parent.price ?? parent.rawData?.price, account?.currency);
        case 'stockStatus': {
            const status = variation.stockStatus || variation.rawData?.stock_status || parent.stockStatus || parent.rawData?.stock_status;
            return channelAvailability(normalizeStockStatus(status), channel);
        }
        case 'brand': return getBrand(parent.rawData, account);
        case 'additionalImages': {
            const variationImage = variation.rawData?.image?.src;
            const parentImages = Array.isArray(parent.rawData?.images) ? parent.rawData.images.slice(1) : [];
            const images = variationImage ? [{ src: variationImage }, ...parentImages] : parentImages;
            const urls = images.map((img: any) => img?.src).filter(Boolean);
            return urls.length > 0 ? urls.join(',') : null;
        }
        case 'condition': return variation.rawData?.condition || parent.rawData?.condition || 'new';
        case 'googleProductCategory': return variation.rawData?.google_product_category || parent.rawData?.google_product_category || null;
        case 'productType': return getProductType(variation.rawData, categoryPriority) || getProductType(parent.rawData, categoryPriority);
        case 'gtin': return variation.rawData?.gtin || variation.rawData?._gtin || parent.rawData?.gtin || parent.rawData?._gtin || null;
        case 'mpn': return variation.rawData?.mpn || variation.rawData?._mpn || variation.sku || parent.rawData?.mpn || parent.rawData?._mpn || parent.sku || null;
        case 'salePrice': return formatFeedPrice(variation.rawData?.sale_price || parent.rawData?.sale_price, account?.currency);
        case 'salePriceEffectiveDate': return variation.rawData?.sale_price_effective_date || parent.rawData?.sale_price_effective_date || null;
        case 'identifierExists': return 'yes';
        default: return null;
    }
}

function getFeedOverrides(seoData: any, channel: FeedChannel): Record<string, string> {
    if (!seoData || typeof seoData !== 'object') return {};
    const overrides = seoData.feedOverrides;
    if (!overrides || typeof overrides !== 'object') return {};
    const channelOverrides = overrides[channel];
    if (!channelOverrides || typeof channelOverrides !== 'object') return {};
    return channelOverrides as Record<string, string>;
}

function getSharedFeedOverrides(seoData: any): Record<string, string> {
    if (!seoData || typeof seoData !== 'object') return {};
    const overrides = seoData.feedOverrides?.shared;
    return overrides && typeof overrides === 'object' ? overrides as Record<string, string> : {};
}

function isProductExcludedFromFeeds(seoData: unknown): boolean {
    return (seoData as any)?.excludeFromProductFeeds === true;
}

function getFeedAiSuggestions(seoData: any, channel: FeedChannel): Record<string, string> {
    if (!seoData || typeof seoData !== 'object') return {};
    const suggestions = seoData.feedAiSuggestions;
    if (!suggestions || typeof suggestions !== 'object') return {};
    const channelSuggestions = suggestions[channel];
    if (!channelSuggestions || typeof channelSuggestions !== 'object') return {};
    return channelSuggestions as Record<string, string>;
}

function getSharedFeedAiSuggestions(seoData: any): Record<string, string> {
    if (!seoData || typeof seoData !== 'object') return {};
    const suggestions = seoData.feedAiSuggestions?.shared;
    return suggestions && typeof suggestions === 'object' ? suggestions as Record<string, string> : {};
}

export class FeedMappingService {
    static parseChannel(channel: string): FeedChannel {
        return normalizeChannel(channel);
    }

    static parseRefreshMode(mode: string): FeedRefreshMode {
        if ((ALLOWED_REFRESH_MODES as string[]).includes(mode)) return mode as FeedRefreshMode;
        throw new Error('Unsupported feed refresh mode');
    }

    static async getGoogleProductCategoryOptions(): Promise<GoogleProductCategoryOption[]> {
        const now = Date.now();
        if (googleProductCategoryCache && now - googleProductCategoryCache.fetchedAt < GOOGLE_PRODUCT_TAXONOMY_CACHE_TTL_MS) {
            return googleProductCategoryCache.options;
        }

        if (!googleProductCategoryRequest) {
            googleProductCategoryRequest = (async () => {
                const response = await fetch(GOOGLE_PRODUCT_TAXONOMY_URL, {
                    signal: AbortSignal.timeout(10000),
                });

                if (!response.ok) {
                    throw new Error(`Failed to fetch Google product taxonomy: ${response.status}`);
                }

                const text = await response.text();
                const options = parseGoogleProductTaxonomy(text);
                if (options.length === 0) {
                    throw new Error('Google product taxonomy returned no categories');
                }

                googleProductCategoryCache = { fetchedAt: Date.now(), options };
                return options;
            })().finally(() => {
                googleProductCategoryRequest = null;
            });
        }

        return googleProductCategoryRequest;
    }

    static buildFeedExportToken(secret: string, accountId: string, channelInput: string): string {
        const channel = normalizeChannel(channelInput);
        return crypto
            .createHmac('sha256', secret)
            .update(`${accountId}:${channel}:feed-export:v1`)
            .digest('hex');
    }

    static async getFeedExportUrls(accountId: string, baseUrl: string): Promise<Record<FeedChannel, string>> {
        const account = await prisma.account.findUnique({
            where: { id: accountId },
            select: { webhookSecret: true, wooConsumerSecret: true },
        });

        if (!account) throw new Error('Account not found');

        const secret = account.webhookSecret || account.wooConsumerSecret;
        const normalizedBaseUrl = baseUrl.replace(/\/$/, '');

        const urls = {} as Record<FeedChannel, string>;
        for (const channel of ['google', 'meta', 'pinterest', 'similar'] as const) {
            const token = this.buildFeedExportToken(secret, accountId, channel);
            urls[channel] = `${normalizedBaseUrl}/api/feeds/export/${accountId}/${channel}?token=${token}`;
        }

        return urls;
    }

    static async validateFeedExportToken(accountId: string, channelInput: string, token: string): Promise<boolean> {
        const channel = normalizeChannel(channelInput);
        const account = await prisma.account.findUnique({
            where: { id: accountId },
            select: { webhookSecret: true, wooConsumerSecret: true },
        });

        if (!account) return false;
        const secret = account.webhookSecret || account.wooConsumerSecret;
        const expected = this.buildFeedExportToken(secret, accountId, channel);
        return token === expected;
    }

    static async getFeedExportXml(
        accountId: string,
        channelInput: string,
        variationMode: VariationMode = 'automatic',
    ): Promise<string> {
        const channel = normalizeChannel(channelInput);
        const { rows } = await this.getFeedRows(accountId, channel, 1, Number.MAX_SAFE_INTEGER, '', variationMode);

        const xmlEscape = (value: string): string => value
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');

        const channelTitle = `${channel.charAt(0).toUpperCase()}${channel.slice(1)} Product Feed`;

        const items = rows.map((row) => {
            const values = new Map<string, string>();
            for (const column of row.columns as Array<{ targetField: string; finalValue: string | null }>) {
                const value = (column.finalValue || '').trim();
                if (!value) continue;
                values.set(column.targetField, value);
            }

            const link = values.get('link') || '';

            const gFields = Array.from(values.entries())
                .flatMap(([key, value]) => {
                    if (key === 'link') return [];

                    const fieldValue = key === 'description' ? (stripHtml(value) || '') : value;
                    if (key === 'additional_image_link') {
                        return fieldValue
                            .split(/[,\n]/)
                            .map((item) => item.trim())
                            .filter(Boolean)
                            .map((item) => `    <g:${key}>${xmlEscape(item)}</g:${key}>`);
                    }

                    return [`    <g:${key}>${xmlEscape(fieldValue)}</g:${key}>`];
                })
                .join('\n');

            return [
                '  <item>',
                `    <link>${xmlEscape(link)}</link>`,
                gFields,
                '  </item>',
            ].filter(Boolean).join('\n');
        }).join('\n');

        return [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">',
            ' <channel>',
            `  <title>${xmlEscape(channelTitle)}</title>`,
            `  <description>${xmlEscape(`${channelTitle} generated by Overseek`)}</description>`,
            items,
            ' </channel>',
            '</rss>',
        ].join('\n');
    }

    static async getFeedExportCsv(
        accountId: string,
        channelInput: string,
        variationMode: VariationMode = 'automatic',
    ): Promise<string> {
        const channel = normalizeChannel(channelInput);
        const { rows, mappings } = await this.getFeedRows(accountId, channel, 1, Number.MAX_SAFE_INTEGER, '', variationMode);
        const headers = mappings.map((mapping) => mapping.targetField);
        const csvEscape = (value: string): string => `"${value.replace(/"/g, '""')}"`;
        const lines = rows.map((row) => {
            const values = new Map(
                (row.columns as Array<{ targetField: string; finalValue: string | null }>).map((column) => [
                    column.targetField,
                    column.targetField === 'description' ? stripHtml(column.finalValue) || '' : column.finalValue || '',
                ]),
            );
            return headers.map((header) => csvEscape(values.get(header) || '')).join(',');
        });

        return [headers.map(csvEscape).join(','), ...lines].join('\n');
    }

    static getRefreshModeOptions(): FeedRefreshMode[] {
        return [...ALLOWED_REFRESH_MODES];
    }

    static async getMaxBulkOptimizeRows(accountId: string): Promise<number> {
        const feature = await prisma.accountFeature.findUnique({
            where: { accountId_featureKey: { accountId, featureKey: FEED_FEATURE_KEY } },
            select: { config: true },
        });

        const config = (feature?.config || {}) as FeedFeatureConfig;
        const value = config.maxBulkOptimizeRows;
        if (typeof value === 'number' && Number.isFinite(value) && value >= 1) return Math.floor(value);
        return DEFAULT_MAX_BULK_OPTIMIZE_ROWS;
    }

    static async setMaxBulkOptimizeRows(accountId: string, limit: number): Promise<number> {
        const normalized = Math.max(1, Math.min(200000, Math.floor(limit)));
        const feature = await prisma.accountFeature.findUnique({
            where: { accountId_featureKey: { accountId, featureKey: FEED_FEATURE_KEY } },
            select: { config: true },
        });

        const existingConfig = (feature?.config || {}) as FeedFeatureConfig;
        const nextConfig: FeedFeatureConfig = {
            ...existingConfig,
            maxBulkOptimizeRows: normalized,
        };

        await prisma.accountFeature.upsert({
            where: { accountId_featureKey: { accountId, featureKey: FEED_FEATURE_KEY } },
            update: { config: nextConfig as unknown as Prisma.InputJsonValue },
            create: {
                accountId,
                featureKey: FEED_FEATURE_KEY,
                isEnabled: false,
                config: nextConfig as unknown as Prisma.InputJsonValue,
            },
        });

        return normalized;
    }

    static async getProductTypeCategoryPriority(accountId: string): Promise<string[]> {
        const feature = await prisma.accountFeature.findUnique({
            where: { accountId_featureKey: { accountId, featureKey: FEED_FEATURE_KEY } },
            select: { config: true },
        });
        const values = ((feature?.config || {}) as FeedFeatureConfig).productTypeCategoryPriority;
        return Array.isArray(values) ? values.filter((value): value is string => typeof value === 'string' && !!value.trim()) : [];
    }

    static async setProductTypeCategoryPriority(accountId: string, values: string[]): Promise<string[]> {
        const seen = new Set<string>();
        const normalized = values.map((value) => value.trim()).filter((value) => {
            const key = value.toLowerCase();
            if (!value || seen.has(key)) return false;
            seen.add(key);
            return true;
        });
        const feature = await prisma.accountFeature.findUnique({
            where: { accountId_featureKey: { accountId, featureKey: FEED_FEATURE_KEY } },
            select: { config: true },
        });
        const nextConfig: FeedFeatureConfig = {
            ...((feature?.config || {}) as FeedFeatureConfig),
            productTypeCategoryPriority: normalized,
        };

        await prisma.accountFeature.upsert({
            where: { accountId_featureKey: { accountId, featureKey: FEED_FEATURE_KEY } },
            update: { config: nextConfig as unknown as Prisma.InputJsonValue },
            create: {
                accountId,
                featureKey: FEED_FEATURE_KEY,
                isEnabled: false,
                config: nextConfig as unknown as Prisma.InputJsonValue,
            },
        });
        return normalized;
    }

    static async getProductFilters(accountId: string): Promise<FeedProductFilters> {
        const feature = await prisma.accountFeature.findUnique({
            where: { accountId_featureKey: { accountId, featureKey: FEED_FEATURE_KEY } },
            select: { config: true },
        });
        const config = (feature?.config || {}) as FeedFeatureConfig;
        return {
            excludeOutOfStockProducts: config.excludeOutOfStockProducts === true,
            excludeUnpublishedProducts: config.excludeUnpublishedProducts === true,
            backordersAsInStock: config.backordersAsInStock === true,
        };
    }

    static async getProductFeedExclusion(accountId: string, wooId: number): Promise<boolean> {
        const product = await prisma.wooProduct.findUnique({
            where: { accountId_wooId: { accountId, wooId } },
            select: { seoData: true },
        });
        if (!product) throw new Error('Product not found');
        return isProductExcludedFromFeeds(product.seoData);
    }

    static async setProductFeedExclusion(accountId: string, wooId: number, excluded: boolean): Promise<boolean> {
        const product = await prisma.wooProduct.findUnique({
            where: { accountId_wooId: { accountId, wooId } },
            select: { seoData: true },
        });
        if (!product) throw new Error('Product not found');

        const seoData = (product.seoData || {}) as Record<string, unknown>;
        await prisma.wooProduct.update({
            where: { accountId_wooId: { accountId, wooId } },
            data: {
                seoData: {
                    ...seoData,
                    excludeFromProductFeeds: excluded,
                },
            },
        });
        return excluded;
    }

    static async setProductFilters(accountId: string, filters: FeedProductFilters): Promise<FeedProductFilters> {
        const normalized: FeedProductFilters = {
            excludeOutOfStockProducts: filters.excludeOutOfStockProducts === true,
            excludeUnpublishedProducts: filters.excludeUnpublishedProducts === true,
            backordersAsInStock: filters.backordersAsInStock === true,
        };
        const feature = await prisma.accountFeature.findUnique({
            where: { accountId_featureKey: { accountId, featureKey: FEED_FEATURE_KEY } },
            select: { config: true },
        });
        const nextConfig: FeedFeatureConfig = {
            ...((feature?.config || {}) as FeedFeatureConfig),
            ...normalized,
        };

        await prisma.accountFeature.upsert({
            where: { accountId_featureKey: { accountId, featureKey: FEED_FEATURE_KEY } },
            update: { config: nextConfig as unknown as Prisma.InputJsonValue },
            create: {
                accountId,
                featureKey: FEED_FEATURE_KEY,
                isEnabled: false,
                config: nextConfig as unknown as Prisma.InputJsonValue,
            },
        });
        return normalized;
    }

    static async getMappings(accountId: string, channelInput: string): Promise<FeedFieldMapping[]> {
        const channel = normalizeChannel(channelInput);
        const feature = await prisma.accountFeature.findUnique({
            where: { accountId_featureKey: { accountId, featureKey: FEED_FEATURE_KEY } },
            select: { config: true }
        });

        const config = (feature?.config || {}) as FeedFeatureConfig;
        return mergeMappingsWithDefaults(channel, config.mappings?.[channel]);
    }

    static async saveMappings(accountId: string, channelInput: string, mappings: FeedFieldMapping[]): Promise<FeedFieldMapping[]> {
        const channel = normalizeChannel(channelInput);
        const feature = await prisma.accountFeature.findUnique({
            where: { accountId_featureKey: { accountId, featureKey: FEED_FEATURE_KEY } },
            select: { config: true }
        });

        const existingConfig = (feature?.config || {}) as FeedFeatureConfig;
        const currentMappings = mergeMappingsWithDefaults(channel, existingConfig.mappings?.[channel]);
        const currentLockedMappings = new Map(
            currentMappings
                .filter((mapping) => LOCKED_FEED_FIELDS.has(mapping.targetField))
                .map((mapping) => [mapping.targetField, mapping]),
        );
        const sanitizedMappings = mappings
            .filter((mapping) => channel !== 'google'
                || (!GOOGLE_LOCAL_INVENTORY_FIELDS.has(mapping.targetField)
                    && !GOOGLE_LOCAL_INVENTORY_SOURCES.has(mapping.sourceField)))
            .map((mapping) => currentLockedMappings.get(mapping.targetField) || mapping);

        const nextConfig: FeedFeatureConfig = {
            ...existingConfig,
            mappings: {
                ...(existingConfig.mappings || {}),
                [channel]: sanitizedMappings,
            },
        };

        await prisma.accountFeature.upsert({
            where: { accountId_featureKey: { accountId, featureKey: FEED_FEATURE_KEY } },
            update: { config: nextConfig as unknown as Prisma.InputJsonValue },
            create: {
                accountId,
                featureKey: FEED_FEATURE_KEY,
                isEnabled: false,
                config: nextConfig as unknown as Prisma.InputJsonValue,
            },
        });

        return sanitizedMappings;
    }

    static async getRefreshMode(accountId: string, channelInput: string): Promise<FeedRefreshMode> {
        const channel = normalizeChannel(channelInput);
        const feature = await prisma.accountFeature.findUnique({
            where: { accountId_featureKey: { accountId, featureKey: FEED_FEATURE_KEY } },
            select: { config: true },
        });

        const config = (feature?.config || {}) as FeedFeatureConfig;
        return config.refreshModes?.[channel] || DEFAULT_REFRESH_MODE;
    }

    static async setRefreshMode(accountId: string, channelInput: string, refreshModeInput: string): Promise<FeedRefreshMode> {
        const channel = normalizeChannel(channelInput);
        const refreshMode = this.parseRefreshMode(refreshModeInput);

        const feature = await prisma.accountFeature.findUnique({
            where: { accountId_featureKey: { accountId, featureKey: FEED_FEATURE_KEY } },
            select: { config: true },
        });

        const existingConfig = (feature?.config || {}) as FeedFeatureConfig;
        const nextConfig: FeedFeatureConfig = {
            ...existingConfig,
            refreshModes: {
                ...(existingConfig.refreshModes || {}),
                [channel]: refreshMode,
            },
        };

        await prisma.accountFeature.upsert({
            where: { accountId_featureKey: { accountId, featureKey: FEED_FEATURE_KEY } },
            update: { config: nextConfig as unknown as Prisma.InputJsonValue },
            create: {
                accountId,
                featureKey: FEED_FEATURE_KEY,
                isEnabled: false,
                config: nextConfig as unknown as Prisma.InputJsonValue,
            },
        });

        return refreshMode;
    }

    static async getFeedRows(
        accountId: string,
        channelInput: string,
        page: number,
        limit: number,
        query: string,
        variationMode: VariationMode,
        productWooId?: number,
        includeHealth = false,
        groupVariants = false,
    ): Promise<{ total: number; rows: any[]; mappings: FeedFieldMapping[]; groups?: any[]; health?: FeedScanHealth }> {
        const channel = normalizeChannel(channelInput);
        const automaticVariants = variationMode === 'automatic' && (channel === 'google' || channel === 'meta');
        const grouped = groupVariants && automaticVariants;
        const [mappings, categoryPriority, productFilters] = await Promise.all([
            this.getMappings(accountId, channel),
            this.getProductTypeCategoryPriority(accountId),
            this.getProductFilters(accountId),
        ]);

        if (productWooId !== undefined) {
            Object.assign(productFilters, DEFAULT_PRODUCT_FILTERS);
        }
        const overrideBackorders = productFilters.backordersAsInStock === true && (channel === 'google' || channel === 'meta');

        const where: any = { accountId };
        if (productWooId) {
            where.wooId = productWooId;
        } else if (query) {
            where.OR = [
                { name: { contains: query, mode: 'insensitive' } },
                { sku: { contains: query, mode: 'insensitive' } },
            ];
        }

        const includeParents = variationMode === 'variable_parent' || variationMode === 'variable_and_variations';
        const includeVariations = variationMode !== 'variable_parent';

        const account = await prisma.account.findUnique({
            where: { id: accountId },
            select: { name: true, currency: true, timezone: true },
        });

        const health: FeedScanHealth = {
            generatedAt: new Date().toISOString(), scannedProducts: 0, included: 0, excluded: 0,
            exclusions: {}, errors: 0, warnings: 0, issues: [], excludedExamples: [],
        };
        const exclude = (rowId: string, name: string, reason: string) => {
            if (!includeHealth) return;
            health.excluded++;
            health.exclusions[reason] = (health.exclusions[reason] || 0) + 1;
            if (health.excludedExamples.length < 50) health.excludedExamples.push({ rowId, name, reason });
        };
        const rows: any[] = [];
        let total = 0;
        let includedRows = 0;
        let previousWooId: number | undefined;
        const groups = new Map<number, any>();
        const start = (page - 1) * limit;
        const gtins = new Map<string, string>();
        const buildProductRows = (originalProduct: any) => {
            health.scannedProducts++;
            const product = withFeedAvailability(originalProduct, overrideBackorders);

            const productRawData = product.rawData as any;
            const isVariableProduct = isFeedVariable(product);
            const selectedVariations = selectFeedVariations(product.variations || [], productRawData, variationMode);
            const exclusion = productWooId === undefined && isProductExcludedFromFeeds(product.seoData) ? 'Explicit product exclusion'
                : productFilters.excludeUnpublishedProducts && !isPublished(product) ? 'Unpublished product' : null;
            if (exclusion) {
                if (includeParents || !isVariableProduct) exclude(`p:${product.wooId}`, product.name, exclusion);
                selectedVariations.forEach((v) => exclude(`v:${product.wooId}-${v.wooId}`, product.name, exclusion));
                return [];
            }
            if (automaticVariants && isVariableProduct && selectedVariations.length === 0) {
                exclude(`p:${product.wooId}`, product.name, 'Missing synced variations');
                if (includeHealth) {
                    health.errors++;
                    if (health.issues.length < 100) health.issues.push({ severity: 'error', field: 'id', code: 'missing_variations', message: 'This is a variable product, but its variations have not been synced. Sync Woo products/variations; no purchasable parent or variant combinations were invented.', rowId: `p:${product.wooId}`, wooId: product.wooId, name: product.name });
                }
                return [];
            }
            const overrides = getFeedOverrides(product.seoData, channel);
            const aiSuggestions = getFeedAiSuggestions(product.seoData, channel);
            const googleOverrides = channel === 'google' ? overrides : getFeedOverrides(product.seoData, 'google');
            const googleAiSuggestions = channel === 'google' ? aiSuggestions : getFeedAiSuggestions(product.seoData, 'google');
            const sharedOverrides = getSharedFeedOverrides(product.seoData);
            const sharedAiSuggestions = getSharedFeedAiSuggestions(product.seoData);
            const mapColumns = (valueReader: (sourceField: string) => string | null, overridePrefix?: string) => {
                const columns = mappings.map((mapping) => {
                    const raw = valueReader(mapping.sourceField);
                    // An absent Woo sale is intentional; a regular-price fallback invents a sale.
                    const absentWooSale = (channel === 'google' || channel === 'meta')
                        && mapping.targetField === 'sale_price' && mapping.sourceField === 'salePrice' && !raw;
                    const fallback = mapping.fallbackSourceField && !absentWooSale ? valueReader(mapping.fallbackSourceField) : null;
                    const mapped = raw || fallback;
                    const overrideKey = overridePrefix ? `${overridePrefix}:${mapping.targetField}` : mapping.targetField;
                    const isSharedRewrite = SHARED_REWRITE_FIELDS.has(mapping.targetField);
                    const override = (isSharedRewrite ? sharedOverrides[overrideKey] : null)
                        || overrides[overrideKey]
                        || (isSharedRewrite ? googleOverrides[overrideKey] : null)
                        || null;
                    const aiSuggestedValue = (isSharedRewrite ? sharedAiSuggestions[overrideKey] : null)
                        || aiSuggestions[overrideKey]
                        || (isSharedRewrite ? googleAiSuggestions[overrideKey] : null)
                        || null;
                    // Specific variant copy wins; otherwise a product description is shared by siblings.
                    const inheritsDescription = !!overridePrefix && mapping.targetField === 'description';
                    const inheritedOverride = inheritsDescription
                        ? sharedOverrides.description || overrides.description || googleOverrides.description : null;
                    const inheritedSuggestion = inheritsDescription
                        ? sharedAiSuggestions.description || aiSuggestions.description || googleAiSuggestions.description : null;
                    const useParentSource = inheritsDescription && product.seoData?.feedDescriptionInheritance?.[overridePrefix] === true;
                    const parentMapped = useParentSource
                        ? getSourceValue(mapping.sourceField, product, account || undefined, categoryPriority, channel)
                            || (mapping.fallbackSourceField ? getSourceValue(mapping.fallbackSourceField, product, account || undefined, categoryPriority, channel) : null)
                        : null;
                    const finalValue = override || aiSuggestedValue || inheritedOverride || inheritedSuggestion || (useParentSource ? parentMapped : mapped);

                    return {
                        targetField: mapping.targetField,
                        sourceField: mapping.sourceField,
                        required: !!mapping.required,
                        rawValue: raw,
                        fallbackValue: fallback,
                        mappedValue: mapped,
                        aiSuggestedValue,
                        overrideValue: override,
                        finalValue,
                        isMissingRequired: !!mapping.required && !finalValue,
                    };
                });
                const availability = columns.find((column) => column.targetField === 'availability')?.finalValue;
                if (channel === 'google' && !['backorder', 'preorder'].includes(availability || '')) {
                    const date = columns.find((column) => column.targetField === 'availability_date');
                    if (date && (!date.overrideValue && !date.aiSuggestedValue || overrideBackorders)) date.finalValue = null;
                }
                return columns;
            };

            const productRows: any[] = [];
            const siblingFields = [...new Set<string>((product.variations || [])
                .flatMap((variation: any) => resolvedVariantRaw(variation.rawData, productRawData).attributes)
                .map(variantAttributeField).filter(Boolean))];
            const parentOutOfStock = isOutOfStock(product.stockStatus || productRawData?.stock_status);
            if ((includeParents || !isVariableProduct) && !(productFilters.excludeOutOfStockProducts && parentOutOfStock)) {
                productRows.push({
                    rowType: 'parent',
                    rowId: `p:${product.wooId}`,
                    wooId: product.wooId,
                    sku: product.sku,
                    name: product.name,
                    channel,
                    columns: mapColumns((sourceField) => getSourceValue(sourceField, product, account || undefined, categoryPriority, channel)),
                });
            } else if (includeParents || !isVariableProduct) {
                exclude(`p:${product.wooId}`, product.name, 'Out of stock');
            }

            if (includeVariations && Array.isArray(product.variations) && product.variations.length > 0) {
                selectedVariations.forEach((originalVariation: any) => {
                    if (automaticVariants && originalVariation.rawData?.status && originalVariation.rawData.status !== 'publish') {
                        exclude(`v:${product.wooId}-${originalVariation.wooId}`, product.name, 'Disabled or unpublished variation');
                        return;
                    }
                    const variation = withFeedAvailability(originalVariation, overrideBackorders, originalProduct);
                    const variationOutOfStock = isOutOfStock(
                        variation.stockStatus || variation.rawData?.stock_status || product.stockStatus || productRawData?.stock_status,
                    );
                    if (productFilters.excludeOutOfStockProducts && variationOutOfStock) {
                        exclude(`v:${product.wooId}-${variation.wooId}`, product.name, 'Out of stock');
                        return;
                    }
                    const variationId = `${product.wooId}-${variation.wooId}`;
                    productRows.push({
                        rowType: 'variation',
                        rowId: `v:${variationId}`,
                        wooId: product.wooId,
                        variationWooId: variation.wooId,
                        sku: variation.sku || product.sku,
                        name: getVariationSourceValue('name', variation, product),
                        channel,
                        // Automatic Google/Meta offers share the product title; dimensions stay in variant fields.
                        // Keep the descriptive row name above for identifying siblings in the editor.
                        columns: mapColumns((sourceField) => automaticVariants && sourceField === 'name'
                            ? getSourceValue(sourceField, product, account || undefined, categoryPriority, channel)
                            : getVariationSourceValue(sourceField, variation, product, account || undefined, categoryPriority, channel), variationId),
                    });
                });
            }

            const groupParent = grouped && isVariableProduct ? {
                rowId: `g:${product.wooId}`, rowType: 'group', wooId: product.wooId,
                name: product.name, sku: product.sku, columns: mapColumns((sourceField) => getSourceValue(sourceField, product, account || undefined, categoryPriority, channel)),
            } : null;
            for (const row of productRows) {
                if (groupParent) row.groupParent = groupParent;
                const original = row.variationWooId ? originalProduct.variations.find((v: any) => v.wooId === row.variationWooId) : originalProduct;
                row.sourceStockStatus = normalizeStockStatus(original?.stockStatus || original?.rawData?.stock_status || originalProduct.stockStatus);
                row.availabilityOverridden = overrideBackorders && row.sourceStockStatus !== 'in_stock'
                    && row.columns.find((column: any) => column.targetField === 'availability')?.finalValue === channelAvailability('in_stock', channel);
                row.invalidSaleWindow = feedPricing(original || {}, account?.timezone || 'UTC').invalidSaleWindow;
                row.variantIssues = row.variationWooId ? variantIssues(original, originalProduct, row.columns, channel, siblingFields) : [];
            }
            return productRows;
        };

        for await (const products of feedProductBatches({
            where,
            select: {
                id: true, wooId: true, name: true, sku: true, price: true, status: true,
                stockStatus: true, permalink: true, mainImage: true, rawData: true, seoData: true,
                variations: includeVariations ? {
                    select: { wooId: true, sku: true, price: true, stockStatus: true, rawData: true },
                    orderBy: { wooId: 'asc' },
                } : false,
            },
        })) {
            const batchRows = products.flatMap(buildProductRows);
            const filteredRows = query
                ? batchRows.filter((row: any) => {
                    const q = query.toLowerCase();
                    return (row.name || '').toLowerCase().includes(q) || (row.sku || '').toLowerCase().includes(q);
                })
                : batchRows;
            for (const row of filteredRows) {
                if (!grouped || previousWooId !== row.wooId) total++;
                previousWooId = row.wooId;
                includedRows++;
                const onPage = total - 1 >= start && total - 1 < start + limit;
                if (includeHealth || onPage) {
                    row.issues = validateFeedColumns(channel, row.columns);
                    row.issues.push(...row.variantIssues);
                    if (row.availabilityOverridden) row.issues.push({ severity: 'warning', field: 'availability', code: 'backorder_override', message: `Feed reports in stock, but synced Woo status is ${row.sourceStockStatus}. Check website availability, structured data and delivery promises; the live page has not been checked.` });
                    if (row.invalidSaleWindow && (channel === 'google' || channel === 'meta')) row.issues.push({ severity: 'warning', field: 'sale_price_effective_date', code: 'invalid_woo_sale_dates', message: 'Woo sale dates are invalid or reversed. No automatic sale price was exported.' });
                    if (includeHealth) {
                        const gtin = row.columns.find((column: any) => column.targetField === 'gtin')?.finalValue;
                        if (gtin && gtins.has(gtin)) row.issues.push({ severity: 'warning', field: 'gtin', code: 'duplicate_gtin', message: `GTIN is also used by ${gtins.get(gtin)}. Distinct variants must not share a barcode.` });
                        else if (gtin) gtins.set(gtin, row.rowId);
                        for (const issue of row.issues as FeedIssue[]) {
                            if (issue.severity === 'error') health.errors++; else health.warnings++;
                            if (health.issues.length < 100) health.issues.push({ ...issue, rowId: row.rowId, wooId: row.wooId, variationWooId: row.variationWooId, name: row.name });
                        }
                    }
                }
                if (onPage) {
                    if (row.groupParent) groups.set(row.wooId, row.groupParent);
                    delete row.groupParent;
                    rows.push(row);
                }
            }
        }
        health.included = includedRows;
        return { total, rows, mappings, ...(grouped ? { groups: [...groups.values()] } : {}), ...(includeHealth ? { health } : {}) };
    }

    static async getFeedRowRefs(
        accountId: string,
        channelInput: string,
        query: string,
        variationMode: VariationMode,
    ): Promise<{ total: number; rows: Array<{ rowId: string; wooId: number; variationWooId?: number }> }> {
        const channel = normalizeChannel(channelInput);
        const automaticVariants = variationMode === 'automatic' && (channel === 'google' || channel === 'meta');
        const productFilters = await this.getProductFilters(accountId);
        const overrideBackorders = productFilters.backordersAsInStock === true && (channel === 'google' || channel === 'meta');

        const where: any = { accountId };
        if (query) {
            where.OR = [
                { name: { contains: query, mode: 'insensitive' } },
                { sku: { contains: query, mode: 'insensitive' } },
            ];
        }

        const includeParents = variationMode === 'variable_parent' || variationMode === 'variable_and_variations';
        const includeVariations = variationMode !== 'variable_parent';

        const rows: Array<{ rowId: string; wooId: number; variationWooId?: number }> = [];
        const collectRefs = (originalProduct: any) => {
            const product = withFeedAvailability(originalProduct, overrideBackorders);
            const out: Array<{ rowId: string; wooId: number; variationWooId?: number }> = [];
            const productRawData = product.rawData as any;
            if (isProductExcludedFromFeeds(product.seoData)) return out;
            if (productFilters.excludeUnpublishedProducts && !isPublished(product)) return out;
            const isVariableProduct = isFeedVariable(product);
            const parentOutOfStock = isOutOfStock(product.stockStatus || productRawData?.stock_status);
            if ((includeParents || !isVariableProduct) && !(productFilters.excludeOutOfStockProducts && parentOutOfStock)) {
                out.push({ rowId: `p:${product.wooId}`, wooId: product.wooId });
            }

            if (includeVariations && Array.isArray(product.variations) && product.variations.length > 0) {
                const selectedVariations = selectFeedVariations(product.variations, productRawData, variationMode);
                selectedVariations.forEach((originalVariation: any) => {
                    if (automaticVariants && originalVariation.rawData?.status && originalVariation.rawData.status !== 'publish') return;
                    const variation = withFeedAvailability(originalVariation, overrideBackorders, originalProduct);
                    const variationOutOfStock = isOutOfStock(
                        variation.stockStatus || variation.rawData?.stock_status || product.stockStatus || productRawData?.stock_status,
                    );
                    if (productFilters.excludeOutOfStockProducts && variationOutOfStock) return;
                    const variationId = `${product.wooId}-${variation.wooId}`;
                    out.push({
                        rowId: `v:${variationId}`,
                        wooId: product.wooId,
                        variationWooId: variation.wooId,
                    });
                });
            }

            return out;
        };
        for await (const products of feedProductBatches({
            where,
            select: {
                id: true, wooId: true, status: true, stockStatus: true, seoData: true, rawData: true,
                variations: includeVariations ? {
                    select: { wooId: true, stockStatus: true, rawData: true },
                    orderBy: { wooId: 'asc' },
                } : false,
            },
        })) {
            rows.push(...products.flatMap(collectRefs));
        }

        return { total: rows.length, rows };
    }

    static async saveRowOverrides(
        accountId: string,
        channelInput: string,
        wooId: number,
        fields: Record<string, string | null>,
    ): Promise<void> {
        const channel = normalizeChannel(channelInput);
        const product = await prisma.wooProduct.findUnique({
            where: { accountId_wooId: { accountId, wooId } },
            select: { seoData: true },
        });

        if (!product) {
            throw new Error('Product not found');
        }

        const seoData = (product.seoData || {}) as any;
        const feedOverrides = (seoData.feedOverrides || {}) as Record<string, any>;
        const currentChannelOverrides = (feedOverrides[channel] || {}) as Record<string, string>;
        const sharedOverrides = (feedOverrides.shared || {}) as Record<string, string>;
        const feedAiSuggestions = (seoData.feedAiSuggestions || {}) as Record<string, any>;
        const descriptionInheritance = { ...(seoData.feedDescriptionInheritance || {}) };
        let resetVariantDescription = false;
        let changedDescriptionInheritance = false;

        Object.entries(fields).forEach(([key, value]) => {
            const baseField = getBaseTargetField(key);
            if (LOCKED_FEED_FIELDS.has(baseField)) return;
            if (baseField === 'description' && key.includes(':')) {
                const prefix = key.slice(0, key.lastIndexOf(':'));
                changedDescriptionInheritance = true;
                if (value == null || value.trim() === '') descriptionInheritance[prefix] = true;
                else delete descriptionInheritance[prefix];
            }
            // Clearing a variant description explicitly restores inheritance, including old AI copy.
            if (baseField === 'description' && key.includes(':') && (value == null || value.trim() === '')) {
                resetVariantDescription = true;
                delete feedAiSuggestions.shared?.[key];
                FEED_CHANNELS.forEach((feedChannel) => delete feedAiSuggestions[feedChannel]?.[key]);
            }

            if (SHARED_REWRITE_FIELDS.has(baseField)) {
                if (value == null || value.trim() === '') delete sharedOverrides[key];
                else sharedOverrides[key] = value;
                FEED_CHANNELS.forEach((feedChannel) => delete feedOverrides[feedChannel]?.[key]);
                return;
            }

            if (value == null || value.trim() === '') {
                delete currentChannelOverrides[key];
            } else {
                currentChannelOverrides[key] = value;
            }
        });

        feedOverrides[channel] = currentChannelOverrides;
        feedOverrides.shared = sharedOverrides;

        await prisma.wooProduct.update({
            where: { accountId_wooId: { accountId, wooId } },
            data: {
                seoData: {
                    ...seoData,
                    feedOverrides,
                    ...(resetVariantDescription ? { feedAiSuggestions } : {}),
                    ...(changedDescriptionInheritance ? { feedDescriptionInheritance: descriptionInheritance } : {}),
                }
            },
        });
    }

    static async optimizeRowFields(
        accountId: string,
        channelInput: string,
        wooId: number,
        fields: string[],
        variationWooId?: number,
    ): Promise<Record<string, string>> {
        const channel = normalizeChannel(channelInput);
        const product = await prisma.wooProduct.findUnique({
            where: { accountId_wooId: { accountId, wooId } },
            select: {
                wooId: true,
                name: true,
                price: true,
                stockStatus: true,
                permalink: true,
                mainImage: true,
                rawData: true,
                seoData: true,
                variations: {
                    select: { wooId: true, price: true, stockStatus: true, rawData: true },
                },
            },
        });

        if (!product) throw new Error('Product not found');

        const account = await prisma.account.findUnique({
            where: { id: accountId },
            select: { openRouterApiKey: true, aiModel: true },
        });
        if (!account?.openRouterApiKey) {
            throw new Error('No OpenRouter API key configured');
        }

        const mappings = await this.getMappings(accountId, channel);
        const rowPrefix = variationWooId ? `${wooId}-${variationWooId}` : undefined;
        const variation = variationWooId
            ? product.variations.find((v) => v.wooId === variationWooId)
            : null;
        if (variationWooId && !variation) throw new Error('Variation not found');

        const rowData = mappings
            .filter((m) => fields.includes(m.targetField))
            .map((m) => {
                const raw = variation
                    ? getVariationSourceValue(m.sourceField, variation, product)
                    : getSourceValue(m.sourceField, product);
                const fallback = m.fallbackSourceField
                    ? (variation
                        ? getVariationSourceValue(m.fallbackSourceField, variation, product)
                        : getSourceValue(m.fallbackSourceField, product))
                    : null;
                return { targetField: m.targetField, value: raw || fallback || '' };
            });

        const prompt = [
            'Optimize shared product feed fields for Google, Meta, Pinterest, and similar shopping platforms.',
            'Rules: keep factual claims only, no emojis, concise, and compliant across every platform.',
            'Character limits: title 150, description 5000.',
            'Return valid JSON object with only requested fields as keys.',
            `Requested fields: ${fields.join(', ')}`,
            `Current values: ${JSON.stringify(rowData)}`,
        ].join('\n');

        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${account.openRouterApiKey}`,
                'HTTP-Referer': process.env.APP_URL || 'http://localhost:5173',
                'X-Title': `${process.env.APP_NAME || 'Overseek'} Feed Optimizer`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: account.aiModel || 'openai/gpt-4o-mini',
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.3,
                max_tokens: 1200,
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            Logger.error('OpenRouter API error during feed optimize', { status: response.status, error: errorText });
            throw new Error(`OpenRouter API error (${response.status})`);
        }

        const data = await response.json();
        const content = data?.choices?.[0]?.message?.content || '{}';
        const jsonMatch = String(content).match(/\{[\s\S]*\}/);
        const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {};

        const cleanSuggestions: Record<string, string> = {};
        for (const field of fields) {
            const value = parsed?.[field];
            if (typeof value === 'string' && value.trim()) {
                const trimmedValue = value.trim();
                const characterLimit = getFeedFieldCharacterLimit(field);
                if (characterLimit == null || trimmedValue.length <= characterLimit) {
                    cleanSuggestions[field] = trimmedValue;
                }
            }
        }

        const seoData = (product.seoData || {}) as any;
        const feedAiSuggestions = (seoData.feedAiSuggestions || {}) as Record<string, any>;
        const channelMap = (feedAiSuggestions[channel] || {}) as Record<string, string>;
        const sharedMap = (feedAiSuggestions.shared || {}) as Record<string, string>;

        for (const [field, value] of Object.entries(cleanSuggestions)) {
            const key = rowPrefix ? `${rowPrefix}:${field}` : field;
            if (SHARED_REWRITE_FIELDS.has(field)) {
                sharedMap[key] = value;
                FEED_CHANNELS.forEach((feedChannel) => delete feedAiSuggestions[feedChannel]?.[key]);
            } else {
                channelMap[key] = value;
            }
        }

        feedAiSuggestions[channel] = channelMap;
        feedAiSuggestions.shared = sharedMap;

        await prisma.wooProduct.update({
            where: { accountId_wooId: { accountId, wooId } },
            data: {
                seoData: {
                    ...seoData,
                    feedAiSuggestions,
                },
            },
        });

        return cleanSuggestions;
    }

    static async optimizeRowsBulk(
        accountId: string,
        channelInput: string,
        fields: string[],
        rows: Array<{ wooId: number; variationWooId?: number }>,
    ): Promise<{
        total: number;
        succeeded: number;
        failed: number;
        results: Array<{
            wooId: number;
            variationWooId?: number;
            success: boolean;
            suggestions?: Record<string, string>;
            error?: string;
        }>;
    }> {
        const channel = normalizeChannel(channelInput);
        const results: Array<{
            wooId: number;
            variationWooId?: number;
            success: boolean;
            suggestions?: Record<string, string>;
            error?: string;
        }> = [];

        for (const row of rows) {
            try {
                const suggestions = await this.optimizeRowFields(
                    accountId,
                    channel,
                    row.wooId,
                    fields,
                    row.variationWooId,
                );
                results.push({
                    wooId: row.wooId,
                    variationWooId: row.variationWooId,
                    success: true,
                    suggestions,
                });
            } catch (error: any) {
                results.push({
                    wooId: row.wooId,
                    variationWooId: row.variationWooId,
                    success: false,
                    error: error?.message || 'Failed to optimize row',
                });
            }
        }

        const succeeded = results.filter((r) => r.success).length;
        const failed = results.length - succeeded;

        return {
            total: results.length,
            succeeded,
            failed,
            results,
        };
    }

    static async processOptimizeBulkJob(
        payload: {
            accountId: string;
            channel: string;
            fields: string[];
            rows: Array<{ wooId: number; variationWooId?: number }>;
            sharedDescriptions?: boolean;
        },
        job: Job,
    ): Promise<{
        total: number;
        succeeded: number;
        failed: number;
        results: Array<{
            wooId: number;
            variationWooId?: number;
            success: boolean;
            suggestions?: Record<string, string>;
            error?: string;
        }>;
    }> {
        const { accountId, channel, fields, rows } = payload;
        const normalizedChannel = normalizeChannel(channel);

        const results: Array<{
            wooId: number;
            variationWooId?: number;
            success: boolean;
            suggestions?: Record<string, string>;
            error?: string;
        }> = [];

        const total = rows.length;
        const sharedDescriptions = new Map<number, Record<string, string>>();
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            try {
                const shareDescription = payload.sharedDescriptions && fields.includes('description') && !!row.variationWooId;
                if (shareDescription && !sharedDescriptions.has(row.wooId)) {
                    sharedDescriptions.set(row.wooId, await this.optimizeRowFields(accountId, normalizedChannel, row.wooId, ['description']));
                }
                const rowFields = shareDescription ? fields.filter((field) => field !== 'description') : fields;
                const suggestions = {
                    ...(shareDescription ? sharedDescriptions.get(row.wooId) : {}),
                    ...(rowFields.length ? await this.optimizeRowFields(
                        accountId,
                        normalizedChannel,
                        row.wooId,
                        rowFields,
                        row.variationWooId,
                    ) : {}),
                };
                results.push({
                    wooId: row.wooId,
                    variationWooId: row.variationWooId,
                    success: true,
                    suggestions,
                });
            } catch (error: any) {
                results.push({
                    wooId: row.wooId,
                    variationWooId: row.variationWooId,
                    success: false,
                    error: error?.message || 'Failed to optimize row',
                });
            }

            const completed = i + 1;
            const pct = Math.round((completed / total) * 100);
            await job.updateProgress({ completed, total, pct });
        }

        const succeeded = results.filter((r) => r.success).length;
        const failed = total - succeeded;

        return { total, succeeded, failed, results };
    }
}
