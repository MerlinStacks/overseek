import axios from 'axios';

// We now create a function to get the API instance because we need to inject the keys dynamically
// or we can pass the keys to the API calls.
// A better approach for a React app is to generate the axios instance or config headers when needed.

// Helper to create client config
const getClientConfig = (url, key, secret, authMethod) => {
    const cleanUrl = url.replace(/\/$/, '');
    const cleanKey = key.trim();
    const cleanSecret = secret.trim();
    const isHttps = cleanUrl.startsWith('https');

    const config = {
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        },
        params: {}
    };

    const useBasic = authMethod === 'basic' || (authMethod === 'auto' && isHttps);

    if (useBasic) {
        config.auth = {
            username: cleanKey,
            password: cleanSecret
        };
    } else {
        config.params = {
            consumer_key: cleanKey,
            consumer_secret: cleanSecret
        };
    }
    return { baseURL: cleanUrl, config };
};

// Client Cache to prevent memory churn and allow connection reuse
let _cachedClient = null;
let _cachedConfigHash = null;

const createWCClient = (url, key, secret, authMethod = 'auto') => {
    // strict check
    if (!url || !key) return null;

    const configHash = `${url}|${key}|${authMethod}`;

    // Return cached instance if config hasn't changed
    if (_cachedClient && _cachedConfigHash === configHash) {
        return _cachedClient;
    }

    const { baseURL, config } = getClientConfig(url, key, secret, authMethod);
    config.baseURL = `${baseURL}/wp-json/wc/v3`;

    // Create new instance
    const client = axios.create(config);

    // Update Cache
    _cachedClient = client;
    _cachedConfigHash = configHash;

    return client;
};

// Client for WP REST API (not WC)
const createWPClient = (url, key, secret, authMethod = 'auto') => {
    const { baseURL, config } = getClientConfig(url, key, secret, authMethod);
    config.baseURL = `${baseURL}/wp-json/wp/v2`;
    return axios.create(config);
};

export const fetchProducts = async (settings, params = {}) => {
    if (!settings.storeUrl || !settings.consumerKey) throw new Error("API not configured");
    const client = createWCClient(
        settings.storeUrl,
        settings.consumerKey,
        settings.consumerSecret,
        settings.authMethod
    );
    const response = await client.get('/products', { params });
    return response.data;
};

export const fetchOrders = async (settings, params = {}) => {
    if (!settings.storeUrl || !settings.consumerKey) throw new Error("API not configured");
    const client = createWCClient(
        settings.storeUrl,
        settings.consumerKey,
        settings.consumerSecret,
        settings.authMethod
    );
    const response = await client.get('/orders', { params });
    return response.data;
};

export const fetchCustomers = async (settings, params = {}) => {
    if (!settings.storeUrl || !settings.consumerKey) throw new Error("API not configured");
    const client = createWCClient(
        settings.storeUrl,
        settings.consumerKey,
        settings.consumerSecret,
        settings.authMethod
    );
    const response = await client.get('/customers', { params });
    return response.data;
};

export const fetchReports = async (settings, params = {}) => {
    if (!settings.storeUrl || !settings.consumerKey) throw new Error("API not configured");
    const client = createWCClient(
        settings.storeUrl,
        settings.consumerKey,
        settings.consumerSecret,
        settings.authMethod
    );
    const response = await client.get('/reports/sales', { params });
    return response.data;
};

export const updateOrder = async (settings, orderId, data) => {
    if (!settings.storeUrl || !settings.consumerKey) throw new Error("API not configured");
    const client = createWCClient(
        settings.storeUrl,
        settings.consumerKey,
        settings.consumerSecret,
        settings.authMethod
    );
    const response = await client.put(`/orders/${orderId}`, data);
    return response.data;
};

export const updateProduct = async (settings, productId, data) => {
    if (!settings.storeUrl || !settings.consumerKey) throw new Error("API not configured");
    const client = createWCClient(
        settings.storeUrl,
        settings.consumerKey,
        settings.consumerSecret,
        settings.authMethod
    );
    const response = await client.put(`/products/${productId}`, data);
    return response.data;
};

export const fetchVariations = async (settings, productId, params = {}) => {
    if (!settings.storeUrl || !settings.consumerKey) throw new Error("API not configured");
    const client = createWCClient(
        settings.storeUrl,
        settings.consumerKey,
        settings.consumerSecret,
        settings.authMethod
    );
    const response = await client.get(`/products/${productId}/variations`, { params });
    return response.data;
};

export const updateVariation = async (settings, productId, variationId, data) => {
    if (!settings.storeUrl || !settings.consumerKey) throw new Error("API not configured");
    const client = createWCClient(
        settings.storeUrl,
        settings.consumerKey,
        settings.consumerSecret,
        settings.authMethod
    );
    const response = await client.put(`/products/${productId}/variations/${variationId}`, data);
    return response.data;
};

export const createProduct = async (settings, data) => {
    if (!settings.storeUrl || !settings.consumerKey) throw new Error("API not configured");
    const client = createWCClient(
        settings.storeUrl,
        settings.consumerKey,
        settings.consumerSecret,
        settings.authMethod
    );
    const response = await client.post('/products', data);
    return response.data;
};

export const batchProducts = async (settings, data) => {
    if (!settings.storeUrl || !settings.consumerKey) throw new Error("API not configured");
    const client = createWCClient(
        settings.storeUrl,
        settings.consumerKey,
        settings.consumerSecret,
        settings.authMethod
    );
    const response = await client.post('/products/batch', data);
    return response.data;
};

export const createOrder = async (settings, data) => {
    if (!settings.storeUrl || !settings.consumerKey) throw new Error("API not configured");
    const client = createWCClient(
        settings.storeUrl,
        settings.consumerKey,
        settings.consumerSecret,
        settings.authMethod
    );
    const response = await client.post('/orders', data);
    return response.data;
};

// --- Coupons ---
export const fetchCoupons = async (settings, params = {}) => {
    if (!settings.storeUrl || !settings.consumerKey) throw new Error("API not configured");
    const client = createWCClient(
        settings.storeUrl,
        settings.consumerKey,
        settings.consumerSecret,
        settings.authMethod
    );
    const response = await client.get('/coupons', { params });
    return response.data;
};

export const createCoupon = async (settings, data) => {
    if (!settings.storeUrl || !settings.consumerKey) throw new Error("API not configured");
    const client = createWCClient(
        settings.storeUrl,
        settings.consumerKey,
        settings.consumerSecret,
        settings.authMethod
    );
    const response = await client.post('/coupons', data);
    return response.data;
};

export const deleteCoupon = async (settings, id) => {
    if (!settings.storeUrl || !settings.consumerKey) throw new Error("API not configured");
    const client = createWCClient(
        settings.storeUrl,
        settings.consumerKey,
        settings.consumerSecret,
        settings.authMethod
    );
    const response = await client.delete(`/coupons/${id}`, { params: { force: true } });
    return response.data;
};

export const fetchCurrentUser = async (settings) => {
    if (!settings.storeUrl || !settings.consumerKey) throw new Error("API not configured");
    const client = createWPClient(
        settings.storeUrl,
        settings.consumerKey,
        settings.consumerSecret,
        settings.authMethod
    );
    try {
        const response = await client.get('/users/me');
        return response.data;
    } catch (e) {
        console.warn("Could not fetch /users/me", e);
        throw e;
    }
};

export const fetchWPUsers = async (settings, params = {}) => {
    if (!settings.storeUrl || !settings.consumerKey) throw new Error("API not configured");
    const client = createWPClient(
        settings.storeUrl,
        settings.consumerKey,
        settings.consumerSecret,
        settings.authMethod
    );
    const response = await client.get('/users', { params: { context: 'edit', ...params } });
    return response.data;
};

export const createWPUser = async (settings, data) => {
    if (!settings.storeUrl || !settings.consumerKey) throw new Error("API not configured");
    const client = createWPClient(
        settings.storeUrl,
        settings.consumerKey,
        settings.consumerSecret,
        settings.authMethod
    );
    const response = await client.post('/users', data);
    return response.data;
};

export const deleteWPUser = async (settings, id, reassignId) => {
    if (!settings.storeUrl || !settings.consumerKey) throw new Error("API not configured");
    const client = createWPClient(
        settings.storeUrl,
        settings.consumerKey,
        settings.consumerSecret,
        settings.authMethod
    );
    const params = { force: true };
    if (reassignId) params.reassign = reassignId;

    const response = await client.delete(`/users/${id}`, { params });
    return response.data;
};

export const fetchCarts = async (settings) => {
    if (!settings.storeUrl || !settings.consumerKey) throw new Error("API not configured");
    const client = createWCClient(
        settings.storeUrl,
        settings.consumerKey,
        settings.consumerSecret,
        settings.authMethod
    );
    // Custom endpoint from helper plugin. 
    // Note: createWCClient appends /wc/v3, but our custom route is at /wc-dash/v1.
    // We need to override the baseURL or just use absolute path if axios allows, 
    // or easier: create a custom client or hack the url.

    // Hack: The baseURL in client is .../wp-json/wc/v3. 
    // We want .../wp-json/wc-dash/v1.
    // So we can pass a relative path that goes up: ../../wc-dash/v1/carts

    const response = await client.get('../../wc-dash/v1/carts');
    return response.data;
};

export const sendEmail = async (settings, data) => {
    if (!settings.storeUrl || !settings.consumerKey) throw new Error("API not configured");
    const client = createWCClient(
        settings.storeUrl,
        settings.consumerKey,
        settings.consumerSecret,
        settings.authMethod
    );
    // Custom endpoint
    const response = await client.post('../../wc-dash/v1/email/send', data);
    return response.data;
};

export const fetchSMTP = async (settings) => {
    if (!settings.storeUrl || !settings.consumerKey) throw new Error("API not configured");
    const client = createWCClient(settings.storeUrl, settings.consumerKey, settings.consumerSecret, settings.authMethod);
    const response = await client.get('../../wc-dash/v1/settings/smtp');
    return response.data;
};

export const saveSMTP = async (settings, data) => {
    if (!settings.storeUrl || !settings.consumerKey) throw new Error("API not configured");
    const client = createWCClient(settings.storeUrl, settings.consumerKey, settings.consumerSecret, settings.authMethod);
    const response = await client.post('../../wc-dash/v1/settings/smtp', data);
    return response.data;
};

export const fetchVisitorCount = async (settings) => {
    if (!settings.storeUrl || !settings.consumerKey) throw new Error("API not configured");
    const client = createWCClient(settings.storeUrl, settings.consumerKey, settings.consumerSecret, settings.authMethod);
    const response = await client.get('../../wc-dash/v1/visitors');
    return response.data;
};

export const fetchVisitorLog = async (settings) => {
    if (!settings.storeUrl || !settings.consumerKey) throw new Error("API not configured");
    const client = createWCClient(settings.storeUrl, settings.consumerKey, settings.consumerSecret, settings.authMethod);
    const response = await client.get('../../wc-dash/v1/visitor-log');
    return response.data;
};

export const fetchSystemStatus = async (settings) => {
    if (!settings.storeUrl || !settings.consumerKey) throw new Error("API not configured");
    // Use try-catch here as it is a debug endpoint
    try {
        const client = createWCClient(settings.storeUrl, settings.consumerKey, settings.consumerSecret, settings.authMethod);
        const response = await client.get('../../wc-dash/v1/status');
        return response.data;
    } catch (e) {
        return null; // Endpoint might not exist on older versions
    }
};
export const installDB = async (settings) => {
    if (!settings.storeUrl || !settings.consumerKey) throw new Error("API not configured");
    const client = createWCClient(settings.storeUrl, settings.consumerKey, settings.consumerSecret, settings.authMethod);
    const response = await client.post('../../wc-dash/v1/install-db');
    return response.data;
};

export const createTestVisit = async (settings) => {
    if (!settings.storeUrl || !settings.consumerKey) throw new Error("API not configured");
    const client = createWCClient(settings.storeUrl, settings.consumerKey, settings.consumerSecret, settings.authMethod);
    const response = await client.post('../../wc-dash/v1/test-visit');
    return response.data;
};

export const fetchWCSettings = async (settings, group, id) => {
    if (!settings.storeUrl || !settings.consumerKey) throw new Error("API not configured");
    const client = createWCClient(
        settings.storeUrl,
        settings.consumerKey,
        settings.consumerSecret,
        settings.authMethod
    );
    // Endpoint: /settings/{group}/{id}
    const response = await client.get(`/settings/${group}/${id}`);
    return response.data;
};

export const fetchTaxRates = async (settings, params = {}) => {
    if (!settings.storeUrl || !settings.consumerKey) throw new Error("API not configured");
    const client = createWCClient(
        settings.storeUrl,
        settings.consumerKey,
        settings.consumerSecret,
        settings.authMethod
    );
    const response = await client.get('/taxes', { params });
    return response.data;
};

export const fetchChatMessages = async (settings, params = {}) => {
    if (!settings.storeUrl || !settings.consumerKey) throw new Error("API not configured");
    const client = createWCClient(settings.storeUrl, settings.consumerKey, settings.consumerSecret, settings.authMethod);
    const response = await client.get('../../wc-dash/v1/chat/messages', { params });
    return response.data;
};

export const sendChatMessage = async (settings, data) => {
    if (!settings.storeUrl || !settings.consumerKey) throw new Error("API not configured");
    const client = createWCClient(settings.storeUrl, settings.consumerKey, settings.consumerSecret, settings.authMethod);
    const response = await client.post('../../wc-dash/v1/chat/send', data);
    return response.data;
};

// --- Geocoding (Nominatim) ---
const GEO_CACHE = {};
const LAST_GEO_CALL = { time: 0 };

export const geocodeAddress = async (address) => {
    if (!address) return null;

    // Check Cache first (simple memory cache, persistence layer handles DB)
    if (GEO_CACHE[address]) return GEO_CACHE[address];

    // Rate Limit: 1 request per second
    const now = Date.now();
    const timeSinceLast = now - LAST_GEO_CALL.time;
    if (timeSinceLast < 1000) {
        await new Promise(r => setTimeout(r, 1000 - timeSinceLast));
    }
    LAST_GEO_CALL.time = Date.now();

    try {
        const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1`, {
            headers: {
                'User-Agent': 'WooDash-App/1.0'
            }
        });

        const data = await response.json();
        if (data && data.length > 0) {
            const result = { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
            GEO_CACHE[address] = result;
            return result;
        }
    } catch (e) {
        console.error("Geocoding failed for", address, e);
    }
    return null;
};
export const restartServer = async (settings) => {
    // This hits our local middleware backend via the Vite proxy
    const response = await axios.post('/admin/restart');
    return response.data;
};
