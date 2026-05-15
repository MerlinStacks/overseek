import { prisma } from '../utils/prisma';
import type { Prisma } from '@prisma/client';
import { Logger } from '../utils/logger';
import type { Job } from 'bullmq';

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

interface FeedFeatureConfig {
    mappings?: Partial<Record<FeedChannel, FeedFieldMapping[]>>;
    refreshModes?: Partial<Record<FeedChannel, FeedRefreshMode>>;
    maxBulkOptimizeRows?: number;
}

const DEFAULT_REFRESH_MODE: FeedRefreshMode = 'manual';
const ALLOWED_REFRESH_MODES: FeedRefreshMode[] = ['manual', 'auto_on_sync', '1h', '3h', '12h', '24h'];
const DEFAULT_MAX_BULK_OPTIMIZE_ROWS = 5000;

const DEFAULT_MAPPINGS: Record<FeedChannel, FeedFieldMapping[]> = {
    google: [
        { targetField: 'id', sourceField: 'wooId', required: true },
        { targetField: 'title', sourceField: 'name', required: true },
        { targetField: 'description', sourceField: 'description', fallbackSourceField: 'short_description', required: true },
        { targetField: 'link', sourceField: 'permalink', required: true },
        { targetField: 'image_link', sourceField: 'mainImage', required: true },
        { targetField: 'price', sourceField: 'price', required: true },
        { targetField: 'availability', sourceField: 'stockStatus', required: true },
        { targetField: 'brand', sourceField: 'brand' },
    ],
    meta: [
        { targetField: 'id', sourceField: 'wooId', required: true },
        { targetField: 'title', sourceField: 'name', required: true },
        { targetField: 'description', sourceField: 'description', fallbackSourceField: 'short_description' },
        { targetField: 'link', sourceField: 'permalink', required: true },
        { targetField: 'image_link', sourceField: 'mainImage', required: true },
        { targetField: 'price', sourceField: 'price', required: true },
        { targetField: 'availability', sourceField: 'stockStatus' },
        { targetField: 'brand', sourceField: 'brand' },
    ],
    pinterest: [
        { targetField: 'id', sourceField: 'wooId', required: true },
        { targetField: 'title', sourceField: 'name', required: true },
        { targetField: 'description', sourceField: 'description', fallbackSourceField: 'short_description' },
        { targetField: 'link', sourceField: 'permalink', required: true },
        { targetField: 'image_link', sourceField: 'mainImage', required: true },
        { targetField: 'price', sourceField: 'price', required: true },
        { targetField: 'availability', sourceField: 'stockStatus' },
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

function normalizeChannel(channel: string): FeedChannel {
    const value = channel.toLowerCase();
    if (value === 'google' || value === 'meta' || value === 'pinterest' || value === 'similar') {
        return value;
    }
    throw new Error('Unsupported feed channel');
}

function getSourceValue(sourceField: string, product: any): string | null {
    switch (sourceField) {
        case 'wooId': return String(product.wooId);
        case 'name': return product.name || null;
        case 'description': return product.rawData?.description || null;
        case 'short_description': return product.rawData?.short_description || null;
        case 'permalink': return product.permalink || product.rawData?.permalink || null;
        case 'mainImage': return product.mainImage || product.rawData?.images?.[0]?.src || null;
        case 'price': return product.price != null ? `${product.price}` : (product.rawData?.price || null);
        case 'stockStatus': {
            const status = product.stockStatus || product.rawData?.stock_status;
            if (!status) return null;
            if (status === 'instock') return 'in stock';
            if (status === 'outofstock') return 'out of stock';
            return String(status);
        }
        case 'brand': return product.rawData?.brands?.[0]?.name || product.rawData?.brand || null;
        default: return null;
    }
}

function getVariationSourceValue(sourceField: string, variation: any, parent: any): string | null {
    switch (sourceField) {
        case 'wooId': return `${parent.wooId}-${variation.wooId}`;
        case 'name': {
            const attrs = Array.isArray(variation.rawData?.attributes)
                ? variation.rawData.attributes
                    .map((a: any) => a?.option)
                    .filter(Boolean)
                    .join(' / ')
                : '';
            return attrs ? `${parent.name} - ${attrs}` : parent.name;
        }
        case 'description': return variation.rawData?.description || parent.rawData?.description || null;
        case 'short_description': return variation.rawData?.short_description || parent.rawData?.short_description || null;
        case 'permalink': return variation.rawData?.permalink || parent.permalink || parent.rawData?.permalink || null;
        case 'mainImage': return variation.rawData?.image?.src || parent.mainImage || parent.rawData?.images?.[0]?.src || null;
        case 'price': return variation.price != null ? `${variation.price}` : (variation.rawData?.price || (parent.price != null ? `${parent.price}` : null));
        case 'stockStatus': {
            const status = variation.stockStatus || variation.rawData?.stock_status || parent.stockStatus || parent.rawData?.stock_status;
            if (!status) return null;
            if (status === 'instock') return 'in stock';
            if (status === 'outofstock') return 'out of stock';
            return String(status);
        }
        case 'brand': return parent.rawData?.brands?.[0]?.name || parent.rawData?.brand || null;
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

    static async getMappings(accountId: string, channelInput: string): Promise<FeedFieldMapping[]> {
        const channel = normalizeChannel(channelInput);
        const feature = await prisma.accountFeature.findUnique({
            where: { accountId_featureKey: { accountId, featureKey: FEED_FEATURE_KEY } },
            select: { config: true }
        });

        const config = (feature?.config || {}) as FeedFeatureConfig;
        return config.mappings?.[channel] || DEFAULT_MAPPINGS[channel];
    }

    static async saveMappings(accountId: string, channelInput: string, mappings: FeedFieldMapping[]): Promise<FeedFieldMapping[]> {
        const channel = normalizeChannel(channelInput);
        const feature = await prisma.accountFeature.findUnique({
            where: { accountId_featureKey: { accountId, featureKey: FEED_FEATURE_KEY } },
            select: { config: true }
        });

        const existingConfig = (feature?.config || {}) as FeedFeatureConfig;
        const nextConfig: FeedFeatureConfig = {
            ...existingConfig,
            mappings: {
                ...(existingConfig.mappings || {}),
                [channel]: mappings,
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

        return mappings;
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
    ): Promise<{ total: number; rows: any[]; mappings: FeedFieldMapping[] }> {
        const channel = normalizeChannel(channelInput);
        const mappings = await this.getMappings(accountId, channel);

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
            if (includeParents) {
                productRows.push({
                    rowType: 'parent',
                    rowId: `p:${product.wooId}`,
                    wooId: product.wooId,
                    sku: product.sku,
                    name: product.name,
                    channel,
                    columns: mapColumns((sourceField) => getSourceValue(sourceField, product)),
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
                        columns: mapColumns((sourceField) => getVariationSourceValue(sourceField, variation, product), variationId),
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
            if (includeParents) {
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
                cleanSuggestions[field] = value.trim();
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
