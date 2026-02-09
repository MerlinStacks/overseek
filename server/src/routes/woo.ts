/**
 * Woo Route - Fastify Plugin
 */

import { FastifyPluginAsync } from 'fastify';
import { WooService } from '../services/woo';
import { requireAuthFastify } from '../middleware/auth';
import { Logger } from '../utils/logger';

const wooRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.addHook('preHandler', requireAuthFastify);

    /**
     * POST /test — Verify WooCommerce credentials without creating an account.
     * Used by the Setup Wizard's "Test Connection" button (StoreStep).
     */
    fastify.post('/test', async (request, reply) => {
        try {
            const { wooUrl, wooConsumerKey, wooConsumerSecret } = request.body as any;

            if (!wooUrl || !wooConsumerKey || !wooConsumerSecret) {
                return reply.code(400).send({
                    success: false,
                    error: 'Store URL, Consumer Key, and Consumer Secret are all required.'
                });
            }

            // Create a temporary WooService to test the credentials
            const woo = new WooService({
                url: wooUrl,
                consumerKey: wooConsumerKey,
                consumerSecret: wooConsumerSecret
            });

            const status = await woo.getSystemStatus();
            const storeInfo = status?.data?.environment || status?.environment || {};

            return {
                success: true,
                storeName: storeInfo.site_title || storeInfo.home_url || wooUrl,
                wooVersion: storeInfo.version || 'unknown'
            };
        } catch (error: any) {
            const statusCode = error.response?.status;
            let userMessage = 'Could not connect to WooCommerce store.';

            if (statusCode === 401 || statusCode === 403) {
                userMessage = 'Invalid credentials. Please check your Consumer Key and Secret, and ensure they have Read/Write permissions.';
            } else if (statusCode === 404) {
                userMessage = 'WooCommerce REST API not found. Please check that WooCommerce is installed and the store URL is correct (e.g. https://mystore.com).';
            } else if (error.code === 'ENOTFOUND') {
                userMessage = 'Could not reach the store URL. Please check the domain is correct and accessible.';
            } else if (error.code === 'ECONNREFUSED') {
                userMessage = 'Connection refused. Is your store server running?';
            }

            Logger.error('WooCommerce connection test failed', {
                error: error.message,
                status: statusCode,
                url: (request.body as any)?.wooUrl
            });

            return reply.code(statusCode === 401 || statusCode === 403 ? 401 : 400).send({
                success: false,
                error: userMessage
            });
        }
    });

    fastify.get('/orders', async (request, reply) => {
        try {
            const accountId = request.accountId;
            if (!accountId) return reply.code(400).send({ error: 'No account selected' });

            const woo = await WooService.forAccount(accountId);
            const orders = await woo.getOrders({ per_page: 20 });

            return orders;
        } catch (error: any) {
            Logger.error('Woo API Error', { error: error.response?.data || error.message });
            return reply.code(500).send({ error: 'Failed to fetch orders' });
        }
    });

    fastify.get('/products', async (request, reply) => {
        try {
            const accountId = request.accountId;
            if (!accountId) return reply.code(400).send({ error: 'No account selected' });

            const woo = await WooService.forAccount(accountId);
            const query = request.query as Record<string, any>;
            const products = await woo.getProducts({
                ...query,
                per_page: Number(query.per_page) || 20
            });

            return products;
        } catch (error: any) {
            Logger.error('Woo API Error', { error: error.response?.data || error.message });
            return reply.code(500).send({ error: 'Failed to fetch products' });
        }
    });

    fastify.post('/configure', async (request, reply) => {
        try {
            const accountId = request.accountId;
            const { origin, wooUrl, wooConsumerKey, wooConsumerSecret } = request.body as any;

            if (!accountId) return reply.code(400).send({ error: 'No account selected' });
            const cleanOrigin = origin ? origin.replace(/\/$/, '') : '';
            if (!cleanOrigin) return reply.code(400).send({ error: 'Origin URL is required' });

            let woo;
            if (wooUrl && wooConsumerKey && wooConsumerSecret) {
                woo = new WooService({
                    url: wooUrl,
                    consumerKey: wooConsumerKey,
                    consumerSecret: wooConsumerSecret,
                    accountId: accountId
                });
            } else {
                woo = await WooService.forAccount(accountId);
            }

            try {
                await woo.getSystemStatus();
            } catch (authError: any) {
                Logger.error('Credential Verification Failed', { error: authError.message });
                return reply.code(401).send({
                    error: 'Invalid WooCommerce Credentials. Please check your Consumer Key and Secret.',
                    details: authError.message
                });
            }

            try {
                const result = await woo.updatePluginSettings({
                    account_id: accountId,
                    api_url: cleanOrigin
                });
                return { success: true, plugin_response: result };
            } catch (pluginError: any) {
                Logger.error('Plugin Settings Update Failed', { error: pluginError.message });

                if (pluginError.response?.status === 401) {
                    return reply.code(401).send({
                        error: 'Configuration failed. Your API Key appears to be "Read Only". Please generate new WooCommerce keys with "Read/Write" permissions.',
                        details: pluginError.response.data
                    });
                }

                throw pluginError;
            }
        } catch (error: any) {
            const errorDetails = {
                message: error.message,
                response: error.response?.data,
                status: error.response?.status,
                headers: error.response?.headers,
                url: error.config?.url
            };
            Logger.error('Woo Configuration Error', { errorDetails });

            let userMessage = 'Failed to configure plugin';
            if (error.response?.status === 404) {
                userMessage = 'Plugin endpoint not found on your store. Please ensure the OverSeek Helper Plugin is installed and active.';
            } else if (error.code === 'ENOTFOUND') {
                userMessage = 'Could not DNS resolve your store URL. Please check your domain settings.';
            } else if (error.message.includes('ECONNREFUSED')) {
                userMessage = 'Connection refused. Is your store server reachable?';
            }

            return reply.code(500).send({
                error: `${userMessage} (${error.message}) - ${JSON.stringify(error.response?.data || {})}`,
                technical_details: error.message,
                woo_response: error.response?.data
            });
        }
    });
};

export default wooRoutes;
