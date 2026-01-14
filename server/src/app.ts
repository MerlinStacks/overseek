require('dotenv').config();
// Force Restart Trigger

import Fastify, { FastifyRequest, FastifyReply, FastifyError } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import fastifyCompress from '@fastify/compress';
import fastifyMultipart from '@fastify/multipart';
import { Client } from '@elastic/elasticsearch';
import path from 'path';
import { prisma } from './utils/prisma';
import { esClient } from './utils/elastic';

import http from 'http';
import { Server } from 'socket.io';
import { ChatService } from './services/ChatService';
import { TrackingService } from './services/TrackingService';
import { QueueFactory, QUEUES } from './services/queue/QueueFactory';
import { EventBus, EVENTS } from './services/events';
import { AutomationEngine } from './services/AutomationEngine';
import { setIO } from './socket';
const { Logger, fastifyLoggerConfig } = require('./utils/logger');

// Init Queues for Bull Board
QueueFactory.init();

const automationEngine = new AutomationEngine(); // Keep for event listeners
import { InventoryService } from './services/InventoryService';
import { NotificationEngine } from './services/NotificationEngine';

// Initialize Inventory Listeners
InventoryService.setupListeners();

// Create Fastify instance
const fastify = Fastify({
    logger: fastifyLoggerConfig, // Disabled - using our own Logger wrapper to prevent duplicates
    disableRequestLogging: true, // Disable default logging to avoid double-logging with our custom hook
    trustProxy: true, // Trust Docker/Nginx proxy for Rate Limiting
});

// Build function to initialize all plugins and routes
async function build() {
    // Register CORS - permissive for tracking endpoints first
    await fastify.register(cors, {
        origin: (origin, cb) => {
            // Permissive for tracking endpoints (handled in route-level hook)
            // Strict for dashboard routes
            const allowedOrigins = process.env.CLIENT_URL
                ? [process.env.CLIENT_URL, 'http://localhost:5173']
                : ['http://localhost:5173'];

            if (!origin || allowedOrigins.includes(origin) || origin === '*') {
                cb(null, true);
            } else {
                cb(null, true); // For now, be permissive during migration
            }
        },
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'x-account-id', 'x-wc-webhook-signature', 'x-wc-webhook-topic'],
    });

    // Rate Limiting: 2000 requests per 15 minutes per IP
    await fastify.register(rateLimit, {
        max: 2000,
        timeWindow: '15 minutes',
        errorResponseBuilder: () => ({
            error: 'Too many requests, please try again later.'
        })
    });

    // Helmet security headers (with permissive CSP for Bull Board routes)
    await fastify.register(helmet, {
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                scriptSrc: ["'self'"],
                objectSrc: ["'none'"],
                upgradeInsecureRequests: [],
            }
        }
    });

    // Static file serving for uploads
    const uploadDir = path.join(__dirname, '../uploads');
    if (!require('fs').existsSync(uploadDir)) {
        require('fs').mkdirSync(uploadDir, { recursive: true });
    }
    await fastify.register(fastifyStatic, {
        root: path.join(__dirname, '../uploads'),
        prefix: '/uploads/',
    });

    // Response compression (Brotli/gzip)
    await fastify.register(fastifyCompress, {
        encodings: ['br', 'gzip', 'deflate'],
    });

    // Multipart file uploads (replaces multer)
    await fastify.register(fastifyMultipart, {
        limits: {
            fileSize: 100 * 1024 * 1024, // 100MB max
        },
    });

    // Request ID for correlation (hook)
    fastify.addHook('onRequest', async (request, reply) => {
        const existingId = request.headers['x-request-id'] as string;
        const requestId = existingId || `req-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
        (request as any).requestId = requestId;
        reply.header('x-request-id', requestId);
    });

    // Request Logging (hook)
    fastify.addHook('onRequest', async (request, reply) => {
        const start = Date.now();
        (request as any).startTime = start;
    });

    fastify.addHook('onResponse', async (request, reply) => {
        const duration = Date.now() - ((request as any).startTime || Date.now());
        if (!request.url.includes('/health')) {
            Logger.http(`${request.method} ${request.url}`, {
                status: reply.statusCode,
                duration: `${duration}ms`,
                requestId: (request as any).requestId,
            });
        }
    });

    // Global: Disable caching for all API responses
    fastify.addHook('onSend', async (request, reply, payload) => {
        reply.header('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        reply.header('Pragma', 'no-cache');
        reply.header('Expires', '0');
        return payload;
    });

    // =====================================================
    // ALL ROUTES ARE NOW NATIVE FASTIFY PLUGINS
    // Express bridge removed - migration complete!
    // =====================================================

    const healthRoutes = (await import('./routes/health')).default;
    const customersRoutes = (await import('./routes/customers')).default;
    const ordersRoutes = (await import('./routes/orders')).default;
    const reviewsRoutes = (await import('./routes/reviews')).default;
    const segmentsRoutes = (await import('./routes/segments')).default;
    const policiesRoutes = (await import('./routes/policies')).default;
    const todoRoutes = (await import('./routes/todo')).default;
    const auditsRoutes = (await import('./routes/audits')).default;
    const sessionsRoutes = (await import('./routes/sessions')).default;
    const invoicesRoutes = (await import('./routes/invoices')).default;
    const notificationsRoutes = (await import('./routes/notifications')).default;
    const helpRoutes = (await import('./routes/help')).default;
    const searchRoutes = (await import('./routes/search')).default;
    const inventoryRoutes = (await import('./routes/inventory')).default;
    const aiRoutes = (await import('./routes/ai')).default;
    const dashboardRoutes = (await import('./routes/dashboard')).default;

    // Register native Fastify plugins
    await fastify.register(healthRoutes, { prefix: '/health' });
    await fastify.register(customersRoutes, { prefix: '/api/customers' });
    await fastify.register(ordersRoutes, { prefix: '/api/orders' });
    await fastify.register(reviewsRoutes, { prefix: '/api/reviews' });
    await fastify.register(segmentsRoutes, { prefix: '/api/segments' });
    await fastify.register(policiesRoutes, { prefix: '/api/policies' });
    await fastify.register(todoRoutes, { prefix: '/api/todos' });
    await fastify.register(auditsRoutes, { prefix: '/api/audits' });
    await fastify.register(sessionsRoutes, { prefix: '/api/sessions' });
    await fastify.register(invoicesRoutes, { prefix: '/api/invoices' });
    await fastify.register(notificationsRoutes, { prefix: '/api/notifications' });
    await fastify.register(helpRoutes, { prefix: '/api/help' });
    await fastify.register(searchRoutes, { prefix: '/api/search' });
    await fastify.register(inventoryRoutes, { prefix: '/api/inventory' });
    await fastify.register(aiRoutes, { prefix: '/api/ai' });
    await fastify.register(dashboardRoutes, { prefix: '/api/dashboard' });
    const adsRoutes = (await import('./routes/ads')).default;
    await fastify.register(adsRoutes, { prefix: '/api/ads' });
    const marketingRoutes = (await import('./routes/marketing')).default;
    await fastify.register(marketingRoutes, { prefix: '/api/marketing' });
    const emailRoutes = (await import('./routes/email')).default;
    await fastify.register(emailRoutes, { prefix: '/api/email' });
    const emailTrackingRoutes = (await import('./routes/email-tracking')).default;
    await fastify.register(emailTrackingRoutes, { prefix: '/api/email' });
    const widgetRoutes = (await import('./routes/widget')).default;
    await fastify.register(widgetRoutes, { prefix: '/api/chat' });
    const productsRoutes = (await import('./routes/products')).default;
    await fastify.register(productsRoutes, { prefix: '/api/products' });
    const metaWebhookRoutes = (await import('./routes/meta-webhook')).default;
    await fastify.register(metaWebhookRoutes, { prefix: '/api/webhook/meta' });
    const tiktokWebhookRoutes = (await import('./routes/tiktok-webhook')).default;
    await fastify.register(tiktokWebhookRoutes, { prefix: '/api/webhook/tiktok' });
    const wooRoutes = (await import('./routes/woo')).default;
    await fastify.register(wooRoutes, { prefix: '/api/woo' });
    const syncRoutes = (await import('./routes/sync')).default;
    await fastify.register(syncRoutes, { prefix: '/api/sync' });
    const webhookRoutes = (await import('./routes/webhook')).default;
    await fastify.register(webhookRoutes, { prefix: '/api/webhooks' });
    const adminRoutes = (await import('./routes/admin')).default;
    await fastify.register(adminRoutes, { prefix: '/api/admin' });
    const rolesRoutes = (await import('./routes/roles')).default;
    await fastify.register(rolesRoutes, { prefix: '/api/roles' });
    const authRoutes = (await import('./routes/auth')).default;
    await fastify.register(authRoutes, { prefix: '/api/auth' });
    const accountRoutes = (await import('./routes/account')).default;
    await fastify.register(accountRoutes, { prefix: '/api/accounts' });
    const oauthRoutes = (await import('./routes/oauth')).default;
    await fastify.register(oauthRoutes, { prefix: '/api/oauth' });
    const analyticsRoutes = (await import('./routes/analytics')).default;
    await fastify.register(analyticsRoutes, { prefix: '/api/analytics' });
    const trackingRoutes = (await import('./routes/tracking')).default;
    await fastify.register(trackingRoutes, { prefix: '/api/tracking' });

    // Labels routes (conversation tagging)
    const labelsRoutes = (await import('./routes/labels')).default;
    await fastify.register(labelsRoutes, { prefix: '/api/labels' });

    // Alias for short tracking URL used by WooCommerce plugin (OverSeek Integration)
    // The plugin sends events to /api/t/e which maps to /api/t prefix + /e route
    const trackingIngestionRoutes = (await import('./routes/trackingIngestion')).default;
    await fastify.register(trackingIngestionRoutes, { prefix: '/api/t' });

    // =====================================================
    // ALL ROUTES NOW NATIVE FASTIFY ✓
    // Express bridge no longer needed for routes
    // =====================================================

    // Chat routes need special handling (require ChatService)
    // We'll mount these after server creation

    // Mount Bull Board (Fastify native)
    const bullBoardAdapter = QueueFactory.createBoard();
    await fastify.register(bullBoardAdapter.registerPlugin(), {
        prefix: '/admin/queues',
    });

    // Native Fastify health check
    fastify.get('/health-fastify', async (request, reply) => {
        let esStatus = 'disconnected';
        try {
            const health = await esClient.cluster.health();
            esStatus = health.status;
            if (esStatus !== 'red') {
                const { IndexingService } = await import('./services/search/IndexingService');
                await IndexingService.initializeIndices();
            }
        } catch (error) {
            esStatus = 'unreachable';
        }

        return {
            status: 'ok',
            framework: 'fastify',
            timestamp: new Date().toISOString(),
            services: {
                elasticsearch: esStatus,
                socket: 'active'
            }
        };
    });

    // Global Error Handler with structured responses
    fastify.setErrorHandler((error: FastifyError, request, reply) => {
        const statusCode = error.statusCode || 500;
        const isClientError = statusCode >= 400 && statusCode < 500;

        // Only log server errors as errors, client errors as warnings
        if (isClientError) {
            Logger.warn('Client Error', {
                error: error.message,
                path: request.url,
                method: request.method,
                statusCode,
            });
        } else {
            Logger.error('Server Error', {
                error: error.message,
                stack: error.stack,
                path: request.url,
                method: request.method,
                requestId: (request as any).requestId,
            });
        }

        reply.status(statusCode).send({
            error: isClientError ? error.message : 'Internal Server Error',
            statusCode,
            requestId: (request as any).requestId,
        });
    });

    // Graceful Shutdown Hook
    fastify.addHook('onClose', async (instance) => {
        Logger.info('Graceful shutdown initiated...');
        await prisma.$disconnect();
        Logger.info('Prisma disconnected.');
    });

    return fastify;
}

// Create HTTP server from Fastify for Socket.IO compatibility
let server: http.Server;
let io: Server;
let chatService: ChatService;

// Async initialization
async function initializeApp() {
    await build();

    // Get the underlying HTTP server from Fastify
    server = fastify.server;

    // Setup Socket.IO
    io = new Server(server, {
        cors: {
            origin: process.env.CORS_ORIGIN || "*",
            methods: ["GET", "POST"]
        }
    });

    // Apply Redis adapter for horizontal scaling (multi-instance support)
    try {
        const { createSocketAdapter } = await import('./utils/socketAdapter');
        io.adapter(createSocketAdapter());
        Logger.info('[Socket.IO] Redis adapter enabled for horizontal scaling');
    } catch (error) {
        Logger.warn('[Socket.IO] Redis adapter not available, running in single-instance mode', { error });
    }

    // Register Socket.IO globally for services
    setIO(io);

    // Initialize Chat Service
    chatService = new ChatService(io);

    // Mount Chat Routes (native Fastify - require ChatService)
    const { createChatRoutes } = await import('./routes/chat');
    const { createPublicChatRoutes } = await import('./routes/chat-public');
    await fastify.register(createChatRoutes(chatService), { prefix: '/api/chat' });
    await fastify.register(createPublicChatRoutes(chatService), { prefix: '/api/chat/public' });

    // Listen for Automation Events
    EventBus.on(EVENTS.ORDER.CREATED, async (data) => {
        await automationEngine.processTrigger(data.accountId, 'ORDER_CREATED', data.order);
    });

    EventBus.on(EVENTS.REVIEW.LEFT, async (data) => {
        await automationEngine.processTrigger(data.accountId, 'REVIEW_LEFT', data.review);
    });

    EventBus.on(EVENTS.EMAIL.RECEIVED, async (data) => {
        // EmailIngestion.handleIncomingEmail already handles push notifications
        // with proper accountId lookup from emailAccountId
        await chatService.handleIncomingEmail(data);
    });

    // Initialize Notification Engine (handles push notifications for all events)
    NotificationEngine.init();

    // Socket.io Connection Logic
    io.on('connection', (socket) => {
        socket.on('join:account', (accountId) => {
            Logger.warn(`[Socket] Client joined account room: account:${accountId}`, { socketId: socket.id });
            socket.join(`account:${accountId}`);
        });

        // Conversation presence tracking for collision detection
        socket.on('join:conversation', async ({ conversationId, user }) => {
            socket.join(`conversation:${conversationId}`);

            // Track viewer presence if user info provided
            if (user && conversationId) {
                const userInfo = {
                    userId: user.id || 'anon',
                    name: user.name || 'Anonymous',
                    avatarUrl: user.avatarUrl,
                    connectedAt: Date.now()
                };
                const { CollaborationService } = await import('./services/CollaborationService');
                await CollaborationService.joinDocument(`conv:${conversationId}`, socket.id, userInfo);
                const viewers = await CollaborationService.getPresence(`conv:${conversationId}`);
                io.to(`conversation:${conversationId}`).emit('viewers:sync', viewers);
            }
        });

        socket.on('leave:conversation', async ({ conversationId }) => {
            socket.leave(`conversation:${conversationId}`);

            // Remove from presence tracking
            if (conversationId) {
                const { CollaborationService } = await import('./services/CollaborationService');
                await CollaborationService.leaveDocument(`conv:${conversationId}`, socket.id);
                const viewers = await CollaborationService.getPresence(`conv:${conversationId}`);
                io.to(`conversation:${conversationId}`).emit('viewers:sync', viewers);
            }
        });

        // Handle disconnect - clean up conversation presence
        socket.on('disconnecting', async () => {
            const rooms: string[] = Array.from(socket.rooms) as string[];
            const convRooms = rooms.filter((r: string) => r.startsWith('conversation:'));

            const { CollaborationService } = await import('./services/CollaborationService');
            for (const room of convRooms) {
                const conversationId = room.replace('conversation:', '');
                await CollaborationService.leaveDocument(`conv:${conversationId}`, socket.id);
                const viewers = await CollaborationService.getPresence(`conv:${conversationId}`);
                io.to(room).emit('viewers:sync', viewers);
            }
        });

        socket.on('typing:start', ({ conversationId }) => {
            socket.to(`conversation:${conversationId}`).emit('typing:start', { conversationId });
        });

        socket.on('typing:stop', ({ conversationId }) => {
            socket.to(`conversation:${conversationId}`).emit('typing:stop', { conversationId });
        });

        socket.on('join:document', async ({ docId, user }) => {
            socket.join(`document:${docId}`);
            const userInfo = {
                userId: user.id || 'anon',
                name: user.name || 'Anonymous',
                avatarUrl: user.avatarUrl,
                color: user.color,
                connectedAt: Date.now()
            };

            const { CollaborationService } = await import('./services/CollaborationService');
            await CollaborationService.joinDocument(docId, socket.id, userInfo);
            const presenceList = await CollaborationService.getPresence(docId);
            io.to(`document:${docId}`).emit('presence:sync', presenceList);
        });

        socket.on('leave:document', async ({ docId }) => {
            socket.leave(`document:${docId}`);
            const { CollaborationService } = await import('./services/CollaborationService');
            await CollaborationService.leaveDocument(docId, socket.id);
            const presenceList = await CollaborationService.getPresence(docId);
            io.to(`document:${docId}`).emit('presence:sync', presenceList);
        });

        /*
        socket.on('disconnecting', async () => {
            const rooms: string[] = Array.from(socket.rooms) as string[];
            const docRooms = rooms.filter((r: any) => r.startsWith('document:'));

            const { CollaborationService } = await import('./services/CollaborationService');
            for (const room of docRooms) {
                const docId = room.replace('document:', '');
                await CollaborationService.leaveDocument(docId, socket.id);
                const presenceList = await CollaborationService.getPresence(docId);
                io.to(room).emit('presence:sync', presenceList);
            }
        });
        */
    });

    // --- CRON / SCHEDULERS ---
    setInterval(async () => {
        try {
            await automationEngine.runTicker();
        } catch (e) {
            Logger.error('Ticker Error', { error: e as Error });
        }
    }, 60000);
}

// Initialize on import
const appPromise = initializeApp();

// Export fastify instance, server, io, automationEngine
// Note: These may not be ready immediately - use appPromise to wait
export { fastify as app, server, io, automationEngine, appPromise };
