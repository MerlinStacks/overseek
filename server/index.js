require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');

require('./logger'); // Override console
const { initDB } = require('./db');
const { initSocket } = require('./socket');

const adminRoutes = require('./routes/admin');
const syncRoutes = require('./routes/sync');
const dbRoutes = require('./routes/db');
const proxyRoutes = require('./routes/proxy');
const utilsRoutes = require('./routes/utils');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(helmet());
app.use(compression());
app.use(morgan('tiny'));
app.use(cors());
app.use(express.json());

// Init DB
initDB();

// Routes
app.use('/admin', adminRoutes);
app.use('/api/sync', syncRoutes);
app.use('/api/db', dbRoutes);
app.use('/api/proxy', proxyRoutes);
app.use('/api/utils', utilsRoutes);

// NEW: Get Sync State (Last Sync Times)
app.get('/api/sync/state', async (req, res) => {
    const { account_id } = req.query;
    if (!account_id) return res.status(400).json({ error: 'Missing account_id' });

    try {
        const client = await pool.connect();
        const result = await client.query('SELECT entity, last_synced_at FROM sync_state WHERE account_id = $1', [account_id]);
        client.release();

        // Convert to map: { products: '2023...', orders: '...' }
        const state = result.rows.reduce((acc, row) => {
            acc[row.entity] = row.last_synced_at;
            return acc;
        }, {});

        res.json(state);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Health Check
app.get('/health', async (req, res) => {
    let dbStatus = 'disconnected';
    let redisStatus = 'disconnected';

    // Check DB
    try {
        const client = await require('./db').pool.connect();
        await client.query('SELECT 1');
        client.release();
        dbStatus = 'connected';
    } catch (e) {
        dbStatus = `error: ${e.message}`;
    }

    // Check Redis
    try {
        const redis = require('./redis');
        if (redis.isOpen) redisStatus = 'connected';
    } catch (e) {
        redisStatus = `error: ${e.message}`;
    }

    res.json({
        status: (dbStatus === 'connected') ? 'ok' : 'degraded',
        timestamp: new Date(),
        services: {
            database: dbStatus,
            redis: redisStatus
        }
    });
});

const server = http.createServer(app);
initSocket(server);

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
