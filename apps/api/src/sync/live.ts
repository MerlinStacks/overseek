
import { createClient, AuthMethod } from './client.js';
import { db } from '../db/index.js';
import { storeCredentials, stores } from '../db/schema.js';
import { eq } from 'drizzle-orm';

interface LiveOrderOptions {
    storeId: number; // Used for DB lookup
    fallbackKeys?: { // Provided by frontend during transition
        url: string;
        consumerKey: string;
        consumerSecret: string;
        authMethod?: AuthMethod;
    }
}

export const checkLiveOrders = async (options: LiveOrderOptions) => {
    let url = options.fallbackKeys?.url;
    let key = options.fallbackKeys?.consumerKey;
    let secret = options.fallbackKeys?.consumerSecret;
    let method = options.fallbackKeys?.authMethod || 'basic';

    // Try DB Lookup if credentials are not fully provided
    // This allows gradual migration to server-side keys
    if (!url || !key || !secret) {
        const store = await db.select().from(stores).where(eq(stores.id, options.storeId)).limit(1);
        if (store.length) {
            url = url || store[0].url;
            const creds = await db.select().from(storeCredentials).where(eq(storeCredentials.storeId, options.storeId)).limit(1);
            if (creds.length) {
                key = key || creds[0].consumerKey;
                secret = secret || creds[0].consumerSecret;
            }
        }
    }

    if (!url || !key || !secret) {
        // If we still don't have credentials, we can't proceed
        throw new Error("Missing Store Credentials. Please save settings or provide keys.");
    }

    // Initialize Client
    const client = createClient(url, key, secret, method);

    try {
        // Fetch last 24 hours of orders
        // This is the "Live" check replacing the direct frontend poll
        const oneDayAgo = new Date(Date.now() - 86400000).toISOString();

        const { data } = await client.get('/orders', {
            params: {
                after: oneDayAgo,
                per_page: 10, // Keep it light
                orderby: 'date',
                order: 'desc'
            }
        });

        // Return raw data usually, or formatted?
        // Frontend expects array of orders.
        return data;

    } catch (err: any) {
        console.error("Live Order Check Failed:", err.message);
        throw new Error("Failed to fetch live orders from WooCommerce");
    }
};
