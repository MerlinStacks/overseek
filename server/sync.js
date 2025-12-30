const axios = require('axios');
const https = require('https');

// --- Helper: Create Axios Client ---
const createClient = (storeUrl, consumerKey, consumerSecret, method) => {
    let cleanUrl = storeUrl.replace(/\/$/, '').replace(/\/wp-json\/?$/, '');

    const config = {
        baseURL: `${cleanUrl}/wp-json/wc/v3`,
        timeout: 120000,
        headers: {
            'User-Agent': 'OverSeek-Sync-Agent/1.0',
            'Accept': 'application/json'
        },
        httpsAgent: new https.Agent({
            rejectUnauthorized: false
        })
    };

    if (method === 'query_string') {
        config.params = { consumer_key: consumerKey, consumer_secret: consumerSecret };
        config.auth = undefined;
    } else {
        // Basic Auth
        config.headers['Authorization'] = 'Basic ' + Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');
    }
    return axios.create(config);
};

// --- Helper: Auto-Detect Auth Method ---
const detectAuth = async (storeUrl, consumerKey, consumerSecret, preferredMethod) => {
    // If preference is strict, just return client
    if (preferredMethod === 'query_string') return createClient(storeUrl, consumerKey, consumerSecret, 'query_string');
    if (preferredMethod === 'basic') return createClient(storeUrl, consumerKey, consumerSecret, 'basic');

    // Auto-detect: Try Basic first, then Query String
    try {
        const client = createClient(storeUrl, consumerKey, consumerSecret, 'basic');
        await client.get('/products', { params: { per_page: 1 } });
        return client;
    } catch (e1) {
        try {
            const client = createClient(storeUrl, consumerKey, consumerSecret, 'query_string');
            await client.get('/products', { params: { per_page: 1 } });
            return client;
        } catch (e2) {
            throw new Error(`Auth Failed: Basic (${e1.message}) & Query String (${e2.message})`);
        }
    }
};

// --- Helper: Fetch & Save Loop ---
const syncEntity = async (api, entity, saveBatch, statusUpdater) => {
    // Standardize Entity Endpoints
    const endpoints = {
        products: '/products',
        orders: '/orders',
        reviews: '/products/reviews',
        customers: '/customers',
        coupons: '/coupons'
    };

    const endpoint = endpoints[entity.toLowerCase()];
    if (!endpoint) throw new Error(`Unknown entity: ${entity}`);

    let page = 1;
    let totalPages = 1;

    do {
        statusUpdater(entity, page, totalPages);

        const params = { page, per_page: 50 };
        if (entity === 'customers') params.role = 'all';

        const res = await api.get(endpoint, { params });
        const items = res.data;
        totalPages = parseInt(res.headers['x-wp-totalpages'] || 1, 10);

        if (items.length > 0) {
            // Pre-processing
            const processedItems = [...items];

            // Special Logic: Product Variations
            if (entity === 'products') {
                for (const p of items) {
                    if (p.type === 'variable') {
                        try {
                            const vRes = await api.get(`/products/${p.id}/variations`, { params: { per_page: 100 } });
                            const variations = vRes.data.map(v => ({ ...v, type: 'variation', parent_id: p.id }));
                            processedItems.push(...variations);
                        } catch (e) {
                            console.warn(`[Sync] Failed variations for #${p.id}: ${e.message}`);
                        }
                    }
                }
            }

            // Save to DB
            await saveBatch(entity.toLowerCase(), processedItems);
        }

        page++;
    } while (page <= totalPages);
};

// --- Main Standardized Sync Manager ---

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
        details: 'Connecting...'
    };

    (async () => {
        try {
            // 1. Establish Connection
            const api = await detectAuth(storeUrl, consumerKey, consumerSecret, authMethod);

            // 2. Define Batch Saver
            const saveBatch = async (table, items) => {
                const client = await pool.connect();
                try {
                    await client.query('BEGIN');
                    const query = `
                        INSERT INTO "${table}" (account_id, id, data, synced_at)
                        VALUES ($1, $2, $3, NOW())
                        ON CONFLICT (account_id, id) DO UPDATE SET data = $3, synced_at = NOW();
                    `;
                    for (const item of items) {
                        // Inject Context
                        item.account_id = accountId;
                        await client.query(query, [accountId, item.id, JSON.stringify(item)]);
                    }
                    await client.query('COMMIT');
                } catch (e) {
                    await client.query('ROLLBACK');
                    throw e;
                } finally {
                    client.release();
                }
            };

            // 3. Run Syncs based on Options
            const tasks = [
                { key: 'products', name: 'Products' },
                { key: 'orders', name: 'Orders' },
                { key: 'reviews', name: 'Reviews' },
                { key: 'customers', name: 'Customers' },
                { key: 'coupons', name: 'Coupons' }
            ];

            const activeTasks = tasks.filter(t => options[t.key]);
            let completedTasks = 0;

            for (const task of activeTasks) {
                currentStatus.entity = task.name;
                currentStatus.progress = 0;

                await syncEntity(
                    api,
                    task.key,
                    saveBatch,
                    (ent, page, total) => {
                        currentStatus.details = `Page ${page} of ${total}`;
                        currentStatus.progress = Math.round((page / total) * 100);
                    }
                );

                completedTasks++;
            }

            // 4. Finish
            currentStatus.running = false;
            currentStatus.entity = 'Complete';
            currentStatus.progress = 100;
            currentStatus.details = 'Sync Finished Successfully';

        } catch (err) {
            console.error("Server Sync Error:", err);
            currentStatus.running = false;
            const upstreamError = err.response?.data?.message || err.response?.statusText;
            const dbError = err.code ? `DB Error ${err.code}` : null;
            currentStatus.error = upstreamError || dbError || err.message;
            currentStatus.details = `Failed at ${currentStatus.entity}. ${err.response?.status ? `HTTP ${err.response.status}` : ''} ${err.code || ''}`;
        }
    })();
};

module.exports = { startSync, getStatus };
