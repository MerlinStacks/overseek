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

// PROXY: WooCommerce API with Redis Cache
app.get('/api/proxy/*', async (req, res) => {
    const endpoint = req.params[0]; // e.g., 'products', 'orders'
    const query = new URLSearchParams(req.query).toString();
    const cacheKey = `wc:${endpoint}:${query}`;

    try {
        // 1. Check Cache
        const cached = await redisClient.get(cacheKey);
        if (cached) {
            console.log(`Cache Hit: ${cacheKey}`);
            return res.json(JSON.parse(cached));
        }

        // 2. Fetch from WooCommerce
        // Headers must be passed from client (Basic Auth) or configured here if using Env
        const authHeader = req.headers['authorization'];
        const storeUrl = req.headers['x-store-url']; // Helper header or Env

        if (!storeUrl || !authHeader) {
            return res.status(400).json({ error: 'Missing Store Config Headers' });
        }

        const wcUrl = `${storeUrl}/wp-json/wc/v3/${endpoint}?${query}`;
        console.log(`Target: ${wcUrl}`);

        const response = await axios.get(wcUrl, {
            headers: { 'Authorization': authHeader }
        });

        const data = response.data;
        const totalPages = response.headers['x-wp-totalpages'];

        // 3. Cache Result (TTL: 5 minutes default)
        await redisClient.set(cacheKey, JSON.stringify({ data, totalPages }), { EX: 300 });

        // 4. Archival Storage (Postgres) - Fire and Forget
        try {
            if (endpoint === 'orders' && Array.isArray(data)) {
                // Future Improvement: Implement full schema mapping here.
                // For now, we validate the connection is ready for heavy lifting.
                const client = await pool.connect();
                // console.log(`[Archival] PG Connected. Ready to store ${data.length} orders.`);
                client.release();
            }
        } catch (pgErr) {
            console.warn('[Archival] PG Warning:', pgErr.message);
        }

        console.log(`Cache Miss: ${cacheKey}`);
        res.json({ data, totalPages });

    } catch (err) {
        console.error("Proxy Error:", err.message);
        res.status(500).json({ error: err.message });
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
