import WooCommerceRestApi from "@woocommerce/woocommerce-rest-api";
import https from 'https';
import { prisma } from '../utils/prisma';
import { Logger } from '../utils/logger';
import { retryWithBackoff, isCredentialError, isMaintenanceMode, getRetryAfterSeconds } from '../utils/retryWithBackoff';
import { registerRuntimeMetricsProvider } from '../utils/runtimeMetrics';

// Mock data removed - demo mode is currently disabled (see isDemo flag)
type MockProduct = { id: number; name: string; price: string };
type MockOrder = { id: number; status: string; total: string };
type MockCustomer = { id: number; email: string };
type MockReview = { id: number; review: string; rating: number };
type MockPage = { id: number; title: { rendered: string }; link: string };
type MockPost = { id: number; title: { rendered: string }; link: string };
const MOCK_PRODUCTS: MockProduct[] = [];
const MOCK_ORDERS: MockOrder[] = [];
const MOCK_CUSTOMERS: MockCustomer[] = [];
const MOCK_REVIEWS: MockReview[] = [];
const MOCK_PAGES: MockPage[] = [];
const MOCK_POSTS: MockPost[] = [];

function cacheKeyPart(value: unknown): string {
    return encodeURIComponent(String(value ?? 'unknown'));
}

export interface WooProductData {
    name: string;
    type?: 'simple' | 'variable' | 'grouped' | 'external' | string; // Extended to support ATUM's custom types
    regular_price?: string;
    status?: 'draft' | 'pending' | 'private' | 'publish';
    slug?: string;
    description?: string;
    short_description?: string;
    images?: { src: string }[];
    categories?: { id: number }[];
    tags?: { id: number }[];
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
    private wpApis = new Map<string, WooCommerceRestApi>();

    /**
     * Why singleton pool: each https.Agent holds an internal TCP socket pool.
     * Creating one per WooService instantiation leaked sockets that the GC
     * couldn't reclaim (OOM root cause). Keying by hostname lets multiple
     * accounts on the same host share a single keepAlive pool.
     */
    private static agentCache = new Map<string, https.Agent>();

    private static readonly MAX_AGENTS = 50;

    private static shouldRejectUnauthorizedTls(): boolean {
        const allowInsecure = process.env.ALLOW_INSECURE_TLS === 'true';
        if (allowInsecure && process.env.NODE_ENV !== 'production') {
            return false;
        }
        return true;
    }

    static getAgentMetrics() {
        let sockets = 0;
        let freeSockets = 0;
        let pendingRequests = 0;

        for (const agent of WooService.agentCache.values()) {
            sockets += Object.values(agent.sockets).reduce((sum, entries) => sum + entries.length, 0);
            freeSockets += Object.values(agent.freeSockets).reduce((sum, entries) => sum + entries.length, 0);
            pendingRequests += Object.values(agent.requests).reduce((sum, entries) => sum + entries.length, 0);
        }

        return {
            agentCacheSize: WooService.agentCache.size,
            maxAgents: WooService.MAX_AGENTS,
            sockets,
            freeSockets,
            pendingRequests,
        };
    }

    /** Returns a shared https.Agent for the given hostname, creating one if needed. */
    private static getAgent(hostname: string): https.Agent {
        let agent = WooService.agentCache.get(hostname);
        if (agent) {
            // Move to end (most recently used) by re-inserting
            WooService.agentCache.delete(hostname);
            WooService.agentCache.set(hostname, agent);
            return agent;
        }

        // Evict oldest entry if at capacity
        if (WooService.agentCache.size >= WooService.MAX_AGENTS) {
            const oldest = WooService.agentCache.keys().next().value!;
            WooService.agentCache.get(oldest)?.destroy();
            WooService.agentCache.delete(oldest);
        }

        agent = new https.Agent({
            rejectUnauthorized: WooService.shouldRejectUnauthorizedTls(),
            servername: hostname,
            keepAlive: true,
            maxSockets: 10,
        });
        WooService.agentCache.set(hostname, agent);
        return agent;
    }

    /** Destroys all pooled agents. Call during graceful shutdown. */
    static destroyAgents(): void {
        for (const [_hostname, agent] of WooService.agentCache) {
            agent.destroy();
        }
        WooService.agentCache.clear();
    }

    constructor(creds: WooCredentials) {
        this.accountId = creds.accountId;
        this.url = creds.url;
        this.consumerKey = creds.consumerKey;
        this.consumerSecret = creds.consumerSecret;

        // Extract hostname for SNI
        const urlObj = new URL(creds.url);

        this.axiosConfig = {
            httpsAgent: WooService.getAgent(urlObj.hostname),
            // Prevent OOM when a WooCommerce store returns pathologically large
            // JSON payloads (e.g. products with huge meta_data). Axios buffers
            // the entire response body into memory before JSON.parse().
            maxContentLength: 50 * 1024 * 1024, // 50MB
            maxBodyLength: 50 * 1024 * 1024,    // 50MB
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

    private async wooCredentialsAreValid(): Promise<boolean> {
        try {
            await this.api.get('system_status');
            return true;
        } catch (error) {
            Logger.warn('[WooService] WooCommerce credential validation failed after WordPress auth error', {
                accountId: this.accountId,
                status: (error as any)?.response?.status || (error as any)?.status,
                error: (error as any)?.response?.data || (error as any)?.message || error
            });
            return false;
        }
    }

    /**
     * Execute a WooCommerce API request with automatic retry on transient failures.
     * Uses exponential backoff with jitter for rate limits and network errors.
     * Detects credential revocation (401/403) and marks account for reconnection.
     */
    private async requestWithRetry(method: 'get' | 'post' | 'put' | 'delete', endpoint: string, params: any = {}): Promise<any> {
        try {
            return await retryWithBackoff(
                async () => {
                    // Why: previously always called this.api.get() regardless of method param.
                    // This caused silent bugs if any caller tried a PUT/POST via this path.
                    const response = await this.api[method](endpoint, params);
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
            if (isMaintenanceMode(error)) {
                const retryAfterSeconds = getRetryAfterSeconds(error);
                throw new Error(
                    retryAfterSeconds
                        ? `WooCommerce store is in maintenance mode. Retry after ${retryAfterSeconds}s.`
                        : 'WooCommerce store is in maintenance mode.'
                );
            }

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

    async getOrderStatuses() {
        if (this.isDemo) return Promise.resolve({ data: [] as Array<{ slug?: string; name?: string }> });
        return this.requestWithRetry('get', 'orders/statuses');
    }

    async getProducts(params: { after?: string; page?: number; per_page?: number; status?: string } = {}) {
        if (this.isDemo) return Promise.resolve({ data: MOCK_PRODUCTS, total: MOCK_PRODUCTS.length, totalPages: 1 });
        const { after, ...rest } = params;
        const apiParams = {
            ...rest,
            per_page: params.per_page || 20,
            ...(after && { modified_after: after })
        };
        return this.requestWithRetry('get', 'products', apiParams);
    }

    async getProductCategories(params: { page?: number; per_page?: number; search?: string } = {}) {
        if (this.isDemo) return Promise.resolve({ data: [], total: 0, totalPages: 0 });
        return this.requestWithRetry('get', 'products/categories', {
            page: params.page || 1,
            per_page: params.per_page || 100,
            ...(params.search ? { search: params.search } : {}),
        });
    }

    async getProductTags(params: { page?: number; per_page?: number; search?: string } = {}) {
        if (this.isDemo) return Promise.resolve({ data: [], total: 0, totalPages: 0 });
        return this.requestWithRetry('get', 'products/tags', {
            page: params.page || 1,
            per_page: params.per_page || 100,
            ...(params.search ? { search: params.search } : {}),
        });
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

    async getReviews(params: { after?: string; page?: number; per_page?: number; status?: string } = {}) {
        if (this.isDemo) return Promise.resolve({ data: MOCK_REVIEWS, total: MOCK_REVIEWS.length, totalPages: 1 });
        const { after, ...rest } = params;
        const apiParams = {
            status: 'all',
            ...rest,
            per_page: params.per_page || 20,
            ...(after && { modified_after: after })
        };
        return this.requestWithRetry('get', 'products/reviews', apiParams);
    }

    async updateReview(reviewId: number, data: { status?: string; content?: string; rating?: number }) {
        if (this.isDemo) return { success: true, review: { id: reviewId, ...data } };
        try {
            const response = await this.requestWpWithRetry('put', `reviews/${reviewId}`, data, 'overseek/v1');
            return response.data;
        } catch (error: any) {
            Logger.warn('[WooService] Custom review update endpoint failed, trying WooCommerce endpoint', {
                accountId: this.accountId,
                reviewId,
                status: error?.response?.status || error?.status,
                error: error?.response?.data || error?.message || error
            });

            const nativeData: { status?: string; review?: string; rating?: number } = {
                ...(data.status ? { status: data.status } : {}),
                ...(data.content ? { review: data.content } : {}),
                ...(data.rating ? { rating: data.rating } : {})
            };
            const response = await this.requestWithRetry('put', `products/reviews/${reviewId}`, nativeData);
            return { success: true, review: response.data };
        }
    }

    async deleteReview(reviewId: number) {
        if (this.isDemo) return { success: true, deleted: true, review: { id: reviewId } };
        const response = await this.requestWithRetry('delete', `products/reviews/${reviewId}`, { force: true });
        return { success: true, review: response.data };
    }

    async createReview(data: {
        product_id: number;
        review: string;
        reviewer: string;
        reviewer_email: string;
        rating?: number;
        attachments?: Array<{ filename: string; url: string; type: string }>;
        source_email_message_id?: string;
        source_email_log_id?: string;
        source_order_id?: string | number | null;
    }) {
        if (this.isDemo) return { success: true, review: { id: Math.floor(Math.random() * 100000), ...data } };
        const response = await this.requestWpWithRetry('post', 'reviews', data, 'overseek/v1');
        return response.data;
    }

    async replyToReview(reviewId: number, reply: string, author?: string) {
        if (this.isDemo) return { success: true, replyId: Math.floor(Math.random() * 100000), review: { id: reviewId } };
        const response = await this.requestWpWithRetry('post', `reviews/${reviewId}/reply`, { reply, ...(author !== undefined ? { author } : {}) }, 'overseek/v1');
        return response.data;
    }

    private getWpApi(version: 'wp/v2' | 'overseek/v1'): WooCommerceRestApi {
        let wpApi = this.wpApis.get(version);
        if (wpApi) return wpApi;

        wpApi = new WooCommerceRestApi({
            url: this.url,
            consumerKey: this.consumerKey,
            consumerSecret: this.consumerSecret,
            version: version as any,
            queryStringAuth: true,
            axiosConfig: this.axiosConfig
        });
        this.wpApis.set(version, wpApi);
        return wpApi;
    }

    private async requestWpWithRetry(method: 'get' | 'post' | 'put', endpoint: string, params: any = {}, version: 'wp/v2' | 'overseek/v1' = 'wp/v2'): Promise<any> {
        try {
            return await retryWithBackoff(
                async () => {
                    const response = await this.getWpApi(version)[method](endpoint, params);
                    return {
                        data: response.data,
                        total: parseInt(response.headers['x-wp-total'] || '0', 10),
                        totalPages: parseInt(response.headers['x-wp-totalpages'] || '0', 10)
                    };
                },
                {
                    maxRetries: this.maxRetries,
                    baseDelayMs: 1000,
                    context: `WordPress:${method}:${version}:${endpoint}`
                }
            );
        } catch (error: any) {
            if (isMaintenanceMode(error)) {
                const retryAfterSeconds = getRetryAfterSeconds(error);
                throw new Error(
                    retryAfterSeconds
                        ? `WordPress content API is in maintenance mode. Retry after ${retryAfterSeconds}s.`
                        : 'WordPress content API is in maintenance mode.'
                );
            }

            if (isCredentialError(error)) {
                if (version === 'overseek/v1' && await this.wooCredentialsAreValid()) {
                    Logger.warn('[WooService] Overseek WordPress plugin route rejected valid WooCommerce credentials', {
                        accountId: this.accountId,
                        endpoint,
                        status: error?.response?.status || error?.status,
                        error: error?.response?.data || error?.message || error
                    });
                    throw new Error('Overseek WordPress plugin authorization failed. Please verify the plugin route permissions and that the stored WooCommerce API key belongs to a user with store management access.');
                }
                await this.markNeedsReconnection();
                throw new Error('WordPress credentials revoked or invalid. Please reconnect your store.');
            }
            throw error;
        }
    }

    async getPages(params: { after?: string; page?: number; per_page?: number } = {}) {
        if (this.isDemo) return Promise.resolve({ data: MOCK_PAGES, total: MOCK_PAGES.length, totalPages: 1 });
        const { after, ...rest } = params;
        const apiParams = {
            ...rest,
            per_page: params.per_page || 20,
            ...(after && { modified_after: after }),
            context: 'view'
        };
        return this.requestWpWithRetry('get', 'pages', apiParams);
    }

    async getPosts(params: { after?: string; page?: number; per_page?: number } = {}) {
        if (this.isDemo) return Promise.resolve({ data: MOCK_POSTS, total: MOCK_POSTS.length, totalPages: 1 });
        const { after, ...rest } = params;
        const apiParams = {
            ...rest,
            per_page: params.per_page || 20,
            ...(after && { modified_after: after }),
            context: 'view'
        };
        return this.requestWpWithRetry('get', 'posts', apiParams);
    }

    async updatePage(id: number, data: { title?: string; content?: string; excerpt?: string; status?: string }, userId?: string) {
        if (this.isDemo) {
            Logger.debug(`[Demo] Updated Page ${id}`, { data });
            return { id, ...data };
        }

        const response = await this.requestWpWithRetry('put', `pages/${id}`, data);

        if (this.accountId) {
            const { AuditService } = await import('./AuditService');
            await AuditService.log(this.accountId, userId || null, 'UPDATE', 'PAGE', id.toString(), data);
        }

        return response.data;
    }

    async updatePost(id: number, data: { title?: string; content?: string; excerpt?: string; status?: string }, userId?: string) {
        if (this.isDemo) {
            Logger.debug(`[Demo] Updated Post ${id}`, { data });
            return { id, ...data };
        }

        const response = await this.requestWpWithRetry('put', `posts/${id}`, data);

        if (this.accountId) {
            const { AuditService } = await import('./AuditService');
            await AuditService.log(this.accountId, userId || null, 'UPDATE', 'BLOG_POST', id.toString(), data);
        }

        return response.data;
    }

    async createPage(data: { title: string; content?: string; excerpt?: string; status?: string }, userId?: string) {
        if (this.isDemo) {
            Logger.debug('[Demo] Created Page', { data });
            return {
                id: Math.floor(Math.random() * 100000),
                title: { rendered: data.title },
                content: { rendered: data.content || '' },
                excerpt: { rendered: data.excerpt || '' },
                status: data.status || 'draft',
                slug: data.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
                link: `${this.url}/?page_id=demo`
            };
        }

        const response = await this.requestWpWithRetry('post', 'pages', data);

        if (this.accountId) {
            const { AuditService } = await import('./AuditService');
            await AuditService.log(this.accountId, userId || null, 'CREATE', 'PAGE', response.data.id.toString(), data);
        }

        return response.data;
    }

    async createPost(data: { title: string; content?: string; excerpt?: string; status?: string }, userId?: string) {
        if (this.isDemo) {
            Logger.debug('[Demo] Created Post', { data });
            return {
                id: Math.floor(Math.random() * 100000),
                title: { rendered: data.title },
                content: { rendered: data.content || '' },
                excerpt: { rendered: data.excerpt || '' },
                status: data.status || 'draft',
                slug: data.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
                link: `${this.url}/?p=demo`
            };
        }

        const response = await this.requestWpWithRetry('post', 'posts', data);

        if (this.accountId) {
            const { AuditService } = await import('./AuditService');
            await AuditService.log(this.accountId, userId || null, 'CREATE', 'BLOG_POST', response.data.id.toString(), data);
        }

        return response.data;
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
        const cacheKey = `woo:product:${cacheKeyPart(this.accountId)}:${cacheKeyPart(id)}`;

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
     * Fetch all variations for a variable product with Redis caching.
     * Cache TTL: 30 seconds to balance freshness with API savings.
     * Throws on API failure so callers can distinguish "store down" from "no variations."
     */
    async getProductVariations(productId: number): Promise<any[]> {
        if (this.isDemo) return [];

        // Try cache first to avoid redundant API calls (BOM sync may fetch same parent repeatedly)
        const { redisClient } = await import('../utils/redis');
        const cacheKey = `woo:variations:${cacheKeyPart(this.accountId)}:${cacheKeyPart(productId)}`;

        try {
            const cached = await redisClient.get(cacheKey);
            if (cached) {
                if (cached.length > 5 * 1024 * 1024) {
                    Logger.warn('[WooService] Cached variation payload exceeds safe size, skipping cache', {
                        cacheKey,
                        sizeMB: (cached.length / 1024 / 1024).toFixed(2)
                    });
                    await redisClient.del(cacheKey);
                } else {
                    return JSON.parse(cached);
                }
            }
        } catch {
            // Cache miss or Redis error — continue to API
        }

        // WooCommerce has pagination for variations, fetch up to 100
        const response = await this.requestWithRetry('get', `products/${productId}/variations`, { per_page: 100 });
        const variations = response.data || [];

        // Cache the result for 30 seconds
        try {
            await redisClient.setex(cacheKey, 30, JSON.stringify(variations));
        } catch {
            // Cache write failure is non-fatal
        }

        return variations;
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

    async createCoupon(data: any, userId?: string) {
        if (this.isDemo) {
            Logger.debug('[Demo] Created Coupon', { data });
            return { id: Math.floor(Math.random() * 100000), ...data };
        }

        const response = await this.api.post('coupons', data);

        if (this.accountId) {
            const { AuditService } = await import('./AuditService');
            await AuditService.log(
                this.accountId,
                userId || null,
                'CREATE',
                'COUPON',
                response.data.id?.toString?.() || 'unknown',
                data
            );
        }

        return response.data;
    }

    async createOrderNote(orderId: number, data: any, userId?: string) {
        if (this.isDemo) {
            Logger.debug(`[Demo] Created order note for ${orderId}`, { data });
            return { id: Math.floor(Math.random() * 100000), ...data };
        }

        const response = await this.api.post(`orders/${orderId}/notes`, data);

        if (this.accountId) {
            const { AuditService } = await import('./AuditService');
            await AuditService.log(
                this.accountId,
                userId || null,
                'CREATE',
                'ORDER_NOTE',
                `${orderId}`,
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

        const response = await this.requestWpWithRetry('post', 'settings', settings, 'overseek/v1');
        return response.data;
    }

    async updateStorefrontConfig(config: Record<string, any>) {
        if (this.isDemo) {
            Logger.debug('[Demo] Mocking storefront config update', { config });
            return { success: true, message: "Storefront config updated (Demo)" };
        }

        const response = await this.requestWpWithRetry('post', 'storefront-config', config, 'overseek/v1');
        return response.data;
    }

}

registerRuntimeMetricsProvider('wooService', () => WooService.getAgentMetrics());
