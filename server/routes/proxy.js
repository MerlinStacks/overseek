const express = require('express');
const axios = require('axios');
const redisClient = require('../redis');
const { pool } = require('../db'); // For archival (if enabled)

const router = express.Router();

router.all('/*', async (req, res) => {
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

        // INTELLIGENT ROUTING FIX
        let apiNamespace = '/wp-json/wc/v3';

        // If the client is requesting WP Core API or Custom Namespaces
        // We switch the base namespace to just /wp-json
        if (endpoint.startsWith('wp/v2') || endpoint.startsWith('overseek') || endpoint.startsWith('wc-dash')) {
            apiNamespace = '/wp-json';
        }

        const finalUrl = `${storeUrl.replace(/\/$/, '')}${apiNamespace}/${endpoint}?${query}`;

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
            // ... (Archival logic kept commented out as in original) ...
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

module.exports = router;
