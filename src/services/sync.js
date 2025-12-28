import { db } from '../db/db';
import { fetchProducts, fetchOrders, fetchCustomers, fetchCoupons, fetchVariations } from './api';

// Helper to fetch all pages of a resource
const syncEntity = async (settings, fetchFn, table, entityName, onProgress, interceptor = null) => {
    let page = 1;
    let hasMore = true;
    let totalCount = 0;

    // Optional: Only clear if you want a fresh start, otherwise we upsert.
    // For a robust sync, we might want to track "last_synced" and only fetch modified,
    // but WP API "modified_after" can be tricky with timezone.
    // For now, we do a FULL crawl every time. 
    // Optimization: BulkPut per page to keep memory usage low.

    while (hasMore) {
        onProgress(`Syncing ${entityName}: Page ${page}...`);
        try {
            const data = await fetchFn(settings, { page, per_page: 50 }); // 50 is a safe batch size

            if (!data || data.length === 0) {
                hasMore = false;
            } else {
                // Feature: Automation Interceptor
                // If we have an interceptor, run it BEFORE saving to detect changes
                if (interceptor) {
                    await interceptor(data);
                }

                // Pre-processing
                const processedData = data.map(item => {
                    // Flatten cost_price for Products
                    if (entityName === 'Products') {
                        const costMeta = item.meta_data?.find(m => m.key === '_alg_wc_cog_cost');
                        const binMeta = item.meta_data?.find(m => m.key === '_bin_location');
                        const supplierMeta = item.meta_data?.find(m => m.key === '_supplier_id');

                        return {
                            ...item,
                            cost_price: costMeta ? parseFloat(costMeta.value) : 0,
                            bin_location: binMeta ? binMeta.value : '',
                            supplier_id: supplierMeta ? parseInt(supplierMeta.value) : null
                        };
                    }
                    return item;
                });

                // Helper to preserve local fields (like tags)
                const ids = processedData.map(i => i.id);
                const existingItems = await table.where('id').anyOf(ids).toArray();
                const existingMap = new Map(existingItems.map(i => [i.id, i]));

                const mergedData = processedData.map(item => {
                    const existing = existingMap.get(item.id);
                    if (existing && existing.local_tags) {
                        return { ...item, local_tags: existing.local_tags };
                    }
                    return item;
                });

                await table.bulkPut(mergedData);
                totalCount += data.length;
                page++;

                // Safety break for very large stores during development
                // if (page > 100) hasMore = false; 
            }
        } catch (err) {
            // faster fail if page is out of range or other error
            console.warn(`Error syncing ${entityName} page ${page}`, err);
            hasMore = false;
        }
    }
    return totalCount;
};

export const syncData = async (settings, onProgress) => {
    try {
        if (!settings.storeUrl || !settings.consumerKey) {
            throw new Error("Settings not configured");
        }

        const counts = {};
        counts.visitor_logs = 0;

        // Sync Products
        counts.products = await syncEntity(settings, fetchProducts, db.products, 'Products', onProgress);

        // --- Sync Orders with Automation Trigger Check ---
        onProgress(`Checking for triggered automations...`);
        // Use filter instead of where('active') to be safe against index issues
        const automations = await db.automations.toArray();
        const activeStatusAutomations = automations.filter(a => a.active && a.trigger_type === 'order_status_change');

        // We wrap fetchOrders to intercept data for rule checking
        const ordersResult = await syncEntity(settings, fetchOrders, db.orders, 'Orders', async (msg) => {
            onProgress(msg);
        }, async (newOrders) => {
            // Automation Logic: Check for status changes
            // We need to fetch the OLD versions of these orders from DB
            const orderIds = newOrders.map(o => o.id).filter(id => id !== null && id !== undefined);

            if (orderIds.length === 0) return;

            const oldOrders = await db.orders.where('id').anyOf(orderIds).toArray();
            const oldOrderMap = new Map();
            oldOrders.forEach(o => oldOrderMap.set(o.id, o));

            for (const newOrder of newOrders) {
                const oldOrder = oldOrderMap.get(newOrder.id);

                // 1. Status Change Check
                if (oldOrder && oldOrder.status !== newOrder.status) {
                    // Find matching rules
                    const rules = activeStatusAutomations.filter(rule => rule.conditions.status === newOrder.status);

                    for (const rule of rules) {
                        console.log(`Triggering Rule "${rule.name}" for Order #${newOrder.id}`);
                        // Execute Action (Send Email)
                        if (rule.action.type === 'send_email') {
                            try {
                                // Simple variable replacement
                                let subject = rule.action.subject;
                                let message = rule.action.message;
                                const customerName = (newOrder.billing?.first_name || 'Customer');

                                subject = subject.replace('{order_id}', newOrder.id).replace('{customer_name}', customerName);
                                message = message.replace('{order_id}', newOrder.id).replace('{customer_name}', customerName);

                                if (newOrder.billing?.email) {
                                    // Import dynamically to avoid circular dependency in top-level
                                    const { sendEmail } = await import('./api');
                                    await sendEmail(settings, {
                                        to: newOrder.billing.email,
                                        subject,
                                        message
                                    });
                                    console.log(`Email sent to ${newOrder.billing.email}`);
                                }
                            } catch (err) {
                                console.error("Failed to execute automation", err);
                            }
                        }
                    }
                }
            }
        });
        counts.orders = ordersResult;

        // Sync Customers (Registered)
        counts.customers = await syncEntity(settings, fetchCustomers, db.customers, 'Customers', onProgress);

        // --- Extract Guest Customers from Orders ---
        onProgress('Processing guest customers...');
        const allOrders = await db.orders.toArray();
        const registeredCustomers = await db.customers.toArray();
        const customerEmails = new Set(registeredCustomers.map(c => c.email.toLowerCase()));

        const guestCustomers = new Map();

        for (const order of allOrders) {
            if (!order.billing?.email) continue;
            const email = order.billing.email.toLowerCase();

            // If not registered and not already processed as guest
            if (!customerEmails.has(email) && !guestCustomers.has(email)) {
                // Create minimal guest profile
                guestCustomers.set(email, {
                    // Use negative ID to avoid collision with WP IDs (which are positive integers)
                    // Or string ID. Dexie key is just 'id'.
                    // Let's use timestamp-based or hash-like for safety, or just simple negative counter?
                    // Safe approach: email as ID? No, schema says 'id'. 
                    // Let's use a hashed ID or negative.
                    id: -Math.abs(email.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) + Math.floor(Math.random() * 10000)),
                    email: order.billing.email,
                    first_name: order.billing.first_name,
                    last_name: order.billing.last_name,
                    role: 'guest',
                    username: `guest_${email.split('@')[0]}`,
                    billing: order.billing,
                    shipping: order.shipping
                });
            }
        }

        if (guestCustomers.size > 0) {
            await db.customers.bulkPut(Array.from(guestCustomers.values()));
            counts.guests = guestCustomers.size;
        } else {
            counts.guests = 0;
        }

        // Sync Coupons
        counts.coupons = await syncEntity(settings, fetchCoupons, db.coupons, 'Coupons', onProgress);

        // --- Sync Visitor Logs ---
        onProgress('Syncing visitor logs...');
        try {
            // Import dynamically to avoid circle if needed, or just use current
            const { fetchVisitorLog } = await import('./api');
            // Visitor logs are special: they are not paginated standardly like WC resources
            // The endpoint returns the last 100 or so. 
            // Better approach: Fetch once and update. 
            // Since we don't have pagination on helper plugin yet, we just grab current batch.
            const logs = await fetchVisitorLog(settings);

            if (Array.isArray(logs) && logs.length > 0) {
                // Map to schema
                const visits = logs.map(l => ({
                    visit_id: l.visit_id,
                    start_time: l.start_time,
                    last_activity: l.last_activity,
                    ip: l.ip,
                    // If we want more details in DB later, add columns. 
                    // For now, these are the critical ones for Reports.
                }));
                // Use bulkPut to upsert
                await db.visits.bulkPut(visits);
                counts.visitor_logs = visits.length;
            }
        } catch (e) {
            console.error("Failed to sync visitor logs", e);
        }

        onProgress(`Sync complete! Fetched ${counts.orders} orders, ${counts.customers} customers, ${counts.guests} guests, ${counts.visitor_logs} visits.`);
        return { success: true, count: counts };
    } catch (error) {
        console.error("Sync failed:", error);
        throw error;
    }
};
