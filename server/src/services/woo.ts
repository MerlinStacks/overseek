import WooCommerceRestApi from "@woocommerce/woocommerce-rest-api";
import https from 'https';
import { prisma } from '../utils/prisma';
import { Logger } from '../utils/logger';
import { retryWithBackoff, isRetryableError, isCredentialError } from '../utils/retryWithBackoff';

// Mock data removed - demo mode is currently disabled (see isDemo flag)
type MockProduct = { id: number; name: string; price: string };
type MockOrder = { id: number; status: string; total: string };
type MockCustomer = { id: number; email: string };
type MockReview = { id: number; review: string; rating: number };
const MOCK_PRODUCTS: MockProduct[] = [];
const MOCK_ORDERS: MockOrder[] = [];
const MOCK_CUSTOMERS: MockCustomer[] = [];
const MOCK_REVIEWS: MockReview[] = [];

export interface WooProductData {
    name: string;
    type?: 'simple' | 'variable' | 'grouped' | 'external' | string; // Extended to support ATUM's custom types
    regular_price?: string;
    description?: string;
    short_description?: string;
    images?: { src: string }[];
}

interface WooCredentials {
    url: string;
    consumerKey: string;
    consumerSecret: string;
    accountId?: string; // Added for Audit Logging context
}



export class WooService {
    private api: WooCommerceRestApi;
    private maxRetries = 3;
    private isDemo = false;
    private accountId?: string;

    // Store credentials for custom requests
    private url: string;
    private consumerKey: string;
    private consumerSecret: string;
    private axiosConfig: any;

    constructor(creds: WooCredentials) {
        this.accountId = creds.accountId;
        this.url = creds.url;
        this.consumerKey = creds.consumerKey;
        this.consumerSecret = creds.consumerSecret;

        // Extract hostname for SNI
        const urlObj = new URL(creds.url);

        this.axiosConfig = {
            // Fixes SSL Alert 112 (Unrecognized Name) by sending SNI
            httpsAgent: new https.Agent({
                rejectUnauthorized: false,
                servername: urlObj.hostname
            })
        };

        this.api = new WooCommerceRestApi({
            url: creds.url,
            consumerKey: creds.consumerKey,
            consumerSecret: creds.consumerSecret,
            version: "wc/v3",
            queryStringAuth: true, // Useful for some hosting providers
            axiosConfig: this.axiosConfig
        });

        // Detect Demo Mode (Strictly for the demo domain only)
        // if (creds.url.includes("demo.overseek.com") || creds.url.includes("example.com")) {
        //     this.isDemo = true;
        //     console.log("[WooService] Demo Mode Activated for URL:", creds.url);
        // }
    }

    static async forAccount(accountId: string) {
        if (!accountId) throw new Error("Account ID is required");

        const account = await prisma.account.findUnique({
            where: { id: accountId }
        });

        if (!account) throw new Error("Account not found");
        if (!account.wooUrl || !account.wooConsumerKey || !account.wooConsumerSecret) {
            throw new Error("Account missing WooCommerce credentials");
        }

        return new WooService({
            url: account.wooUrl,
            consumerKey: account.wooConsumerKey,
            consumerSecret: account.wooConsumerSecret,
            accountId: account.id
        });
    }

    /**
     * Mark account as needing WooCommerce reconnection.
     * Called when credential revocation is detected (401/403).
     */
    private async markNeedsReconnection(): Promise<void> {
        if (!this.accountId) return;

        try {
            await prisma.account.update({
                where: { id: this.accountId },
                data: { wooNeedsReconnect: true }
            });
            Logger.error('[WooService] Credentials revoked - account marked for reconnection', {
                accountId: this.accountId,
                url: this.url
            });
        } catch (err) {
            Logger.error('[WooService] Failed to mark account for reconnection', {
                accountId: this.accountId,
                error: err instanceof Error ? err.message : 'Unknown'
            });
        }
    }

    /**
     * Execute a WooCommerce API request with automatic retry on transient failures.
     * Uses exponential backoff with jitter for rate limits and network errors.
     * Detects credential revocation (401/403) and marks account for reconnection.
     */
    private async requestWithRetry(method: string, endpoint: string, params: any = {}): Promise<any> {
        try {
            return await retryWithBackoff(
                async () => {
                    const response = await this.api.get(endpoint, params);
                    return {
                        data: response.data,
                        total: parseInt(response.headers['x-wp-total'] || '0', 10),
                        totalPages: parseInt(response.headers['x-wp-totalpages'] || '0', 10)
                    };
                },
                {
                    maxRetries: this.maxRetries,
                    baseDelayMs: 1000,
                    context: `WooCommerce:${endpoint}`
                }
            );
        } catch (error: any) {
            // Detect credential revocation and mark account
            if (isCredentialError(error)) {
                await this.markNeedsReconnection();
                throw new Error(`WooCommerce credentials revoked or invalid. Please reconnect your store.`);
            }
            throw error;
        }
    }

    async getOrders(params: { after?: string; page?: number; per_page?: number } = {}) {
        if (this.isDemo) return Promise.resolve({ data: MOCK_ORDERS, total: MOCK_ORDERS.length, totalPages: 1 });
        const { after, ...rest } = params;
        const apiParams = {
            ...rest,
            per_page: params.per_page || 20,
            // Use modified_after for incremental syncs to catch status changes
            ...(after && { modified_after: after })
        };
        return this.requestWithRetry('get', 'orders', apiParams);
    }

    async getProducts(params: { after?: string; page?: number; per_page?: number } = {}) {
        if (this.isDemo) return Promise.resolve({ data: MOCK_PRODUCTS, total: MOCK_PRODUCTS.length, totalPages: 1 });
        const { after, ...rest } = params;
        const apiParams = {
            ...rest,
            per_page: params.per_page || 20,
            ...(after && { modified_after: after })
        };
        return this.requestWithRetry('get', 'products', apiParams);
    }

    async getCustomers(params: { after?: string; page?: number; per_page?: number } = {}) {
        if (this.isDemo) return Promise.resolve({ data: MOCK_CUSTOMERS, total: MOCK_CUSTOMERS.length, totalPages: 1 });
        const { after, ...rest } = params;
        const apiParams = {
            ...rest,
            per_page: params.per_page || 20,
            ...(after && { modified_after: after })
        };
        return this.requestWithRetry('get', 'customers', apiParams);
    }

    async getReviews(params: { after?: string; page?: number; per_page?: number } = {}) {
        if (this.isDemo) return Promise.resolve({ data: MOCK_REVIEWS, total: MOCK_REVIEWS.length, totalPages: 1 });
        const { after, ...rest } = params;
        const apiParams = {
            ...rest,
            per_page: params.per_page || 20,
            ...(after && { modified_after: after })
        };
        return this.requestWithRetry('get', 'products/reviews', apiParams);
    }

    /**
     * Get a single product with Redis caching.
     * Cache TTL: 30 seconds to balance freshness with API savings.
     */
    async getProduct(id: number) {
        if (this.isDemo) {
            const product = MOCK_PRODUCTS.find(p => p.id === id);
            if (!product) throw new Error("Product not found (Demo)");
            return product;
        }

        // Try cache first
        const { redisClient } = await import('../utils/redis');
        const cacheKey = `woo:product:${this.accountId}:${id}`;

        try {
            const cached = await redisClient.get(cacheKey);
            if (cached) {
                // Guard: reject cached values over 5MB (products shouldn't be this large)
                if (cached.length > 5 * 1024 * 1024) {
                    Logger.warn('[WooService] Cached product exceeds safe size, skipping cache', {
                        cacheKey,
                        sizeMB: (cached.length / 1024 / 1024).toFixed(2)
                    });
                    await redisClient.del(cacheKey);
                } else {
                    return JSON.parse(cached);
                }
            }
        } catch (e) {
            // Cache miss or Redis error - continue to API
        }

        const response = await this.requestWithRetry('get', `products/${id}`);

        // Cache the result for 30 seconds
        try {
            await redisClient.setex(cacheKey, 30, JSON.stringify(response.data));
        } catch (e) {
            // Cache write failure is non-fatal
        }

        return response.data;
    }

    /**
     * Fetch all variations for a variable product.
     * Includes stock_quantity, sku, price, attributes, etc.
     */
    async getProductVariations(productId: number): Promise<any[]> {
        if (this.isDemo) return [];

        try {
            // WooCommerce has pagination for variations, fetch up to 100
            const response = await this.requestWithRetry('get', `products/${productId}/variations`, { per_page: 100 });
            return response.data || [];
        } catch (error) {
            Logger.warn(`Failed to fetch variations for product ${productId}`, { error });
            return [];
        }
    }

    async createProduct(data: WooProductData, userId?: string) {
        if (this.isDemo) {
            Logger.debug(`[Demo] Created Product`, { data });
            const newProduct: MockProduct = { id: Math.floor(Math.random() * 1000), name: data.name || 'New Product', price: data.regular_price || '0' };
            MOCK_PRODUCTS.push(newProduct);
            return newProduct;
        }
        const response = await this.api.post('products', data);

        if (this.accountId) {
            const { AuditService } = await import('./AuditService');
            await AuditService.log(
                this.accountId,
                userId || null,
                'CREATE',
                'PRODUCT',
                response.data.id.toString(),
                data
            );
        }

        return response.data;
    }

    async updateProduct(id: number, data: any, userId?: string) {
        if (this.isDemo) {
            Logger.debug(`[Demo] Updated Product ${id}`, { data });
            return { ...MOCK_PRODUCTS.find(p => p.id === id), ...data };
        }
        const response = await this.api.put(`products/${id}`, data);

        if (this.accountId) {
            const { AuditService } = await import('./AuditService');
            await AuditService.log(
                this.accountId,
                userId || null,
                'UPDATE',
                'PRODUCT',
                id.toString(),
                data
            );
        }

        return response.data;
    }

    async updateOrder(id: number, data: any, userId?: string) {
        if (this.isDemo) {
            Logger.debug(`[Demo] Updated Order ${id}`, { data });
            return { ...MOCK_ORDERS.find(o => o.id === id), ...data };
        }
        const response = await this.api.put(`orders/${id}`, data);

        if (this.accountId) {
            const { AuditService } = await import('./AuditService');
            await AuditService.log(
                this.accountId,
                userId || null,
                'UPDATE',
                'ORDER',
                id.toString(),
                data
            );
        }

        return response.data;
    }

    /**
     * Update a product variation's data (stock, price, etc.)
     * Required for updating variation-specific inventory via BOM sync.
     */
    async updateProductVariation(productId: number, variationId: number, data: any, userId?: string) {
        if (this.isDemo) {
            Logger.debug(`[Demo] Updated Variation ${variationId} of Product ${productId}`, { data });
            return { id: variationId, ...data };
        }
        const response = await this.api.put(`products/${productId}/variations/${variationId}`, data);

        if (this.accountId) {
            const { AuditService } = await import('./AuditService');
            await AuditService.log(
                this.accountId,
                userId || null,
                'UPDATE',
                'PRODUCT_VARIATION',
                `${productId}/${variationId}`,
                data
            );
        }

        return response.data;
    }

    /**
     * Batch update multiple products in a single API call.
     * WooCommerce supports up to 100 items per batch request.
     * @param updates - Array of { id, ...data } objects
     * @returns Batch response with created, updated, deleted arrays
     */
    async batchUpdateProducts(updates: Array<{ id: number;[key: string]: any }>, userId?: string) {
        if (this.isDemo) {
            Logger.debug(`[Demo] Batch updated ${updates.length} products`);
            return { update: updates };
        }

        // WooCommerce batch API expects { update: [...] }
        const response = await this.api.post('products/batch', { update: updates });

        if (this.accountId && userId) {
            const { AuditService } = await import('./AuditService');
            await AuditService.log(
                this.accountId,
                userId,
                'BATCH_UPDATE',
                'PRODUCT',
                updates.map(u => u.id).join(','),
                { count: updates.length }
            );
        }

        return response.data;
    }

    /**
     * Batch update multiple orders in a single API call.
     * Useful for bulk status changes (e.g., mark multiple as completed).
     * @param updates - Array of { id, ...data } objects  
     * @returns Batch response with created, updated, deleted arrays
     */
    async batchUpdateOrders(updates: Array<{ id: number;[key: string]: any }>, userId?: string) {
        if (this.isDemo) {
            Logger.debug(`[Demo] Batch updated ${updates.length} orders`);
            return { update: updates };
        }

        const response = await this.api.post('orders/batch', { update: updates });

        if (this.accountId && userId) {
            const { AuditService } = await import('./AuditService');
            await AuditService.log(
                this.accountId,
                userId,
                'BATCH_UPDATE',
                'ORDER',
                updates.map(u => u.id).join(','),
                { count: updates.length }
            );
        }

        return response.data;
    }

    /**
     * Batch update product variations in a single API call.
     * Used by BOM sync to update stock levels efficiently.
     * @param productId - Parent product ID
     * @param updates - Array of { id: variationId, ...data } objects
     */
    async batchUpdateVariations(productId: number, updates: Array<{ id: number;[key: string]: any }>, userId?: string) {
        if (this.isDemo) {
            Logger.debug(`[Demo] Batch updated ${updates.length} variations for product ${productId}`);
            return { update: updates };
        }

        const response = await this.api.post(`products/${productId}/variations/batch`, { update: updates });

        if (this.accountId && userId) {
            const { AuditService } = await import('./AuditService');
            await AuditService.log(
                this.accountId,
                userId,
                'BATCH_UPDATE',
                'PRODUCT_VARIATION',
                `${productId}/${updates.map(u => u.id).join(',')}`,
                { count: updates.length }
            );
        }

        return response.data;
    }

    async getSystemStatus() {
        if (this.isDemo) return Promise.resolve({ environment: { version: "8.0.0" } });
        return this.requestWithRetry('get', 'system_status');
    }

    /**
     * Fetches store-level settings from WooCommerce including measurement units and currency.
     * Used during account creation to sync OverSeek with the store's configured units.
     */
    async getStoreSettings(): Promise<{ weightUnit: string; dimensionUnit: string; currency: string }> {
        if (this.isDemo) {
            return { weightUnit: 'kg', dimensionUnit: 'cm', currency: 'USD' };
        }

        try {
            // Fetch product settings (contains weight and dimension units)
            const productResponse = await this.requestWithRetry('get', 'settings/products');
            const productSettings = productResponse.data;

            const weightUnit = productSettings.find((s: any) => s.id === 'woocommerce_weight_unit')?.value || 'kg';
            const dimensionUnit = productSettings.find((s: any) => s.id === 'woocommerce_dimension_unit')?.value || 'cm';

            // Fetch general settings (contains currency)
            const generalResponse = await this.requestWithRetry('get', 'settings/general');
            const generalSettings = generalResponse.data;
            const currency = generalSettings.find((s: any) => s.id === 'woocommerce_currency')?.value || 'USD';

            return { weightUnit, dimensionUnit, currency };
        } catch (error) {
            Logger.warn('Failed to fetch WooCommerce store settings, using defaults', { error });
            return { weightUnit: 'kg', dimensionUnit: 'cm', currency: 'USD' };
        }
    }

    async updatePluginSettings(settings: { account_id?: string; api_url?: string }) {
        if (this.isDemo) {
            Logger.debug('[Demo] Mocking plugin settings update', { settings });
            return { success: true, message: "Settings updated (Demo)" };
        }

        // Create a temporary client pointing to the custom namespace
        // The library appends version to the URL. We want `wp-json/overseek/v1`.
        // If we set version to 'overseek/v1', it constructs `wp-json/overseek/v1`.
        const customApi = new WooCommerceRestApi({
            url: this.url,
            consumerKey: this.consumerKey,
            consumerSecret: this.consumerSecret,
            version: "overseek/v1" as any, // Target our custom namespace
            queryStringAuth: true,
            axiosConfig: this.axiosConfig
        });

        // The endpoint is 'settings', resulting in `.../wp-json/overseek/v1/settings`
        const response = await customApi.post("settings", settings);
        return response.data;
    }

}
