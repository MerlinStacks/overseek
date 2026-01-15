import WooCommerceRestApi from "@woocommerce/woocommerce-rest-api";
import https from 'https';
import { prisma } from '../utils/prisma';
import { Logger } from '../utils/logger';

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
    type?: 'simple' | 'variable' | 'grouped' | 'external';
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

    private async requestWithRetry(method: string, endpoint: string, params: any = {}): Promise<any> {
        let retries = 0;
        while (retries < this.maxRetries) {
            try {
                const response = await this.api.get(endpoint, params);
                return {
                    data: response.data,
                    total: parseInt(response.headers['x-wp-total'] || '0', 10),
                    totalPages: parseInt(response.headers['x-wp-totalpages'] || '0', 10)
                };
            } catch (error: any) {
                // Check for 429 Too Many Requests
                if (error.response && error.response.status === 429) {
                    retries++;
                    const waitTime = Math.pow(2, retries) * 1000; // Exponential backoff: 2s, 4s, 8s
                    Logger.warn(`Rate limited on ${endpoint}. Retrying in ${waitTime}ms`, { endpoint, waitTime });
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                    continue;
                }

                // Throw specific error for other cases
                Logger.error(`Error fetching ${endpoint}`, { error: error.message });
                throw error;
            }
        }
        throw new Error(`Failed to fetch ${endpoint} after ${this.maxRetries} retries`);
    }

    async getOrders(params: { after?: string; page?: number; per_page?: number } = {}) {
        if (this.isDemo) return Promise.resolve({ data: MOCK_ORDERS, total: MOCK_ORDERS.length, totalPages: 1 });
        return this.requestWithRetry('get', 'orders', { ...params, per_page: params.per_page || 20 });
    }

    async getProducts(params: { after?: string; page?: number; per_page?: number } = {}) {
        if (this.isDemo) return Promise.resolve({ data: MOCK_PRODUCTS, total: MOCK_PRODUCTS.length, totalPages: 1 });
        return this.requestWithRetry('get', 'products', { ...params, per_page: params.per_page || 20 });
    }

    async getCustomers(params: { after?: string; page?: number; per_page?: number } = {}) {
        if (this.isDemo) return Promise.resolve({ data: MOCK_CUSTOMERS, total: MOCK_CUSTOMERS.length, totalPages: 1 });
        return this.requestWithRetry('get', 'customers', { ...params, per_page: params.per_page || 20 });
    }

    async getReviews(params: { after?: string; page?: number; per_page?: number } = {}) {
        if (this.isDemo) return Promise.resolve({ data: MOCK_REVIEWS, total: MOCK_REVIEWS.length, totalPages: 1 });
        return this.requestWithRetry('get', 'products/reviews', { ...params, per_page: params.per_page || 20 });
    }

    async getProduct(id: number) {
        if (this.isDemo) {
            const product = MOCK_PRODUCTS.find(p => p.id === id);
            if (!product) throw new Error("Product not found (Demo)");
            return product;
        }
        const response = await this.requestWithRetry('get', `products/${id}`);
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
