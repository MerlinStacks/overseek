/**
 * Route Registration Configuration
 * 
 * Centralized route registration for Fastify application.
 * Extracted from app.ts for maintainability.
 */

import { FastifyInstance } from 'fastify';

/**
 * Registers all API routes with Fastify
 * Note: Chat routes (requiring ChatService) are registered separately in initializeApp
 */
export async function registerRoutes(fastify: FastifyInstance): Promise<void> {
    // Core Routes
    const healthRoutes = (await import('../routes/health')).default;
    const customersRoutes = (await import('../routes/customers')).default;
    const ordersRoutes = (await import('../routes/orders')).default;
    const reviewsRoutes = (await import('../routes/reviews')).default;
    const segmentsRoutes = (await import('../routes/segments')).default;
    const policiesRoutes = (await import('../routes/policies')).default;
    const auditsRoutes = (await import('../routes/audits')).default;
    const sessionsRoutes = (await import('../routes/sessions')).default;
    const invoicesRoutes = (await import('../routes/invoices')).default;
    const notificationsRoutes = (await import('../routes/notifications')).default;
    const helpRoutes = (await import('../routes/help')).default;
    const searchRoutes = (await import('../routes/search')).default;
    const inventoryRoutes = (await import('../routes/inventory')).default;
    const aiRoutes = (await import('../routes/ai')).default;
    const dashboardRoutes = (await import('../routes/dashboard')).default;

    await fastify.register(healthRoutes, { prefix: '/health' });
    await fastify.register(customersRoutes, { prefix: '/api/customers' });
    await fastify.register(ordersRoutes, { prefix: '/api/orders' });
    await fastify.register(reviewsRoutes, { prefix: '/api/reviews' });
    await fastify.register(segmentsRoutes, { prefix: '/api/segments' });
    await fastify.register(policiesRoutes, { prefix: '/api/policies' });
    await fastify.register(auditsRoutes, { prefix: '/api/audits' });
    await fastify.register(sessionsRoutes, { prefix: '/api/sessions' });
    await fastify.register(invoicesRoutes, { prefix: '/api/invoices' });
    await fastify.register(notificationsRoutes, { prefix: '/api/notifications' });
    await fastify.register(helpRoutes, { prefix: '/api/help' });
    await fastify.register(searchRoutes, { prefix: '/api/search' });
    await fastify.register(inventoryRoutes, { prefix: '/api/inventory' });

    // Internal Products (nested under inventory)
    const internalProductsRoutes = (await import('../routes/internalProducts')).default;
    await fastify.register(internalProductsRoutes, { prefix: '/api/inventory/internal-products' });

    await fastify.register(aiRoutes, { prefix: '/api/ai' });
    await fastify.register(dashboardRoutes, { prefix: '/api/dashboard' });

    // Marketing & Ads
    const adsRoutes = (await import('../routes/ads')).default;
    await fastify.register(adsRoutes, { prefix: '/api/ads' });
    const marketingRoutes = (await import('../routes/marketing')).default;
    await fastify.register(marketingRoutes, { prefix: '/api/marketing' });

    // Email
    const emailRoutes = (await import('../routes/email')).default;
    await fastify.register(emailRoutes, { prefix: '/api/email' });
    const emailTrackingRoutes = (await import('../routes/email-tracking')).default;
    await fastify.register(emailTrackingRoutes, { prefix: '/api/email' });

    // Chat Widget (public widget script)
    const widgetRoutes = (await import('../routes/widget')).default;
    await fastify.register(widgetRoutes, { prefix: '/api/chat' });

    // Products
    const productsRoutes = (await import('../routes/products')).default;
    await fastify.register(productsRoutes, { prefix: '/api/products' });

    // Webhooks
    const metaWebhookRoutes = (await import('../routes/meta-webhook')).default;
    await fastify.register(metaWebhookRoutes, { prefix: '/api/webhook/meta' });
    const tiktokWebhookRoutes = (await import('../routes/tiktok-webhook')).default;
    await fastify.register(tiktokWebhookRoutes, { prefix: '/api/webhook/tiktok' });
    const webhookRoutes = (await import('../routes/webhook')).default;
    await fastify.register(webhookRoutes, { prefix: '/api/webhooks' });

    // WooCommerce & Sync
    const wooRoutes = (await import('../routes/woo')).default;
    await fastify.register(wooRoutes, { prefix: '/api/woo' });
    // Also register under /api/woocommerce (used by Setup Wizard StoreStep)
    const wooRoutesAlias = (await import('../routes/woo')).default;
    await fastify.register(wooRoutesAlias, { prefix: '/api/woocommerce' });
    const syncRoutes = (await import('../routes/sync')).default;
    await fastify.register(syncRoutes, { prefix: '/api/sync' });
    const statusCenterRoutes = (await import('../routes/statusCenter')).default;
    await fastify.register(statusCenterRoutes, { prefix: '/api/status-center' });

    // Admin & Auth
    const adminRoutes = (await import('../routes/admin')).default;
    await fastify.register(adminRoutes, { prefix: '/api/admin' });
    const rolesRoutes = (await import('../routes/roles')).default;
    await fastify.register(rolesRoutes, { prefix: '/api/roles' });
    const authRoutes = (await import('../routes/auth')).default;
    await fastify.register(authRoutes, { prefix: '/api/auth' });
    const accountRoutes = (await import('../routes/account')).default;
    await fastify.register(accountRoutes, { prefix: '/api/accounts' });
    const oauthRoutes = (await import('../routes/oauth')).default;
    await fastify.register(oauthRoutes, { prefix: '/api/oauth' });

    // Analytics & Tracking
    const analyticsRoutes = (await import('../routes/analytics')).default;
    await fastify.register(analyticsRoutes, { prefix: '/api/analytics' });
    const goldPriceReportRoutes = (await import('../routes/goldPriceReport')).default;
    await fastify.register(goldPriceReportRoutes, { prefix: '/api/reports' });
    const trackingRoutes = (await import('../routes/tracking')).default;
    await fastify.register(trackingRoutes, { prefix: '/api/tracking' });

    // Labels (conversation tagging)
    const labelsRoutes = (await import('../routes/labels')).default;
    await fastify.register(labelsRoutes, { prefix: '/api/labels' });

    // Short tracking URL for WooCommerce plugin
    const trackingIngestionRoutes = (await import('../routes/trackingIngestion')).default;
    await fastify.register(trackingIngestionRoutes, { prefix: '/api/t' });
}
