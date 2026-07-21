import { prisma } from '../utils/prisma';
import type { Prisma } from '@prisma/client';
import { Logger } from '../utils/logger';
import type { Job } from 'bullmq';
import crypto from 'crypto';
import { getFeedFieldCharacterLimit } from '../utils/feedFieldLimits';

export const FEED_FEATURE_KEY = 'FEED_EXPORTS';

export type FeedChannel = 'google' | 'meta' | 'pinterest' | 'similar';
export type VariationMode =
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

interface FeedFeatureConfig {
    mappings?: Partial<Record<FeedChannel, FeedFieldMapping[]>>;
    refreshModes?: Partial<Record<FeedChannel, FeedRefreshMode>>;
    maxBulkOptimizeRows?: number;
    productTypeCategoryPriority?: string[];
}

interface FeedAccountContext {
    name?: string | null;
    currency?: string | null;
}

const DEFAULT_REFRESH_MODE: FeedRefreshMode = 'manual';
const ALLOWED_REFRESH_MODES: FeedRefreshMode[] = ['manual', 'auto_on_sync', '1h', '3h', '12h', '24h'];
const DEFAULT_MAX_BULK_OPTIMIZE_ROWS = 5000;
const LOCKED_FEED_FIELDS = new Set(['id', 'mpn', 'sku']);
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
        { targetField: 'sale_price', sourceField: 'salePrice', fallbackSourceField: 'price' },
        { targetField: 'sale_price_effective_date', sourceField: 'salePriceEffectiveDate' },
        { targetField: 'availability', sourceField: 'stockStatus', required: true },
        { targetField: 'brand', sourceField: 'brand' },
        { targetField: 'canonical_link', sourceField: 'canonicalLink' },
        { targetField: 'custom_label_0', sourceField: 'name' },
        { targetField: 'store_code', sourceField: 'storeCode' },
        { targetField: 'identifier_exists', sourceField: 'identifierExists' },
    ],
    meta: [
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
        || getRawMetaValue(rawData, ['video_link', '_video_link', 'video_url', '_video_url', 'product_video_url', '_product_video_url']);

    if (direct) return String(direct);

    if (Array.isArray(rawData?.videos)) {
        const video = rawData.videos.find((item: any) => item?.src || item?.url || item?.video_url || item?.video_link);
        return video ? String(video.src || video.url || video.video_url || video.video_link) : null;
    }

    return null;
}

function mergeMappingsWithDefaults(channel: FeedChannel, mappings?: FeedFieldMapping[]): FeedFieldMapping[] {
    if (!mappings || mappings.length === 0) return DEFAULT_MAPPINGS[channel];

    const savedByTarget = new Map(mappings.map((mapping) => [mapping.targetField, mapping]));
    const merged = DEFAULT_MAPPINGS[channel].map((defaultMapping) => savedByTarget.get(defaultMapping.targetField) || defaultMapping);
    const defaultTargets = new Set(DEFAULT_MAPPINGS[channel].map((mapping) => mapping.targetField));
    const customMappings = mappings.filter((mapping) => !defaultTargets.has(mapping.targetField));

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

function getSourceValue(sourceField: string, product: any, account?: FeedAccountContext, categoryPriority: string[] = []): string | null {
    switch (sourceField) {
        case 'wooId': return String(product.wooId);
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
            return normalizeStockStatus(status);
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
        case 'storeCode': return '1';
        case 'identifierExists': return 'yes';
        default: return null;
    }
}

function getVariationSourceValue(sourceField: string, variation: any, parent: any, account?: FeedAccountContext, categoryPriority: string[] = []): string | null {
    switch (sourceField) {
        case 'wooId': return `${parent.wooId}-${variation.wooId}`;
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
        case 'videoLink': return getVideoLink(variation.rawData) || getVideoLink(parent.rawData);
        case 'price': return formatFeedPrice(variation.price ?? variation.rawData?.price ?? parent.price ?? parent.rawData?.price, account?.currency);
        case 'stockStatus': {
            const status = variation.stockStatus || variation.rawData?.stock_status || parent.stockStatus || parent.rawData?.stock_status;
            return normalizeStockStatus(status);
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
        case 'storeCode': return '1';
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

function getFeedAiSuggestions(seoData: any, channel: FeedChannel): Record<string, string> {
    if (!seoData || typeof seoData !== 'object') return {};
    const suggestions = seoData.feedAiSuggestions;
    if (!suggestions || typeof suggestions !== 'object') return {};
    const channelSuggestions = suggestions[channel];
    if (!channelSuggestions || typeof channelSuggestions !== 'object') return {};
    return channelSuggestions as Record<string, string>;
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
        variationMode: VariationMode = 'all_variations',
    ): Promise<string> {
        const channel = normalizeChannel(channelInput);
        const { rows } = await this.getFeedRows(accountId, channel, 1, 1000000, '', variationMode);

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
        const sanitizedMappings = mappings.map((mapping) => currentLockedMappings.get(mapping.targetField) || mapping);

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
    ): Promise<{ total: number; rows: any[]; mappings: FeedFieldMapping[] }> {
        const channel = normalizeChannel(channelInput);
        const [mappings, categoryPriority] = await Promise.all([
            this.getMappings(accountId, channel),
            this.getProductTypeCategoryPriority(accountId),
        ]);

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
            select: { name: true, currency: true },
        });

        const products = await prisma.wooProduct.findMany({
                where,
                select: {
                    id: true,
                    wooId: true,
                    name: true,
                    sku: true,
                    price: true,
                    stockStatus: true,
                    permalink: true,
                    mainImage: true,
                    rawData: true,
                    seoData: true,
                    variations: includeVariations ? {
                        select: {
                            wooId: true,
                            sku: true,
                            price: true,
                            stockStatus: true,
                            rawData: true,
                        },
                        orderBy: { wooId: 'asc' },
                    } : false,
                },
                orderBy: { updatedAt: 'desc' },
            });

        const rows = products.flatMap((product) => {
            const productRawData = product.rawData as any;
            const hasVariations = Array.isArray(product.variations) && product.variations.length > 0;
            const isVariableProduct = String(productRawData?.type || '').includes('variable')
                || (Array.isArray(productRawData?.variations) && productRawData.variations.length > 0)
                || hasVariations;
            const overrides = getFeedOverrides(product.seoData, channel);
            const aiSuggestions = getFeedAiSuggestions(product.seoData, channel);
            const mapColumns = (valueReader: (sourceField: string) => string | null, overridePrefix?: string) => {
                return mappings.map((mapping) => {
                    const raw = valueReader(mapping.sourceField);
                    const fallback = mapping.fallbackSourceField ? valueReader(mapping.fallbackSourceField) : null;
                    const mapped = raw || fallback;
                    const overrideKey = overridePrefix ? `${overridePrefix}:${mapping.targetField}` : mapping.targetField;
                    const override = overrides[overrideKey] || null;
                    const aiSuggestedValue = aiSuggestions[overrideKey] || null;
                    const finalValue = override || aiSuggestedValue || mapped;

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
            };

            const productRows: any[] = [];
            if (includeParents || !isVariableProduct) {
                productRows.push({
                    rowType: 'parent',
                    rowId: `p:${product.wooId}`,
                    wooId: product.wooId,
                    sku: product.sku,
                    name: product.name,
                    channel,
                    columns: mapColumns((sourceField) => getSourceValue(sourceField, product, account || undefined, categoryPriority)),
                });
            }

            if (includeVariations && Array.isArray(product.variations) && product.variations.length > 0) {
                const variations = product.variations;
                const parentRawData = product.rawData as any;
                let selectedVariations = variations;
                if (variationMode === 'default_variation') {
                    const defaults = Array.isArray(parentRawData?.default_attributes)
                        ? parentRawData.default_attributes
                        : [];
                    selectedVariations = variations.filter((v: any) => {
                        const attrs = Array.isArray(v.rawData?.attributes) ? v.rawData.attributes : [];
                        if (defaults.length === 0 || attrs.length === 0) return false;
                        return defaults.every((def: any) =>
                            attrs.some((attr: any) =>
                                String(attr?.name || '').toLowerCase() === String(def?.name || '').toLowerCase()
                                && String(attr?.option || '').toLowerCase() === String(def?.option || '').toLowerCase(),
                            ),
                        );
                    });
                    if (selectedVariations.length === 0) selectedVariations = variations.slice(0, 1);
                } else if (variationMode === 'first_variation') {
                    selectedVariations = variations.slice(0, 1);
                } else if (variationMode === 'last_variation') {
                    selectedVariations = variations.slice(-1);
                }

                selectedVariations.forEach((variation: any) => {
                    const variationId = `${product.wooId}-${variation.wooId}`;
                    productRows.push({
                        rowType: 'variation',
                        rowId: `v:${variationId}`,
                        wooId: product.wooId,
                        variationWooId: variation.wooId,
                        sku: variation.sku || product.sku,
                        name: getVariationSourceValue('name', variation, product),
                        channel,
                        columns: mapColumns((sourceField) => getVariationSourceValue(sourceField, variation, product, account || undefined, categoryPriority), variationId),
                    });
                });
            }

            return productRows;
        });

        const filteredRows = query
            ? rows.filter((row: any) => {
                const q = query.toLowerCase();
                return (row.name || '').toLowerCase().includes(q) || (row.sku || '').toLowerCase().includes(q);
            })
            : rows;

        const total = filteredRows.length;
        const start = (page - 1) * limit;
        const pagedRows = filteredRows.slice(start, start + limit);

        return { total, rows: pagedRows, mappings };
    }

    static async getFeedRowRefs(
        accountId: string,
        channelInput: string,
        query: string,
        variationMode: VariationMode,
    ): Promise<{ total: number; rows: Array<{ rowId: string; wooId: number; variationWooId?: number }> }> {
        normalizeChannel(channelInput);

        const where: any = { accountId };
        if (query) {
            where.OR = [
                { name: { contains: query, mode: 'insensitive' } },
                { sku: { contains: query, mode: 'insensitive' } },
            ];
        }

        const includeParents = variationMode === 'variable_parent' || variationMode === 'variable_and_variations';
        const includeVariations = variationMode !== 'variable_parent';

        const products = await prisma.wooProduct.findMany({
            where,
            select: {
                wooId: true,
                rawData: true,
                variations: includeVariations ? {
                    select: { wooId: true, rawData: true },
                    orderBy: { wooId: 'asc' },
                } : false,
            },
            orderBy: { updatedAt: 'desc' },
        });

        const rows = products.flatMap((product) => {
            const out: Array<{ rowId: string; wooId: number; variationWooId?: number }> = [];
            const productRawData = product.rawData as any;
            const hasVariations = Array.isArray(product.variations) && product.variations.length > 0;
            const isVariableProduct = String(productRawData?.type || '').includes('variable')
                || (Array.isArray(productRawData?.variations) && productRawData.variations.length > 0)
                || hasVariations;
            if (includeParents || !isVariableProduct) {
                out.push({ rowId: `p:${product.wooId}`, wooId: product.wooId });
            }

            if (includeVariations && Array.isArray(product.variations) && product.variations.length > 0) {
                const variations = product.variations;
                const parentRawData = product.rawData as any;
                let selectedVariations = variations;

                if (variationMode === 'default_variation') {
                    const defaults = Array.isArray(parentRawData?.default_attributes)
                        ? parentRawData.default_attributes
                        : [];
                    selectedVariations = variations.filter((v: any) => {
                        const attrs = Array.isArray(v.rawData?.attributes) ? v.rawData.attributes : [];
                        if (defaults.length === 0 || attrs.length === 0) return false;
                        return defaults.every((def: any) =>
                            attrs.some((attr: any) =>
                                String(attr?.name || '').toLowerCase() === String(def?.name || '').toLowerCase()
                                && String(attr?.option || '').toLowerCase() === String(def?.option || '').toLowerCase(),
                            ),
                        );
                    });
                    if (selectedVariations.length === 0) selectedVariations = variations.slice(0, 1);
                } else if (variationMode === 'first_variation') {
                    selectedVariations = variations.slice(0, 1);
                } else if (variationMode === 'last_variation') {
                    selectedVariations = variations.slice(-1);
                }

                selectedVariations.forEach((variation: any) => {
                    const variationId = `${product.wooId}-${variation.wooId}`;
                    out.push({
                        rowId: `v:${variationId}`,
                        wooId: product.wooId,
                        variationWooId: variation.wooId,
                    });
                });
            }

            return out;
        });

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

        Object.entries(fields).forEach(([key, value]) => {
            if (LOCKED_FEED_FIELDS.has(getBaseTargetField(key))) return;

            if (value == null || value.trim() === '') {
                delete currentChannelOverrides[key];
            } else {
                currentChannelOverrides[key] = value;
            }
        });

        feedOverrides[channel] = currentChannelOverrides;

        await prisma.wooProduct.update({
            where: { accountId_wooId: { accountId, wooId } },
            data: {
                seoData: {
                    ...seoData,
                    feedOverrides,
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
            `Optimize product feed fields for ${channel}.`,
            'Rules: keep factual claims only, no emojis, concise, channel compliant.',
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

        for (const [field, value] of Object.entries(cleanSuggestions)) {
            const key = rowPrefix ? `${rowPrefix}:${field}` : field;
            channelMap[key] = value;
        }

        feedAiSuggestions[channel] = channelMap;

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
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            try {
                const suggestions = await this.optimizeRowFields(
                    accountId,
                    normalizedChannel,
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

            const completed = i + 1;
            const pct = Math.round((completed / total) * 100);
            await job.updateProgress({ completed, total, pct });
        }

        const succeeded = results.filter((r) => r.success).length;
        const failed = total - succeeded;

        return { total, succeeded, failed, results };
    }
}
