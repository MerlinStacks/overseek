import dotenv from 'dotenv';
dotenv.config();
// Force Restart Trigger

import express, { Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { Client } from '@elastic/elasticsearch';
import authRoutes from './routes/auth';
import accountRoutes from './routes/account';
import wooRoutes from './routes/woo';
import syncRoutes from './routes/sync';
import webhookRoutes from './routes/webhook';
import adsRoutes from './routes/ads';
import dashboardRoutes from './routes/dashboard';
import path from 'path';
import { prisma } from './utils/prisma';
import analyticsRoutes from './routes/analytics';
import productsRoutes from './routes/products';
import customersRoutes from './routes/customers';
import searchRoutes from './routes/search';
import aiRoutes from './routes/ai';
import notificationRoutes from './routes/notifications';
import inventoryRoutes from './routes/inventory';
import reviewRoutes from './routes/reviews';
import helpRoutes from './routes/help';
import trackingRoutes from './routes/tracking';
import marketingRoutes from './routes/marketing';
import emailRoutes from './routes/email';
import ordersRoutes from './routes/orders'; // Mount Orders API
import invoicesRoutes from './routes/invoices';
import oauthRoutes from './routes/oauth'; // OAuth flows for ad platforms

import segmentsRoutes from './routes/segments';
import policiesRoutes from './routes/policies';
import { auditsRouter } from './routes/audits';
import sessionsRoutes from './routes/sessions';

// Social Messaging Webhooks
import metaWebhookRoutes from './routes/meta-webhook';
import tiktokWebhookRoutes from './routes/tiktok-webhook';

import { esClient } from './utils/elastic';

import http from 'http';
import { Server } from 'socket.io';
import { createChatRouter } from './routes/chat';
import { createPublicChatRouter } from './routes/chat-public'; // New
import widgetRouter from './routes/widget'; // New
import { ChatService } from './services/ChatService';
import { TrackingService } from './services/TrackingService';
import { QueueFactory, QUEUES } from './services/queue/QueueFactory';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { EventBus, EVENTS } from './services/events';
import { AutomationEngine } from './services/AutomationEngine';
import { Logger } from './utils/logger';

// Init Queues for Bull Board
QueueFactory.init();

const automationEngine = new AutomationEngine(); // Keep for event listeners
import { InventoryService } from './services/InventoryService';

// Initialize Inventory Listeners
InventoryService.setupListeners();

const app = express();

// Security & Middleware
app.set('trust proxy', 1); // Trust Docker/Nginx proxy for Rate Limiting

// Permissive CORS for public tracking endpoints (must come before strict CORS)
// These endpoints are called from any WooCommerce store domain
app.use('/api/tracking', cors({
    origin: '*', // Allow any origin (WooCommerce stores)
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type']
}));
app.use('/api/t', cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type']
}));

// Strict CORS for dashboard/authenticated routes
app.use(cors({
    origin: process.env.CLIENT_URL ? [process.env.CLIENT_URL, 'http://localhost:5173'] : 'http://localhost:5173', // Restrict to known client
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-account-id', 'x-wc-webhook-signature', 'x-wc-webhook-topic']
}));

// Rate Limiting: 2000 requests per 15 minutes per IP (Accommodate 2s polling)
// eslint-disable-next-line @typescript-eslint/no-var-requires
const rateLimit = require('express-rate-limit');
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 2000, // Increased from 100 to support polling
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
    message: { error: 'Too many requests, please try again later.' }
});
app.use(limiter);

// Permissive CSP for Bull Board (requires inline scripts/styles)
app.use('/admin/queues', helmet({
    contentSecurityPolicy: false, // Disable CSP for Bull Board UI
    crossOriginEmbedderPolicy: false,
}));

// Helmet CSP & Security Headers (strict for all other routes)
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"], // Strict script source
            objectSrc: ["'none'"],
            upgradeInsecureRequests: [],
        }
    }
}));



app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Request ID for correlation
import { requestId } from './middleware/requestId';
app.use(requestId);

// Request Logging (uses request ID)
import { requestLogger } from './middleware/requestLogger';
app.use(requestLogger);

// Global: Disable caching for all API responses to ensure fresh data
app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    next();
});

// Create HTTP server and Socket.IO
const server = http.createServer(app);
// Force restart
const io = new Server(server, {
    cors: {
        origin: process.env.CORS_ORIGIN || "*", // Allow all for dev, tighten in prod
        methods: ["GET", "POST"]
    }
});

// Initialize Chat Service
const chatService = new ChatService(io);

import adminRoutes from './routes/admin';
import debugRoutes from './routes/debug';
import healthRoutes from './routes/health';

// Routes
app.use('/health', healthRoutes); // Health check (no auth)
app.use('/api/debug', debugRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/accounts', accountRoutes);
app.use('/api/woo', wooRoutes);
app.use('/api/sync', syncRoutes);
app.use('/api/webhooks', webhookRoutes);
app.use('/api/ads', adsRoutes);
app.use('/api/dashboard', dashboardRoutes);

app.use('/api/analytics', analyticsRoutes);
app.use('/api/products', productsRoutes);
app.use('/api/customers', customersRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/help', helpRoutes);
app.use('/api/tracking', trackingRoutes);
app.use('/api/t', trackingRoutes); // Short alias for ad blocker bypass
app.use('/api/marketing', marketingRoutes); // Mount Marketing API
app.use('/api/invoices', invoicesRoutes); // Mount Invoices API
app.use('/api/email', emailRoutes);
app.use('/api/segments', segmentsRoutes);
app.use('/api/policies', policiesRoutes);
app.use('/api/orders', ordersRoutes); // Mount Orders API
app.use('/api/audits', auditsRouter);
app.use('/api/sessions', sessionsRoutes);
app.use('/api/oauth', oauthRoutes); // OAuth flows for Google Ads, Meta

// Mount Chat Routes
app.use('/api/chat', createChatRouter(chatService));
app.use('/api/chat/public', createPublicChatRouter(chatService)); // Public API
app.use('/api/chat', widgetRouter); // Serves /api/chat/widget.js

// Mount Social Messaging Webhooks (Public - no auth, validated by signatures)
app.use('/api/webhook/meta', metaWebhookRoutes);
app.use('/api/webhook/tiktok', tiktokWebhookRoutes);

// Mount Bull Board (Protected - Super Admin Only)
Logger.info('[BullBoard] Initializing Bull Board...');
const serverAdapter = QueueFactory.createBoard();
Logger.info('[BullBoard] Mounting at /admin/queues (Protected)');
import { requireAuth, requireSuperAdmin } from './middleware/auth';
app.use('/admin/queues', requireAuth, requireSuperAdmin, serverAdapter.getRouter());

// Listen for Automation Events
EventBus.on(EVENTS.ORDER.CREATED, async (data) => {
    // console.log('Event Received: Order Created', data.accountId);
    await automationEngine.processTrigger(data.accountId, 'ORDER_CREATED', data.order);
});

EventBus.on(EVENTS.REVIEW.LEFT, async (data) => {
    await automationEngine.processTrigger(data.accountId, 'REVIEW_LEFT', data.review);
});

EventBus.on(EVENTS.EMAIL.RECEIVED, async (data) => {
    await chatService.handleIncomingEmail(data);

    // Send push notification for new message
    const { PushNotificationService } = require('./services/PushNotificationService');
    await PushNotificationService.sendToAccount(data.accountId, {
        title: '📨 New Message',
        body: `From: ${data.fromName || data.fromEmail}`,
        data: { url: '/inbox' }
    }, 'message');
});

// Social Messaging Push Notifications
EventBus.on(EVENTS.SOCIAL.MESSAGE_RECEIVED, async (data) => {
    const { PushNotificationService } = require('./services/PushNotificationService');
    const platformLabel = data.platform === 'FACEBOOK' ? '💬 Messenger'
        : data.platform === 'INSTAGRAM' ? '📷 Instagram'
            : '🎵 TikTok';

    await PushNotificationService.sendToAccount(data.accountId, {
        title: `${platformLabel} Message`,
        body: 'New message received',
        data: { url: '/inbox', conversationId: data.conversationId }
    }, 'message');
});

// Health Check
app.get('/health', async (req: Request, res: Response) => {
    let esStatus = 'disconnected';
    try {
        const health = await esClient.cluster.health();
        esStatus = health.status;
        if (esStatus !== 'red') { // Basic check, ideally wait for green/yellow
            // Ensure indices exist
            const { IndexingService } = require('./services/search/IndexingService');
            await IndexingService.initializeIndices();
        }
    } catch (error) {
        // console.error('Elasticsearch health check failed');
        esStatus = 'unreachable';
    }

    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        services: {
            elasticsearch: esStatus,
            socket: 'active'
        }
    });
});

// Socket.io Connection Logic
io.on('connection', (socket) => {
    // console.log('New client connected:', socket.id);

    socket.on('join:account', (accountId) => {
        socket.join(`account:${accountId}`);
    });

    socket.on('join:conversation', (convId) => {
        socket.join(`conversation:${convId}`);
    });

    socket.on('leave:conversation', (convId) => {
        socket.leave(`conversation:${convId}`);
    });

    // Collaboration Events
    socket.on('join:document', async ({ docId, user }) => {
        // console.log(`Socket ${socket.id} joining doc ${docId}`);
        socket.join(`document:${docId}`);

        // Add to Redis Presence
        const userInfo = {
            userId: user.id || 'anon',
            name: user.name || 'Anonymous',
            avatarUrl: user.avatarUrl,
            color: user.color, // Expect client to generate/assign color
            connectedAt: Date.now()
        };

        const { CollaborationService } = require('./services/CollaborationService');
        await CollaborationService.joinDocument(docId, socket.id, userInfo);

        // Broadcast updated presence to room
        const presenceList = await CollaborationService.getPresence(docId);
        io.to(`document:${docId}`).emit('presence:sync', presenceList);
    });

    socket.on('leave:document', async ({ docId }) => {
        // console.log(`Socket ${socket.id} leaving doc ${docId}`);
        socket.leave(`document:${docId}`);

        const { CollaborationService } = require('./services/CollaborationService');
        await CollaborationService.leaveDocument(docId, socket.id);

        const presenceList = await CollaborationService.getPresence(docId);
        io.to(`document:${docId}`).emit('presence:sync', presenceList);
    });

    socket.on('disconnect', async () => {
        // console.log('Client disconnected:', socket.id);

        // Cleanup Presence
        // We need to know which docs they were in. 
        // Socket.io automatically leaves rooms, but we need to update Redis.
        // It's hard to get rooms AFTER disconnect (they are gone).
        // Best approach: Store `socketId -> [docIds]` in Redis or rely on client `leave:document` before unload (unreliable).
        // Or: Use `disconnecting` event where rooms are still available.
    });

    socket.on('disconnecting', async () => {
        const rooms = Array.from(socket.rooms); // Set of rooms
        // Filter for document rooms, e.g. "document:product:123"
        const docRooms = rooms.filter(r => r.startsWith('document:'));

        const { CollaborationService } = require('./services/CollaborationService');
        for (const room of docRooms) {
            const docId = room.replace('document:', '');
            await CollaborationService.leaveDocument(docId, socket.id);
            // We can't emit to the room easily if we are disconnecting, ensuring remaining clients get update?
            // Yes, we can still emit to the room (or use broadcast from this socket)
            // But we can't await the fetch inside the loop easily without delaying disconnect.
            // Better to just fire and forget the update or let the next heartbeat fix it?
            // Let's try to notify.
            const presenceList = await CollaborationService.getPresence(docId);
            io.to(room).emit('presence:sync', presenceList);
        }
    });
});

// --- CRON / SCHEDULERS ---

// 1. Automation Ticker (Run every minute)
setInterval(async () => {
    try {
        await automationEngine.runTicker();
    } catch (e) {
        Logger.error('Ticker Error', { error: e });
    }
}, 60000);

// 2. Abandoned Cart Detection - REMOVED: Handled by SchedulerService.ts to prevent duplicates

// Global Error Handler (must be last middleware)
app.use((err: Error, req: Request, res: Response, next: Function) => {
    Logger.error('Unhandled Error', {
        error: err.message,
        stack: err.stack,
        path: req.path,
        method: req.method
    });
    res.status(500).json({ error: 'Internal Server Error' });
});

export { app, server, io, automationEngine };

