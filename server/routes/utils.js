const express = require('express');
const axios = require('axios');
const redisClient = require('../redis');
const router = express.Router();

// GeoIP Proxy
router.get('/geoip', async (req, res) => {
    const { ip } = req.query;
    if (!ip) return res.status(400).json({ error: 'IP Required' });

    // Internal Cache Key
    const cacheKey = `geoip:${ip}`;

    try {
        // Check Cache (Resilient)
        try {
            const cached = await redisClient.get(cacheKey);
            if (cached) return res.json(JSON.parse(cached));
        } catch (e) {
            console.warn("Redis skipped:", e.message);
        }

        // Fetch (Rate limited free API)
        const response = await axios.get(`https://ipapi.co/${ip}/json/`);
        const data = response.data;

        // Cache for 24 hours (GeoIP rarely changes)
        try {
            await redisClient.setEx(cacheKey, 86400, JSON.stringify(data));
        } catch (e) {
            console.warn("Redis cache failed:", e.message);
        }

        res.json(data);
    } catch (err) {
        console.error("GeoIP Proxy Error:", err.message);
        // Fallback or Error
        res.status(500).json({ error: 'Failed to fetch GeoIP' });
    }
});

// Debug: Check Sync State
router.get('/debug/sync-state', async (req, res) => {
    const { account_id } = req.query;
    if (!account_id) return res.status(400).json({ error: 'Missing account_id' });

    try {
        const { pool } = require('../db');
        const client = await pool.connect();
        const result = await client.query('SELECT * FROM sync_state WHERE account_id = $1', [account_id]);
        client.release();
        res.json(result.rows);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;
