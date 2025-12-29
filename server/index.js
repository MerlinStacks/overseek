const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 4000;

const redis = require('redis');
const axios = require('axios');

// Redis Client
const redisClient = redis.createClient({
    url: process.env.REDIS_URL || 'redis://redis:6379'
});
redisClient.connect().catch(console.error);

// Middleware
app.use(cors());
app.use(express.json());

// Database Connection
const pool = new Pool({
    connectionString: process.env.DATABASE_URL
});

// --- Simple In-Memory Log Buffer ---
const LOG_BUFFER = [];
const MAX_LOGS = 100;

function captureLog(level, args) {
    const timestamp = new Date().toISOString();
    const message = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : a)).join(' ');
    LOG_BUFFER.unshift({ timestamp, level, message });
    if (LOG_BUFFER.length > MAX_LOGS) LOG_BUFFER.pop();
}

// monkey-patch console
const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn;

console.log = (...args) => {
    captureLog('INFO', args);
    originalLog.apply(console, args);
};
console.error = (...args) => {
    captureLog('ERROR', args);
    originalError.apply(console, args);
};
console.warn = (...args) => {
    captureLog('WARN', args);
    originalWarn.apply(console, args);
};

// Admin: Get Logs
app.get('/admin/logs', (req, res) => {
    res.json(LOG_BUFFER);
});

// Health Check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date() });
});

// Admin: Restart Server
app.post('/admin/restart', (req, res) => {
    console.log('Restart signal received. Shutting down...');
    res.json({ message: 'Server restarting...' });
    setTimeout(() => {
        process.exit(1);
    }, 1000);
});

// Admin: Clear Cache
app.post('/admin/cache/clear', async (req, res) => {
    try {
        await redisClient.flushAll();
        console.log('Redis Cache Flushed by Admin');
        res.json({ message: 'Cache cleared successfully' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Admin: Ping / Diagnostic
app.post('/admin/ping', async (req, res) => {
    let { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL is required' });

    // Helper: If user tests "localhost", assume they mean the HOST machine's localhost,
    // not the container's localhost.
    if (url.includes('localhost') || url.includes('127.0.0.1')) {
        // This relies on host.docker.internal working or extra_hosts handling it.
        // For standard Docker on Windows/Mac, this usually works.
        // For Linux, they might need config. We'll try it and fallback or advice.
        console.log(`Rewriting localhost URL for Docker: ${url}`);
        url = url.replace(/localhost|127\.0\.0\.1/, 'host.docker.internal');
    }

    try {
        const start = Date.now();
        // Use a reasonable timeout and validate status
        await axios.head(url, {
            timeout: 5000,
            validateStatus: () => true // Accept all status codes as "reachable" (e.g. 401 is fine, means we reached it)
        });
        const latency = Date.now() - start;
        res.json({ status: 'ok', latency, url });
    } catch (e) {
        console.error(`Ping failed for ${url}:`, e.message);

        // Detailed error for client
        let errorMsg = e.message;
        if (e.code === 'ENOTFOUND') errorMsg = 'DNS Lookup Failed (Invalid Domain)';
        if (e.code === 'ECONNREFUSED') errorMsg = 'Connection Refused (Is the server running?)';
        if (e.code === 'ETIMEDOUT') errorMsg = 'Connection Timed Out';

        res.status(500).json({ status: 'error', error: errorMsg, url, code: e.code });
    }
});

// --- Database Initialization ---
const initDB = async () => {
    try {
        const client = await pool.connect();
        await client.query(`
            CREATE TABLE IF NOT EXISTS orders (
                id BIGINT PRIMARY KEY,
                data JSONB,
                synced_at TIMESTAMPTZ DEFAULT NOW()
            );
        `);
        console.log('PostgreSQL initialized: "orders" table ready.');
        client.release();
    } catch (err) {
        console.error('Failed to initialize PostgreSQL:', err.message);
    }
};
initDB();

// PROXY: WooCommerce API with Redis Cache
app.all('/api/proxy/*', async (req, res) => {
    const endpoint = req.params[0]; // e.g., 'products', 'orders'
    const query = new URLSearchParams(req.query).toString();
    const cacheKey = `wc:${endpoint}:${query}`;

    // Caching Rules: Only GET, and Exclude specific namespaces (real-time status/actions)
    const isCacheable = req.method === 'GET' &&
        !endpoint.startsWith('overseek') &&
        !endpoint.startsWith('wc-dash') &&
        !endpoint.startsWith('woodash');

    // Helper: Safe Cache (Fail-Open)
    const safeCache = {
        get: async (key) => {
            try {
                if (!redisClient.isOpen) return null;
                return await redisClient.get(key);
            } catch (e) {
                console.warn(`[Redis] Get Failed: ${e.message}`);
                return null;
            }
        },
        set: async (key, val, opts) => {
            try {
                if (!redisClient.isOpen) return;
                await redisClient.set(key, val, opts);
            } catch (e) {
                console.warn(`[Redis] Set Failed: ${e.message}`);
            }
        }
    };

    try {
        // 1. Check Cache
        if (isCacheable) {
            const cached = await safeCache.get(cacheKey);
            if (cached) {
                console.log(`Cache Hit: ${cacheKey}`);
                return res.json(JSON.parse(cached));
            }
        }

        // 2. Fetch from WooCommerce
        const authHeader = req.headers['authorization'];
        const storeUrl = req.headers['x-store-url'];

        if (!storeUrl || (!authHeader && (!req.query.consumer_key || !req.query.consumer_secret))) {
            return res.status(400).json({ error: 'Missing Store Config Headers or Query Auth' });
        }

        let wcUrl;
        // Support Custom Namespaces (bypass /wc/v3)
        if (endpoint.startsWith('overseek') || endpoint.startsWith('wc-dash') || endpoint.startsWith('woodash')) {
            wcUrl = `${storeUrl}/wp-json/${endpoint}?${query}`;
        } else {
            wcUrl = `${storeUrl}/wp-json/wc/v3/${endpoint}?${query}`;
        }

        console.log(`Proxy ${req.method}: ${wcUrl}`);

        const requestHeaders = {
            'Content-Type': 'application/json'
        };
        if (authHeader) {
            requestHeaders['Authorization'] = authHeader;
        }

        const response = await axios({
            method: req.method,
            url: wcUrl,
            headers: requestHeaders,
            data: req.body
        });

        const data = response.data;
        const totalPages = response.headers['x-wp-totalpages'];

        // 3. Cache Result (TTL: 5 minutes default)
        if (isCacheable) {
            await safeCache.set(cacheKey, JSON.stringify({ data, totalPages }), { EX: 300 });
        }

        // 4. Archival Storage (Postgres) - Fire and Forget (Only for GET Orders for now)
        try {
            if (req.method === 'GET' && endpoint === 'orders' && Array.isArray(data)) {
                // Async save to Postgres
                (async () => {
                    try {
                        const client = await pool.connect();
                        const query = `
                            INSERT INTO orders (id, data, synced_at) 
                            VALUES ($1, $2, NOW()) 
                            ON CONFLICT (id) DO UPDATE SET data = $2, synced_at = NOW();
                        `;

                        let count = 0;
                        for (const order of data) {
                            if (order.id) {
                                await client.query(query, [order.id, JSON.stringify(order)]);
                                count++;
                            }
                        }
                        client.release();
                        console.log(`[Archival] Successfully archived ${count} orders to Postgres.`);
                    } catch (e) {
                        console.error('[Archival] Save failed:', e.message);
                    }
                })();
            }
        } catch (pgErr) {
            console.warn('[Archival] PG Warning:', pgErr.message);
        }

        if (isCacheable) console.log(`Cache Miss: ${cacheKey}`);

        // Return standard response structure
        // Note: For POST/PUT, WC usually returns the object directly.
        // Our Frontend expects { data, totalPages } wrapper from Proxy only if it's a list?
        // Actually, Step 674 api.js implies response.data is returned directly. 
        // Previously we returned `res.json({ data, totalPages })`. 
        // We should maintain this wrapper for consistency OR only strictly for LIST endpoints.
        // But to avoid breaking frontend, we should include the wrapper structure if it IS a list capability, 
        // typically indicated by totalPages header.

        if (totalPages !== undefined || Array.isArray(data)) {
            res.json({ data, totalPages });
        } else {
            // For single object (create order response), just return data?
            // But Wait: api.js `fetchProducts` expects `response.data`.
            // Wait, `fetchProducts` calls `client.get`. `createWCClient` returns `axios` instance.
            // `axios` response has `.data`.
            // If Proxy returns `{ data: [..], totalPages: N }`.
            // Then `response.data` in frontend is `{ data: [..], ... }`.
            // The old code returned `res.json({ data, totalPages })`.
            // Let's stick to that IF it's a GET request?
            // If I do `POST`, WC returns `{ id: 123 ... }`.
            // Proxy returns `{ data: {id:123}, totalPages: undefined }`.
            // Frontend gets `{ data: {id:123} }`.
            // Usually `response.data` is the payload.
            // So Frontend logic `response.data` -> `{ data: ... }`.
            // We need to match what frontend expects.

            // Simplest approach: Always wrap.
            res.json({ data, totalPages });
        }

    } catch (err) {
        console.error("Proxy Error:", err.message);
        // Forward status code from upstream if available
        if (err.response) {
            res.status(err.response.status).json(err.response.data);
        } else {
            res.status(500).json({ error: err.message });
        }
    }
});

const http = require('http');
const { Server } = require('socket.io');

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Socket Logic
io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('join_page', (data) => {
        // data: { page: '/products/123', user: 'John Doe', color: '#ff0000' }
        if (socket.currentRoom) {
            socket.leave(socket.currentRoom);
            socket.to(socket.currentRoom).emit('user_left', socket.id);
        }

        socket.join(data.page);
        socket.currentRoom = data.page;
        socket.userData = data;

        // Broadcast to others in the room
        socket.to(data.page).emit('user_joined', { ...data, socketId: socket.id });

        // Request existing users (simple way: ask everyone to announce)
        // Or better: In a real Redis setup, we'd query active presence set.
        // For now, we rely on "announce" back.
        socket.to(data.page).emit('request_announce', socket.id);
    });

    socket.on('announce_presence', (data) => {
        // data: { targetSocketId, user... }
        io.to(data.targetSocketId).emit('user_joined', {
            page: socket.currentRoom,
            user: socket.userData?.user,
            color: socket.userData?.color,
            socketId: socket.id
        });
    });

    socket.on('disconnect', () => {
        if (socket.currentRoom) {
            io.to(socket.currentRoom).emit('user_left', socket.id);
        }
    });
});

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
