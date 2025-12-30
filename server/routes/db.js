const express = require('express');
const { pool } = require('../db');

const router = express.Router();

router.get('/:table', async (req, res) => {
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

        let queryStr = `SELECT data FROM "${table}"`;
        let countQueryStr = `SELECT COUNT(*) FROM "${table}"`;
        const params = [];
        const whereClauses = [];

        params.push(account_id);
        whereClauses.push(`account_id = $${params.length}`);

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

        // Incremental Download Logic
        const { modified_after } = req.query;
        if (modified_after) {
            params.push(modified_after);
            whereClauses.push(`synced_at > $${params.length}`);
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

        queryStr += ` ORDER BY id DESC LIMIT $${limitIdx} OFFSET $${offsetIdx}`;

        console.log(`[DB API] Fetching ${table} for account ${account_id}. Params:`, params);
        // console.log(`[DB API] Query: ${queryStr}`); // Uncomment to debug SQL
        const result = await client.query(queryStr, params);
        console.log(`[DB API] Found ${result.rows.length} items (Total: ${totalItems}) for table ${table}`);

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

module.exports = router;
