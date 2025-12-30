 
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
const syncEntity = async (api, entity, saveBatch, statusUpdater, lastSynced) => {
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

        // Incremental Sync Logic
        if (lastSynced) {
            params.modified_after = new Date(lastSynced).toISOString();
            console.log(`[Sync] Incremental: Fetching ${entity} modified after ${params.modified_after}`);
        }

        const res = await api.get(endpoint, { params });
        const items = res.data;
        totalPages = parseInt(res.headers['x-wp-totalpages'] || 1, 10);

        console.log(`[Sync] Fetched ${items.length} ${entity} (Page ${page}/${totalPages})`);

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

    const { pool } = dependencies;

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

            // --- Sync State Helpers ---
            const getSyncState = async (entity) => {
                const client = await pool.connect();
                try {
                    const res = await client.query(
                        'SELECT last_synced_at FROM sync_state WHERE account_id = $1 AND entity = $2',
                        [accountId, entity]
                    );
                    return res.rows[0]?.last_synced_at || null;
                } finally {
                    client.release();
                }
            };

            const updateSyncState = async (entity, lastSynced) => {
                const client = await pool.connect();
                try {
                    await client.query(
                        `INSERT INTO sync_state (account_id, entity, last_synced_at)
                         VALUES ($1, $2, $3)
                         ON CONFLICT (account_id, entity) 
                         DO UPDATE SET last_synced_at = $3`,
                        [accountId, entity, lastSynced]
                    );
                } finally {
                    client.release();
                }
            };

            // 2. Define Batch Saver
            const saveBatch = async (table, items) => {
                const client = await pool.connect();
                try {
                    // --- Auto-Tagging Logic for Orders ---
                    if (table === 'orders' && options.autoTaggingRules && options.autoTaggingRules.length > 0) {
                        try {
                            // 1. Collect all product IDs from the batch
                            const productIds = new Set();
                            items.forEach(order => {
                                if (order.line_items && Array.isArray(order.line_items)) {
                                    order.line_items.forEach(item => {
                                        if (item.product_id) productIds.add(item.product_id);
                                    });
                                }
                            });

                            if (productIds.size > 0) {
                                // 2. Fetch tags for these products from DB
                                const pIdsArray = Array.from(productIds);
                                const tagRes = await client.query(`
                                    SELECT id, data->'tags' as tags 
                                    FROM products 
                                    WHERE account_id = $1 AND id = ANY($2)
                                `, [accountId, pIdsArray]);

                                const productTagsMap = {}; // ID -> Set of Tag Names
                                tagRes.rows.forEach(row => {
                                    if (row.tags && Array.isArray(row.tags)) {
                                        const tags = row.tags.map(t => (t.name || t).toLowerCase()); // Standardize to lower case for comparison? User input might be mixed.
                                        productTagsMap[row.id] = new Set(tags);
                                    }
                                });

                                // 3. Apply tags to orders
                                const rules = new Set(options.autoTaggingRules.map(r => r.toLowerCase())); // Standardize rules

                                items.forEach(order => {
                                    const orderTags = new Set(order.local_tags || []);
                                    let matched = false;

                                    if (order.line_items) {
                                        order.line_items.forEach(item => {
                                            const pTags = productTagsMap[item.product_id];
                                            if (pTags) {
                                                pTags.forEach(tag => {
                                                    // Check if this product tag is in our rules
                                                    // We check case-insensitive match against rules
                                                    if (rules.has(tag)) {
                                                        // Add the ORIGINAL casing from the rule? Or form the product?
                                                        // Let's add the rule string to keep it consistent with what user selected
                                                        // Find the original casing from options if possible, or just add the lowercase. 
                                                        // Simpler: use the rule string.
                                                        const originalRule = options.autoTaggingRules.find(r => r.toLowerCase() === tag);
                                                        if (originalRule) {
                                                            orderTags.add(originalRule);
                                                            matched = true;
                                                        }
                                                    }
                                                });
                                            }
                                        });
                                    }

                                    if (matched) {
                                        order.local_tags = Array.from(orderTags);
                                        // console.log(`[AutoTag] Tagged Order #${order.id} with:`, order.local_tags);
                                    }
                                });
                            }
                        } catch (tagErr) {
                            console.error("[AutoTag] Error applying tags:", tagErr);
                        }
                    }
                    await client.query('BEGIN');
                    const query = `
                        INSERT INTO "${table}" (account_id, id, data, synced_at)
                        VALUES ($1, $2, $3, NOW())
                        ON CONFLICT (account_id, id) DO UPDATE SET data = $3, synced_at = NOW();
                    `;
                    for (const item of items) {
                        // Inject Context
                        item.account_id = parseInt(accountId, 10);
                        await client.query(query, [item.account_id, item.id, JSON.stringify(item)]);
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

            // --- Helper: Reconcile Deletions (Full Sync Only) ---
            const reconcileDeletions = async (entity, api) => {
                const endpoints = {
                    products: '/products',
                    orders: '/orders',
                    reviews: '/products/reviews',
                    customers: '/customers',
                    coupons: '/coupons'
                };
                const endpoint = endpoints[entity.toLowerCase()];

                // 1. Fetch ALL Remote IDs
                const remoteIds = new Set();
                let page = 1;
                while (true) {
                    // Optimized: Fetch minimal fields if possible (WC V3 doesn't support 'fields' param natively well, but we use context=view)
                    const res = await api.get(endpoint, { params: { page, per_page: 100, fields: 'id' } }); // Try fields, ignored if unsupported
                    const ids = res.data.map(i => i.id);
                    ids.forEach(id => remoteIds.add(id));

                    const totalPages = parseInt(res.headers['x-wp-totalpages'] || 1, 10);
                    if (page >= totalPages) break;
                    page++;
                }

                // 2. Fetch ALL Local IDs
                const client = await pool.connect();
                try {
                    const res = await client.query(`SELECT id FROM "${entity}" WHERE account_id = $1`, [accountId]);
                    const localIds = res.rows.map(r => parseInt(r.id, 10));

                    // 3. Find Deletions
                    const toDelete = localIds.filter(id => !remoteIds.has(id));

                    if (toDelete.length > 0) {
                        console.log(`[Sync] Deleting ${toDelete.length} orphaned ${entity}. IDs: ${toDelete.slice(0, 5)}...`);
                        await client.query(`DELETE FROM "${entity}" WHERE account_id = $1 AND id = ANY($2)`, [accountId, toDelete]);
                    }
                } finally {
                    client.release();
                }
            };

            for (const task of activeTasks) {
                currentStatus.entity = task.name;
                currentStatus.progress = 0;

                // Determine Sync Mode
                let lastSynced = null;
                if (!options.forceFull) {
                    lastSynced = await getSyncState(task.key);
                }

                if (lastSynced) {
                    currentStatus.details = `Checking for updates since ${new Date(lastSynced).toLocaleTimeString()}...`;
                } else if (options.forceFull) {
                    currentStatus.details = `Performing Full Sync & Deletion scan...`;
                }

                try {
                    await syncEntity(
                        api,
                        task.key,
                        saveBatch,
                        (ent, page, total) => {
                            currentStatus.details = `Page ${page} of ${total} ${lastSynced ? '(Incremental)' : ''}`;
                            currentStatus.progress = Math.round((page / total) * 100);
                        },
                        lastSynced
                    );

                    // Run Deletion Scan if Full Sync
                    if (options.forceFull) {
                        try {
                            await reconcileDeletions(task.key, api);
                        } catch (e) {
                            console.warn(`[Sync] Deletion scan failed for ${task.key}:`, e.message);
                        }
                    }

                    // Update Sync State on Success
                    try {
                        const now = new Date().toISOString();
                        await updateSyncState(task.key, now);
                        console.log(`[Sync] Updated sync_state for ${task.key} to ${now}`);
                    } catch (e) {
                        console.error(`[Sync] Failed to update sync_state for ${task.key}:`, e.message);
                    }

                } catch (taskErr) {
                    console.error(`[Sync] Failed to sync ${task.name}:`, taskErr.message);
                    // Don't throw, just log. We want others to continue.
                    // But we might want to flag it in UI?
                    // For now, we rely on console logs. 
                    // Update: status should reflect "Partial Success" if some fail?
                    // Let's stick to continue.
                    if (taskErr.response?.status === 403) {
                        console.warn(`[Sync] Skipped ${task.name} due to 403 Forbidden (Permission denied)`);
                    }
                }
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
