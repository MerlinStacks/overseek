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
        // Check Cache
        const cached = await redisClient.get(cacheKey);
        if (cached) return res.json(JSON.parse(cached));

        // Fetch (Rate limited free API)
        const response = await axios.get(`https://ipapi.co/${ip}/json/`);
        const data = response.data;

        // Cache for 24 hours (GeoIP rarely changes)
        await redisClient.setEx(cacheKey, 86400, JSON.stringify(data));

        res.json(data);
    } catch (err) {
        console.error("GeoIP Proxy Error:", err.message);
        // Fallback or Error
        res.status(500).json({ error: 'Failed to fetch GeoIP' });
    }
});

module.exports = router;
