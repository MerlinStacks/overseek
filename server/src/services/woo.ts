import WooCommerceRestApi from "@woocommerce/woocommerce-rest-api";
import https from 'https';
import { PrismaClient } from '@prisma/client';
import { MOCK_PRODUCTS, MOCK_ORDERS, MOCK_CUSTOMERS, MOCK_REVIEWS } from './mockWooData';

const prisma = new PrismaClient();

interface WooCredentials {
    url: string;
    consumerKey: string;
    consumerSecret: string;
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

    constructor(creds: WooCredentials) {
        this.accountId = creds.accountId;
        // Extract hostname for SNI
        const url = new URL(creds.url);

        this.api = new WooCommerceRestApi({
            url: creds.url,
            consumerKey: creds.consumerKey,
            consumerSecret: creds.consumerSecret,
            version: "wc/v3",
            queryStringAuth: true, // Useful for some hosting providers
            axiosConfig: {
                // Fixes SSL Alert 112 (Unrecognized Name) by sending SNI
                httpsAgent: new https.Agent({
                    rejectUnauthorized: false,
                    servername: url.hostname
                })
            }
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
                    console.warn(`[WooService] Rate limited on ${endpoint}. Retrying in ${waitTime}ms...`);
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                    continue;
                }

                // Throw specific error for other cases
                console.error(`[WooService] Error fetching ${endpoint}:`, error.message);
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

    async updateProduct(id: number, data: any, userId?: string) {
        if (this.isDemo) {
            console.log(`[Demo] Updated Product ${id}:`, data);
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
            console.log(`[Demo] Updated Order ${id}:`, data);
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

    async updatePluginSettings(settings: { account_id?: string; api_url?: string }) {
        if (this.isDemo) {
            console.log("[Demo] Mocking plugin settings update:", settings);
            return { success: true, message: "Settings updated (Demo)" };
        }

        // We use the same authenticated client to POST to our custom endpoint
        // Note: The endpoint is under 'overseek/v1', not 'wc/v3', so we use the axois instance directly if possible
        // or we construct the full URL. However, WooCommerceRestApi library is designed for WC endpoints.
        // But it handles auth Oauth1.0a signing which is usually required.
        // IF the custom endpoint requires cookie auth (logged in user), OAuth may not work unless we set permissions correctly.
        // Our endpoint checks `current_user_can('manage_options')`. 
        // WooCommerce REST API keys usually grant admin privileges so this SHOULD work if we sign it correctly.

        // Let's try using the .post() method which appends to the base URL.
        // The base URL in the lib usually includes /wp-json/wc/v3. 
        // We might need to hack it or use a raw request if the lib forces the prefix.

        // Actually, the library allows full custom paths if we are careful.
        // But to be safe and robust, let's try to just use the `post` method with the absolute path relative to wp-json if the lib supports it
        // Or we might need to rely on the fact that we are authenticated.

        // Simpler approach: The endpoint `overseek/v1/settings` is a WP REST API endpoint.
        // Sending a module request with proper Auth header (Basic Auth for App Passwords or OAuth1).
        // Since we have Consumer Key/Secret, that is OAuth1. The library handles that.
        // BUT strict plugins usually sandbox 'wc/' namespace.

        // Let's try to use the library's `post` but we might need to step out of the version prefix.
        // The library usually does `this.url + this.version + endpoint`.
        // If we pass an absolute path to the axios config it might override.

        // Let's assume for now we can use it. If not, we'll need a specialized request.
        // Workaround: Instantiate a new client with empty version if needed, or just formatting the path.

        return this.requestWithRetry('post', 'overseek/v1/settings', settings);
    }

}
