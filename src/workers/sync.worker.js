/* eslint-disable no-restricted-globals */
import { db } from '../db/db';

// Helper for Basic Auth encoding
const getAuthHeader = (key, secret) => {
    return `Basic ${btoa(`${key}:${secret}`)}`;
};

const fetchPage = async (url, params, headers) => {
    const query = new URLSearchParams(params).toString();
    const res = await fetch(`${url}?${query}`, { headers });
    if (!res.ok) {
        throw new Error(`API Error ${res.status}: ${res.statusText}`);
    }
    const totalPages = parseInt(res.headers.get('x-wp-totalpages') || '1', 10);
    const data = await res.json();
    return { data, totalPages };
};

self.onmessage = async (e) => {
    const msg = e.data;

    if (msg.type === 'START') {
        try {
            await startSync(msg);
        } catch (err) {
            self.postMessage({ type: 'ERROR', error: err.message });
        }
    }
};

const log = (message, level = 'info') => {
    self.postMessage({ type: 'LOG', message, level });
};

const reportProgress = (task, percentage) => {
    self.postMessage({ type: 'PROGRESS', task, percentage });
};

const startSync = async ({ config, accountId, options, lastSyncTimes, forceFull }) => {
    const { storeUrl, consumerKey, consumerSecret } = config;
    const authHeader = getAuthHeader(consumerKey, consumerSecret);
    const headers = {
        'Authorization': authHeader,
        'Content-Type': 'application/json'
    };
    const apiBase = `${storeUrl.replace(/\/$/, '')}/wp-json/wc/v3`;

    const newSyncTimes = { ...lastSyncTimes };
    const startTimeIso = new Date().toISOString();

    // Helper: Enrich with account_id
    const enrich = (items) => items.map(i => ({ ...i, account_id: accountId }));

    // Helper: Fetch Loop
    const syncEntity = async (endpoint, entityName, table, lastSyncKey, transformFn = null) => {
        let page = 1;
        let totalPages = 1;

        // Prepare params
        const params = { per_page: 20, page: 1 };
        if (!forceFull && lastSyncTimes[lastSyncKey]) {
            params.after = lastSyncTimes[lastSyncKey];
        }

        reportProgress(`Syncing ${entityName}...`, 0);

        do {
            try {
                // Fetch
                params.page = page;
                const { data, totalPages: total } = await fetchPage(`${apiBase}/${endpoint}`, params, headers);
                totalPages = total;

                if (data.length > 0) {
                    let itemsToSave = enrich(data);
                    if (transformFn) {
                        itemsToSave = await transformFn(itemsToSave);
                    }
                    await table.bulkPut(itemsToSave);
                    log(`Synced ${entityName} page ${page}/${totalPages} (${data.length} items)`);
                }

                page++;

                // Update progress based on strict task boundaries
                // We'll manage overall progress in main loop, here just log
            } catch (err) {
                log(`Error syncing ${entityName} page ${page}: ${err.message}`, 'error');
                // Break or continue? For robustness, maybe break this entity but continue others
                break;
            }
        } while (page <= totalPages);

        newSyncTimes[lastSyncKey] = startTimeIso;
    };

    // 1. PRODUCTS
    if (options.products) {
        reportProgress('Syncing Products', 10);
        await syncEntity('products', 'Products', db.products, 'products', async (items) => {
            // Fetch Variations Logic could go here, but doing it inside worker sequentially is better
            // Ideally we gather IDs of variable products and fetch variations
            // For simplicity in this v1 worker, let's keep it simple or implement the variation fetch logic

            // Note: Variation fetching makes this complex. 
            // In the original SyncContext, we iterated items.

            // Parallel fetch for variations
            const fetchPromises = items.map(async (item) => {
                const results = [item];

                if (item.type === 'variable') {
                    try {
                        // Parallelize this fetch
                        const { data: vars } = await fetchPage(`${apiBase}/products/${item.id}/variations`, { per_page: 50 }, headers);
                        const enrichedVars = vars.map(v => ({
                            ...v,
                            name: `${item.name} - ${v.attributes.map(a => a.option).join(', ')}`,
                            type: 'variation',
                            parent_id: item.id,
                            account_id: accountId,
                            status: v.status || 'publish',
                            local_tags: item.local_tags || []
                        }));
                        results.push(...enrichedVars);
                    } catch (e) {
                        log(`Failed to fetch vars for product ${item.id}: ${e.message}`, 'warning');
                    }
                }
                return results;
            });

            // Wait for all product/variation fetches in this page to complete
            const results = await Promise.all(fetchPromises);
            return results.flat();
        });
    }

    // 2. ORDERS
    if (options.orders) {
        reportProgress('Syncing Orders', 40);

        // Load active automations once
        const automations = await db.automations.toArray();
        const activeStatusRules = automations.filter(a => a.active && a.trigger_type === 'order_status_change');

        await syncEntity('orders', 'Orders', db.orders, 'orders', async (items) => {
            // 1. Transform
            const transformed = items.map(order => ({
                ...order,
                total_tax: order.total_tax || 0,
                account_id: accountId
            }));

            // 2. Automation Check (only if rules exist)
            if (activeStatusRules.length > 0) {
                const ids = transformed.map(o => o.id);
                const existingOrders = await db.orders.where('id').anyOf(ids).toArray();
                const existingMap = new Map(existingOrders.map(o => [o.id, o]));

                for (const newOrder of transformed) {
                    const oldOrder = existingMap.get(newOrder.id);
                    if (oldOrder && oldOrder.status !== newOrder.status) {
                        const rules = activeStatusRules.filter(r => r.conditions.status === newOrder.status);

                        for (const rule of rules) {
                            if (rule.action.type === 'send_email') {
                                try {
                                    // Variable Replacement
                                    const customerName = (newOrder.billing?.first_name || 'Customer');
                                    const subject = rule.action.subject
                                        .replace('{order_id}', newOrder.id)
                                        .replace('{customer_name}', customerName);
                                    const message = rule.action.message
                                        .replace('{order_id}', newOrder.id)
                                        .replace('{customer_name}', customerName);

                                    // Send Email via API (using fetch)
                                    // Endpoint: .../wp-json/wc-dash/v1/email/send
                                    // We need to go up from /wc/v3 or use absolute URL construction
                                    const emailEndpoint = `${config.storeUrl}/wp-json/wc-dash/v1/email/send`;

                                    await fetch(emailEndpoint, {
                                        method: 'POST',
                                        headers: headers,
                                        body: JSON.stringify({
                                            to: newOrder.billing.email,
                                            subject,
                                            message
                                        })
                                    });
                                    log(`Triggered '${rule.name}': Sent email to ${newOrder.billing.email}`);
                                } catch (e) {
                                    log(`Automation Error: ${e.message}`, 'error');
                                }
                            }
                        }
                    }
                }
            }

            return transformed;
        });
    }

    // 3. CUSTOMERS
    if (options.customers) {
        reportProgress('Syncing Customers', 70);
        await syncEntity('customers', 'Customers', db.customers, 'customers');
    }

    // 4. TAXES
    if (options.taxes) {
        reportProgress('Syncing Taxes', 85);
        // Taxes don't support pagination usually, or small enough
        try {
            const { data } = await fetchPage(`${apiBase}/taxes`, {}, headers);
            await db.tax_rates.where('account_id').equals(accountId).delete();
            await db.tax_rates.bulkAdd(enrich(data));
        } catch (e) {
            log(`Error syncing taxes: ${e.message}`, 'warning');
        }
    }

    // 5. REVIEWS
    if (options.reviews) {
        reportProgress('Syncing Reviews', 90);
        await syncEntity('products/reviews', 'Reviews', db.reviews, 'reviews', async (items) => {
            return items.map(r => ({
                id: r.id,
                product_id: r.product_id,
                status: r.status,
                rating: r.rating,
                date_created: r.date_created,
                content: r.review.replace(/<[^>]*>?/gm, ''),
                order_id: null, // API doesn't always provide this easily
                customer_id: r.reviewer_id || 0,
                reviewer_name: r.reviewer,
                reviewer_email: r.reviewer_email,
                photos: r.images || [],
                account_id: accountId
            }));
        });
    }

    reportProgress('Sync Complete', 100);
    self.postMessage({ type: 'COMPLETE', newSyncTimes });
};
