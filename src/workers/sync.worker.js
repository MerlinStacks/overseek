/* eslint-disable no-restricted-globals */

import { db } from '../db/db';

const getAuthHeader = (key, secret) => {
    return `Basic ${btoa(`${key}:${secret}`)}`;
};

const fetchPage = async (url, params, headers) => {
    const query = new URLSearchParams(params).toString();
    const res = await fetch(`${url}?${query}`, { headers });
    if (!res.ok) {
        throw new Error(`API Error ${res.status}: ${res.statusText}`);
    }

    const json = await res.json();
    const data = json.data || json;
    const bodyTotal = json.totalPages ? parseInt(json.totalPages, 10) : 0;
    const headerTotal = parseInt(res.headers.get('x-wp-totalpages') || '0', 10);
    const totalPages = bodyTotal || headerTotal || 1;

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
    const { storeUrl, consumerKey, consumerSecret, authMethod } = config;

    const headers = {
        'Content-Type': 'application/json',
        'x-store-url': storeUrl.replace(/\/$/, '')
    };
    const globalParams = {};

    if (authMethod === 'query_string') {
        globalParams.consumer_key = consumerKey;
        globalParams.consumer_secret = consumerSecret;
    } else {
        headers['Authorization'] = getAuthHeader(consumerKey, consumerSecret);
    }

    const apiBase = `/api/proxy`;

    const newSyncTimes = { ...lastSyncTimes };
    const startTimeIso = new Date().toISOString();

    const enrich = (items) => items.map(i => ({
        ...i,
        account_id: accountId,
        parent_id: i.parent_id ? parseInt(i.parent_id, 10) : 0
    }));

    const syncEntity = async (endpoint, entityName, table, lastSyncKey, transformFn = null, basePct = 0, weight = 10) => {
        let page = 1;
        let totalPages = 1;
        let completedSuccess = true;

        const params = { per_page: 50, page: 1, ...globalParams };
        if (!forceFull && lastSyncTimes[lastSyncKey]) {
            params.after = lastSyncTimes[lastSyncKey];
        }

        reportProgress(`Syncing ${entityName}...`, basePct);

        do {
            try {
                params.page = page;
                const { data, totalPages: total } = await fetchPage(`${apiBase}/${endpoint}`, params, headers);
                totalPages = total || 1;

                if (data.length > 0) {
                    let itemsToSave = enrich(data);
                    if (transformFn) {
                        itemsToSave = await transformFn(itemsToSave);
                    }

                    if (table) {
                        await table.bulkPut(itemsToSave);
                    }

                    const progress = Math.min(basePct + Math.round((page / totalPages) * weight), basePct + weight);
                    log(`Synced ${entityName} page ${page}/${totalPages} (${data.length} items)`);
                    reportProgress(`Syncing ${entityName} (${Math.round((page / totalPages) * 100)}%)`, progress);
                }

                page++;
            } catch (err) {
                log(`Error syncing ${entityName} page ${page}: ${err.message}`, 'error');
                completedSuccess = false;
                break;
            }
        } while (page <= totalPages);

        if (completedSuccess) {
            newSyncTimes[lastSyncKey] = startTimeIso;
        } else {
            log(`Sync for ${entityName} incomplete. Will retry from previous timestamp next time.`, 'warning');
        }

        reportProgress(`${entityName} Complete`, basePct + weight);
    };

    if (options.products) {
        await syncEntity('products', 'Products', null, 'products', async (items) => {
            const fetchPromises = items.map(async (item) => {
                const results = [item];

                if (item.type === 'variable') {
                    try {
                        await fetchPage(`${apiBase}/products/${item.id}/variations`, { per_page: 50, ...globalParams }, headers);
                    } catch (_) {
                        // ignore
                    }
                }
                return results;
            });

            const results = await Promise.all(fetchPromises);
            return results.flat();
        }, 0, 40);
    }

    if (options.orders) {
        const automations = await db.automations.toArray();
        const activeStatusRules = automations.filter(a => a.active && a.trigger_type === 'order_status_change');

        await syncEntity('orders', 'Orders', db.orders, 'orders', async (items) => {
            const transformed = items.map(order => ({
                ...order,
                total_tax: order.total_tax || 0,
                account_id: accountId
            }));

            if (activeStatusRules.length > 0) {
                const ids = transformed.map(o => o.id);
                const compoundKeys = ids.map(id => [accountId, id]);
                const existingOrders = await db.orders.where('[account_id+id]').anyOf(compoundKeys).toArray();
                const existingMap = new Map(existingOrders.map(o => [o.id, o]));

                for (const newOrder of transformed) {
                    const oldOrder = existingMap.get(newOrder.id);
                    if (oldOrder && oldOrder.status !== newOrder.status) {
                        const rules = activeStatusRules.filter(r => r.conditions.status === newOrder.status);

                        for (const rule of rules) {
                            if (rule.action.type === 'send_email') {
                                try {
                                    const customerName = (newOrder.billing?.first_name || 'Customer');
                                    const subject = rule.action.subject
                                        .replace('{order_id}', newOrder.id)
                                        .replace('{customer_name}', customerName);
                                    const message = rule.action.message
                                        .replace('{order_id}', newOrder.id)
                                        .replace('{customer_name}', customerName);

                                    const query = new URLSearchParams(globalParams).toString();
                                    const emailEndpoint = `/api/proxy/overseek/v1/email/send?${query}`;

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
        }, 40, 30);
    }

    if (options.customers) {
        await syncEntity('customers', 'Customers', db.customers, 'customers', null, 70, 15);
    }

    if (options.taxes) {
        reportProgress('Syncing Taxes', 85);
        try {
            const { data } = await fetchPage(`${apiBase}/taxes`, { ...globalParams }, headers);
            await db.tax_rates.where('account_id').equals(accountId).delete();
            await db.tax_rates.bulkAdd(enrich(data));
        } catch (e) {
            log(`Error syncing taxes: ${e.message}`, 'warning');
        }
        reportProgress('Taxes Sync Complete', 90);
    }

    if (options.reviews) {
        await syncEntity('products/reviews', 'Reviews', db.reviews, 'reviews', async (items) => {
            return items.map(r => ({
                id: r.id,
                product_id: r.product_id,
                status: r.status,
                rating: r.rating,
                date_created: r.date_created,
                content: r.review.replace(/<[^>]*>?/gm, ''),
                order_id: null,
                customer_id: r.reviewer_id || 0,
                reviewer_name: r.reviewer,
                reviewer_email: r.reviewer_email,
                photos: r.images || [],
                account_id: accountId
            }));
        }, 90, 10);
    }

    reportProgress('Sync Complete', 100);
    self.postMessage({ type: 'COMPLETE', newSyncTimes });
};
