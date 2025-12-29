const axios = require('axios');

let currentStatus = {
    running: false,
    progress: 0,
    entity: '',
    error: null,
    details: ''
};

const getStatus = () => currentStatus;

const startSync = ({ storeUrl, consumerKey, consumerSecret, authMethod, accountId, options }, dependencies) => {
    if (currentStatus.running) return;

    const { pool, redisClient } = dependencies;

    currentStatus = {
        running: true,
        progress: 0,
        entity: 'Initializing',
        error: null,
        details: 'Connecting to store...'
    };

    (async () => {
        try {
            const https = require('https');

            const createClient = (method) => {
                let cleanUrl = storeUrl.replace(/\/$/, '').replace(/\/wp-json\/?$/, '');

                const config = {
                    baseURL: `${cleanUrl}/wp-json/wc/v3`,
                    timeout: 120000,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                        'Accept': 'application/json'
                    },
                    httpsAgent: new https.Agent({
                        rejectUnauthorized: false
                    })
                };
                if (method === 'query_string') {
                    config.params = { consumer_key: consumerKey, consumer_secret: consumerSecret };
                } else {
                    config.headers['Authorization'] = 'Basic ' + Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');
                }
                return axios.create(config);
            };

            let api = null;
            let finalAuthMethod = authMethod;

            if (authMethod === 'query_string') {
                api = createClient('query_string');
            } else if (authMethod === 'basic') {
                api = createClient('basic');
            } else {
                try {
                    currentStatus.details = 'Verifying connection (Basic Auth)...';
                    const testClient = createClient('basic');
                    await testClient.get('/products', { params: { per_page: 1 } });
                    api = testClient;
                    finalAuthMethod = 'basic';
                } catch (e1) {
                    try {
                        currentStatus.details = 'Verifying connection (Query String)...';
                        const testClient = createClient('query_string');
                        await testClient.get('/products', { params: { per_page: 1 } });
                        api = testClient;
                        finalAuthMethod = 'query_string';
                    } catch (e2) {
                        throw new Error(`Connection failed: ${e1.message} (Basic) / ${e2.message} (Query String)`);
                    }
                }
            }

            if (!api) api = createClient(finalAuthMethod || 'basic');

            const saveBatch = async (table, items) => {
                const client = await pool.connect();
                try {
                    await client.query('BEGIN');
                    const query = `
                        INSERT INTO ${table} (id, data, synced_at)
                        VALUES ($1, $2, NOW())
                        ON CONFLICT (id) DO UPDATE SET data = $2, synced_at = NOW();
                    `;
                    for (const item of items) {
                        item.account_id = accountId;
                        await client.query(query, [item.id, JSON.stringify(item)]);
                    }
                    console.log(`[Sync] Saved batch of ${items.length} ${table} for account ${accountId}`);
                    await client.query('COMMIT');
                } catch (e) {
                    await client.query('ROLLBACK');
                    throw e;
                } finally {
                    client.release();
                }
            };

            if (options.products) {
                currentStatus.entity = 'Products';
                let page = 1;
                let totalPages = 1;

                do {
                    currentStatus.details = `Fetching page ${page}...`;
                    const res = await api.get('/products', { params: { page, per_page: 50 } });
                    totalPages = parseInt(res.headers['x-wp-totalpages'] || 1, 10);
                    const items = res.data;

                    const processedItems = [...items];
                    for (const p of items) {
                        if (p.type === 'variable') {
                            try {
                                const vRes = await api.get(`/products/${p.id}/variations`, { params: { per_page: 100 } });
                                const variations = vRes.data.map(v => ({ ...v, type: 'variation', parent_id: p.id }));
                                processedItems.push(...variations);
                            } catch (ve) {
                                console.warn(`Failed to fetch variations for ${p.id}: ${ve.message}`);
                            }
                        }
                    }

                    if (processedItems.length > 0) {
                        await saveBatch('products', processedItems);
                    }

                    currentStatus.progress = Math.round((page / totalPages) * 100);
                    page++;

                } while (page <= totalPages);
            }

            if (options.orders) {
                currentStatus.entity = 'Orders';
                currentStatus.progress = 0;
                let page = 1;
                let totalPages = 1;

                do {
                    currentStatus.details = `Fetching page ${page}...`;
                    const res = await api.get('/orders', { params: { page, per_page: 50 } });
                    totalPages = parseInt(res.headers['x-wp-totalpages'] || 1, 10);

                    if (res.data.length > 0) {
                        await saveBatch('orders', res.data);
                    }

                    currentStatus.progress = Math.round((page / totalPages) * 100);
                    page++;

                } while (page <= totalPages);
            }

            if (options.reviews) {
                currentStatus.entity = 'Reviews';
                currentStatus.progress = 0;
                let page = 1;
                let totalPages = 1;

                do {
                    currentStatus.details = `Fetching page ${page}...`;
                    const res = await api.get('/products/reviews', { params: { page, per_page: 50 } });
                    totalPages = parseInt(res.headers['x-wp-totalpages'] || 1, 10);

                    if (res.data.length > 0) {
                        await saveBatch('reviews', res.data);
                    }

                    currentStatus.progress = Math.round((page / totalPages) * 100);
                    page++;

                } while (page <= totalPages);
            }

            if (options.customers) {
                currentStatus.entity = 'Customers';
                currentStatus.progress = 0;
                let page = 1;
                let totalPages = 1;

                do {
                    currentStatus.details = `Fetching page ${page}...`;
                    const res = await api.get('/customers', { params: { page, per_page: 50, role: 'all' } });
                    totalPages = parseInt(res.headers['x-wp-totalpages'] || 1, 10);

                    if (res.data.length > 0) {
                        await saveBatch('customers', res.data);
                    }

                    currentStatus.progress = Math.round((page / totalPages) * 100);
                    page++;

                } while (page <= totalPages);
            }

            if (options.coupons) {
                currentStatus.entity = 'Coupons';
                currentStatus.progress = 0;
                let page = 1;
                let totalPages = 1;

                do {
                    currentStatus.details = `Fetching page ${page}...`;
                    const res = await api.get('/coupons', { params: { page, per_page: 50 } });
                    totalPages = parseInt(res.headers['x-wp-totalpages'] || 1, 10);

                    if (res.data.length > 0) {
                        await saveBatch('coupons', res.data);
                    }

                    currentStatus.progress = Math.round((page / totalPages) * 100);
                    page++;

                } while (page <= totalPages);
            }

            currentStatus.running = false;
            currentStatus.entity = 'Complete';
            currentStatus.progress = 100;
            currentStatus.details = 'Sync Finished Successfully';

        } catch (err) {
            console.error("Server Sync Error:", err);
            currentStatus.running = false;
            currentStatus.error = err.response?.data?.message || err.message;
            currentStatus.details = `Failed: ${err.response?.status || ''} ${err.code || ''}`;
        }
    })();
};

module.exports = { startSync, getStatus };
