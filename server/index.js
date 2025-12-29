const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const redis = require('redis');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 4000;

const redisClient = redis.createClient({
    url: process.env.REDIS_URL || 'redis://127.0.0.1:6379'
});
redisClient.connect().catch(console.error);

app.use(cors());
app.use(express.json());

const pool = new Pool({
    connectionString: process.env.DATABASE_URL
});

const LOG_BUFFER = [];
const MAX_LOGS = 100;

function captureLog(level, args) {
    const timestamp = new Date().toISOString();
    const message = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : a)).join(' ');
    LOG_BUFFER.unshift({ timestamp, level, message });
    if (LOG_BUFFER.length > MAX_LOGS) LOG_BUFFER.pop();
}

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

app.get('/admin/logs', (req, res) => {
    res.json(LOG_BUFFER);
});

// Health Check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date() });
});

app.post('/admin/restart', (req, res) => {
    console.log('Restart signal received. Shutting down...');
    res.json({ message: 'Server restarting...' });
    setTimeout(() => {
        process.exit(1);
    }, 1000);
});

app.post('/admin/cache/clear', async (req, res) => {
    try {
        await redisClient.flushAll();
        console.log('Redis Cache Flushed by Admin');
        res.json({ message: 'Cache cleared successfully' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/admin/ping', async (req, res) => {
    let { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL is required' });

    if (url.includes('localhost') || url.includes('127.0.0.1')) {
        console.log(`Rewriting localhost URL for Docker: ${url}`);
        url = url.replace(/localhost|127\.0\.0\.1/, 'host.docker.internal');
    }

    try {
        const start = Date.now();
        await axios.head(url, {
            timeout: 5000,
            validateStatus: () => true
        });
        const latency = Date.now() - start;
        res.json({ status: 'ok', latency, url });
    } catch (e) {
        console.error(`Ping failed for ${url}:`, e.message);

        let errorMsg = e.message;
        if (e.code === 'ENOTFOUND') errorMsg = 'DNS Lookup Failed (Invalid Domain)';
        if (e.code === 'ECONNREFUSED') errorMsg = 'Connection Refused (Is the server running?)';
        if (e.code === 'ETIMEDOUT') errorMsg = 'Connection Timed Out';

        res.status(500).json({ status: 'error', error: errorMsg, url, code: e.code });
    }
});

const initDB = async () => {
    try {
        let client;
        try {
            client = await pool.connect();
        } catch (err) {
            if (err.code === '3D000') { // Database 'overseek' does not exist
                console.warn("[initDB] Database 'overseek' missing. Attempting auto-creation...");

                let adminConnectionString;

                if (process.env.DATABASE_URL) {
                    try {
                        const dbUrl = new URL(process.env.DATABASE_URL);
                        // Store the target database name to verify
                        const targetDb = dbUrl.pathname.replace('/', '');

                        // Switch to 'postgres' database for admin tasks
                        dbUrl.pathname = '/postgres';
                        adminConnectionString = dbUrl.toString();

                        console.log(`[initDB] Detected target DB '${targetDb}'. Switching to 'postgres' for creation.`);
                    } catch (e) {
                        // Fallback for non-standard connection strings
                        console.warn("[initDB] API URL parsing failed, using regex fallback.");
                        adminConnectionString = process.env.DATABASE_URL.replace(/\/overseek(\?|$)/, '/postgres$1');
                    }
                } else {
                    // Localhost default
                    adminConfig = { database: 'postgres' };
                }

                const adminConfig = adminConnectionString ? { connectionString: adminConnectionString } : { database: 'postgres' };
                const adminPool = new Pool(adminConfig);

                try {
                    // Force a connection to check if we can actually reach 'postgres' db
                    const adminClient = await adminPool.connect();
                    try {
                        await adminClient.query('CREATE DATABASE overseek');
                        console.log("[initDB] Database 'overseek' created successfully.");
                    } catch (qe) {
                        if (qe.code === '42P04') {
                            console.log("[initDB] Database 'overseek' already exists (race condition).");
                        } else {
                            throw qe;
                        }
                    } finally {
                        adminClient.release();
                    }
                } catch (ce) {
                    console.error("[initDB] CRITICAL: Auto-creation failed.", ce.message);
                    console.error("[initDB] Details:", ce);
                    // If we can't create it, we can't proceed with self-healing, but we let it fall through 
                    // so the outer catch logs the final FATAL error.
                    // IMPORTANT: If permission denied (42501), inform user.
                    if (ce.code === '42501') {
                        console.error("[initDB] Permission Denied: The DB user does not have privilege to CREATE DATABASE.");
                    }
                } finally {
                    await adminPool.end();
                }

                // Add a small delay for propagation
                await new Promise(r => setTimeout(r, 1000));

                // Retry initial connection
                client = await pool.connect();
            } else {
                throw err;
            }
        }

        await client.query('CREATE EXTENSION IF NOT EXISTS pg_trgm;');

        const tables = ['orders', 'products', 'reviews', 'customers', 'coupons'];
        for (const table of tables) {
            await client.query(`
                CREATE TABLE IF NOT EXISTS ${table} (
                    id BIGINT PRIMARY KEY,
                    data JSONB,
                    synced_at TIMESTAMPTZ DEFAULT NOW()
                );
            `);
        }

        await client.query(`CREATE INDEX IF NOT EXISTS idx_products_name_trgm ON products USING GIN ((data->>'name') gin_trgm_ops);`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_products_account ON products ((data->>'account_id'));`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_products_parent ON products ((data->>'parent_id'));`);

        console.log('PostgreSQL initialized: Tables, Extensions & Indexes ready.');
        client.release();
    } catch (err) {
        console.error('Failed to initialize PostgreSQL:', err.message);
    }
};
initDB();

const syncManager = require('./sync');

app.post('/api/sync/start', (req, res) => {
    const { storeUrl, consumerKey, consumerSecret, authMethod, accountId, options } = req.body;

    if (!storeUrl || !consumerKey || !consumerSecret || !accountId) {
        return res.status(400).json({ error: "Missing required parameters (storeUrl, keys, accountId)" });
    }

    syncManager.startSync(
        { storeUrl, consumerKey, consumerSecret, authMethod, accountId, options },
        { pool, redisClient }
    );

    res.json({ message: "Sync process started.", status: syncManager.getStatus() });
});

app.get('/api/sync/status', (req, res) => {
    res.json(syncManager.getStatus());
});

app.get('/api/db/:table', async (req, res) => {
    const { table } = req.params;
    const { page = 1, limit = 50, search = '', hide_variants = 'false', account_id } = req.query;

    if (!['products', 'orders', 'reviews', 'customers', 'coupons'].includes(table)) {
        return res.status(400).json({ error: 'Invalid table' });
    }

    if (!account_id) {
        return res.status(400).json({ error: 'Missing account_id' });
    }

    try {
        const client = await pool.connect();

        let queryStr = `SELECT data FROM ${table}`;
        let countQueryStr = `SELECT COUNT(*) FROM ${table}`;
        const params = [];
        const whereClauses = [];

        params.push(account_id);
        whereClauses.push(`data->>'account_id' = $${params.length}`);

        if (search) {
            params.push(`%${search}%`);
            const idx = params.length;
            if (table === 'products') {
                whereClauses.push(`data->>'name' ILIKE $${idx}`);
            } else {
                whereClauses.push(`(data->>'id' ILIKE $${idx} OR data->'billing'->>'first_name' ILIKE $${idx})`);
            }
        }

        if (table === 'products' && hide_variants === 'true') {
            whereClauses.push(`(data->>'parent_id' = '0' OR data->>'parent_id' IS NULL)`);
        }

        if (whereClauses.length > 0) {
            const clause = ` WHERE ` + whereClauses.join(' AND ');
            queryStr += clause;
            countQueryStr += clause;
        }

        const countRes = await client.query(countQueryStr, params);
        const totalItems = parseInt(countRes.rows[0].count, 10);

        const pLimit = parseInt(limit);
        const pOffset = (parseInt(page) - 1) * pLimit;

        const limitIdx = params.length + 1;
        const offsetIdx = params.length + 2;
        params.push(pLimit, pOffset);

        queryStr += ` ORDER BY id DESC LIMIT $${limitIdx} OFFSET $${offsetIdx}`;

        console.log(`[DB API] Fetching ${table} for account ${account_id}. Params:`, params);
        const result = await client.query(queryStr, params);
        console.log(`[DB API] Found ${result.rows.length} items (Total: ${totalItems})`);

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

app.all('/api/proxy/*', async (req, res) => {
    try {
        const endpoint = req.params[0];
        const query = new URLSearchParams(req.query).toString();
        const cacheKey = `wc:${endpoint}:${query}`;

        const isCacheable = req.method === 'GET' &&
            !endpoint.startsWith('overseek') &&
            !endpoint.startsWith('wc-dash') &&
            !endpoint.startsWith('woodash');

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

        const storeUrl = req.headers['x-store-url'] || process.env.WOOCOMMERCE_STORE_URL;
        if (!storeUrl) {
            throw new Error('Store URL not configured (header or env)');
        }

        const finalUrl = `${storeUrl.replace(/\/$/, '')}/wp-json/wc/v3/${endpoint}?${query}`;

        const headers = { 'Content-Type': 'application/json' };
        if (req.headers.authorization) {
            headers['Authorization'] = req.headers.authorization;
        }

        const response = await axios({
            method: req.method,
            url: finalUrl,
            headers,
            data: req.body
        });

        const data = response.data;
        const totalPages = response.headers['x-wp-totalpages'];

        if (isCacheable) {
            redisClient.setEx(cacheKey, 3600, JSON.stringify({ data, totalPages })).catch(err => console.error('Redis Set Error:', err.message));
        }

        /* PASSIVE ARCHIVAL DISABLED (Missing account_id context)
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
        */

        if (totalPages !== undefined || Array.isArray(data)) {
            res.json({ data, totalPages });
        } else {
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
