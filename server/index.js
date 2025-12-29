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
        let client;
        try {
            client = await pool.connect();
        } catch (err) {
            // Auto-Healing: Create DB if missing (Error 3D000)
            if (err.code === '3D000') {
                console.warn("[initDB] Database 'overseek' missing. Attempting auto-creation...");
                const adminConfig = {};
                // Determine connection to default 'postgres' db
                if (process.env.DATABASE_URL) {
                    try {
                        const url = new URL(process.env.DATABASE_URL);
                        url.pathname = '/postgres';
                        adminConfig.connectionString = url.toString();
                    } catch (_) {
                        adminConfig.connectionString = process.env.DATABASE_URL.replace(/\/overseek(\?|$)/, '/postgres$1');
                    }
                } else {
                    adminConfig.database = 'postgres';
                }

                const adminPool = new Pool(adminConfig);
                try {
                    await adminPool.query('CREATE DATABASE overseek');
                    console.log("[initDB] Database 'overseek' created.");
                } catch (ce) {
                    if (ce.code !== '42P04') console.warn("[initDB] Auto-create failed:", ce.message);
                }
                await adminPool.end();

                // Retry
                client = await pool.connect();
            } else {
                throw err;
            }
        }

        // Optimization: Enable Trigram Extension for high-performance fuzzy search
        await client.query('CREATE EXTENSION IF NOT EXISTS pg_trgm;');

        // Orders Table
        await client.query(`
            CREATE TABLE IF NOT EXISTS orders (
                id BIGINT PRIMARY KEY,
                data JSONB,
                synced_at TIMESTAMPTZ DEFAULT NOW()
            );
        `);

        // Products Table
        await client.query(`
            CREATE TABLE IF NOT EXISTS products (
                id BIGINT PRIMARY KEY,
                data JSONB,
                synced_at TIMESTAMPTZ DEFAULT NOW()
            );
        `);

        // Reviews Table
        await client.query(`
            CREATE TABLE IF NOT EXISTS reviews (
                id BIGINT PRIMARY KEY,
                data JSONB,
                synced_at TIMESTAMPTZ DEFAULT NOW()
            );
        `);

        // Customers Table
        await client.query(`
            CREATE TABLE IF NOT EXISTS customers (
                id BIGINT PRIMARY KEY,
                data JSONB,
                synced_at TIMESTAMPTZ DEFAULT NOW()
            );
        `);

        // Coupons Table
        await client.query(`
            CREATE TABLE IF NOT EXISTS coupons (
                id BIGINT PRIMARY KEY,
                data JSONB,
                synced_at TIMESTAMPTZ DEFAULT NOW()
            );
        `);

        // Indexes for High Performance
        // 1. GIN Trigram Index for Instant Name Search (data->>'name' ILIKE '%term%')
        await client.query(`CREATE INDEX IF NOT EXISTS idx_products_name_trgm ON products USING GIN ((data->>'name') gin_trgm_ops);`);

        // 2. BTree Indexes for Filtering
        await client.query(`CREATE INDEX IF NOT EXISTS idx_products_account ON products ((data->>'account_id'));`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_products_parent ON products ((data->>'parent_id'));`);

        console.log('PostgreSQL initialized: Tables, Extensions & Indexes ready.');
        client.release();
    } catch (err) {
        console.error('Failed to initialize PostgreSQL:', err.message);
    }
};
initDB();

// DATABASE API (Local Access to Postgres)
// Sync Manager
const syncManager = require('./sync');

// --- Sync API (Server-Side) ---
app.post('/api/sync/start', (req, res) => {
    const { storeUrl, consumerKey, consumerSecret, authMethod, accountId, options } = req.body;

    // Basic Validation
    if (!storeUrl || !consumerKey || !consumerSecret || !accountId) {
        return res.status(400).json({ error: "Missing required parameters (storeUrl, keys, accountId)" });
    }

    // Trigger Background Sync
    syncManager.startSync(
        { storeUrl, consumerKey, consumerSecret, authMethod, accountId, options },
        { pool, redisClient }
    );

    res.json({ message: "Sync process started.", status: syncManager.getStatus() });
});

app.get('/api/sync/status', (req, res) => {
    res.json(syncManager.getStatus());
});

// --- Local Database API (Postgres) ---
app.get('/api/db/:table', async (req, res) => {
    const { table } = req.params;
    const { page = 1, limit = 50, search = '', hide_variants = 'false', account_id } = req.query;

    // Validate table
    if (!['products', 'orders', 'reviews', 'customers', 'coupons'].includes(table)) {
        return res.status(400).json({ error: 'Invalid table' });
    }

    // Validate Account
    if (!account_id) {
        return res.status(400).json({ error: 'Missing account_id' });
    }

    try {
        const client = await pool.connect();

        let queryStr = `SELECT data FROM ${table}`;
        let countQueryStr = `SELECT COUNT(*) FROM ${table}`;
        const params = [];
        const whereClauses = [];

        // Account Isolation (CRITICAL)
        params.push(account_id);
        whereClauses.push(`data->>'account_id' = $${params.length}`); // $1

        // Search Logic
        if (search) {
            params.push(`%${search}%`);
            const idx = params.length;
            if (table === 'products') {
                whereClauses.push(`data->>'name' ILIKE $${idx}`);
            } else {
                whereClauses.push(`(data->>'id' ILIKE $${idx} OR data->'billing'->>'first_name' ILIKE $${idx})`);
            }
        }

        // Variant Hiding (Products Only)
        if (table === 'products' && hide_variants === 'true') {
            whereClauses.push(`(data->>'parent_id' = '0' OR data->>'parent_id' IS NULL)`);
        }

        if (whereClauses.length > 0) {
            const clause = ` WHERE ` + whereClauses.join(' AND ');
            queryStr += clause;
            countQueryStr += clause;
        }

        // Count First
        const countRes = await client.query(countQueryStr, params);
        const totalItems = parseInt(countRes.rows[0].count, 10);

        // Pagination
        const pLimit = parseInt(limit);
        const pOffset = (parseInt(page) - 1) * pLimit;

        const limitIdx = params.length + 1;
        const offsetIdx = params.length + 2;
        params.push(pLimit, pOffset);

        queryStr += ` ORDER BY id DESC LIMIT $${limitIdx} OFFSET $${offsetIdx}`;

        const result = await client.query(queryStr, params);

        client.release();

        res.json({
            data: result.rows.map(r => r.data),
            page: parseInt(page),
            limit: parseInt(limit),
            total: totalItems,
            totalPages: Math.ceil(totalItems / pLimit)
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// PROXY: WooCommerce API with Redis Cache
// PROXY: WooCommerce API with Redis Cache
app.all('/api/proxy/*', async (req, res) => {
    try {
        const endpoint = req.params[0]; // e.g., 'products', 'orders'
        const query = new URLSearchParams(req.query).toString();
        const cacheKey = `wc:${endpoint}:${query}`;

        // Cache Rules
        const isCacheable = req.method === 'GET' &&
            !endpoint.startsWith('overseek') &&
            !endpoint.startsWith('wc-dash') &&
            !endpoint.startsWith('woodash');

        // 1. Check Cache
        if (isCacheable) {
            try {
                const cached = await redisClient.get(cacheKey);
                if (cached) {
                    return res.json(JSON.parse(cached));
                }
            } catch (e) {
                console.warn('Redis Read Error:', e.message);
            }
        }

        // 2. Prepare Request
        // Worker sends 'x-store-url', otherwise fallback to ENV
        const storeUrl = req.headers['x-store-url'] || process.env.WOOCOMMERCE_STORE_URL;
        if (!storeUrl) {
            throw new Error('Store URL not configured (header or env)');
        }

        // Handle relative vs absolute endpoint
        const finalUrl = `${storeUrl.replace(/\/$/, '')}/wp-json/wc/v3/${endpoint}?${query}`;

        const headers = { 'Content-Type': 'application/json' };
        if (req.headers.authorization) {
            headers['Authorization'] = req.headers.authorization;
        }

        // 3. Fetch from WooCommerce
        const response = await axios({
            method: req.method,
            url: finalUrl,
            headers,
            data: req.body
        });

        const data = response.data;
        const totalPages = response.headers['x-wp-totalpages'];

        // 4. Set Cache
        if (isCacheable) {
            redisClient.setEx(cacheKey, 3600, JSON.stringify({ data, totalPages })).catch(err => console.error('Redis Set Error:', err.message));
        }

        // 5. Archival Storage (Postgres) - Passive Sync
        if (req.method === 'GET' && (endpoint === 'orders' || endpoint === 'products' || endpoint === 'products/reviews') && Array.isArray(data)) {
            (async () => {
                try {
                    const client = await pool.connect();
                    const tableName = endpoint === 'products/reviews' ? 'reviews' : (endpoint === 'orders' ? 'orders' : 'products');

                    const query = `
                        INSERT INTO ${tableName} (id, data, synced_at) 
                        VALUES ($1, $2, NOW()) 
                        ON CONFLICT (id) DO UPDATE SET data = $2, synced_at = NOW();
                    `;

                    let count = 0;
                    for (const item of data) {
                        if (item.id) {
                            await client.query(query, [item.id, JSON.stringify(item)]);
                            count++;
                        }
                    }
                    client.release();
                    console.log(`[Archival] Successfully archived ${count} items to '${tableName}'.`);
                } catch (pgErr) {
                    console.error('[Archival] Failed:', pgErr.message);
                }
            })();
        }

        // 6. Response
        // Always wrap in { data, totalPages } if it looks like a list or pagination is present
        // This maintains consistency with Frontend expectations
        if (totalPages !== undefined || Array.isArray(data)) {
            res.json({ data, totalPages });
        } else {
            // Single item response
            res.json({ data, totalPages });
        }

    } catch (err) {
        console.error("Proxy Error:", err.message);
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
