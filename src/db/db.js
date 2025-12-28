import Dexie from 'dexie';

export const db = new Dexie('WooDashDB');

// Version 19 (Previous)
db.version(19).stores({
    settings: '++id, key, value',
    products: 'id, name, status, price, stock_quantity, sku, date_modified, cost_price, *local_tags, tax_status, tax_class, bin_location, supplier_id',
    orders: 'id, status, total, date_created, customer_id, currency, total_tax, *local_tags',
    customers: 'id, email, first_name, last_name, role, username, *local_tags',
    coupons: 'id, code, amount, discount_type, date_expires',
    dashboard_users: '++id, username, role',
    roles: '++id, name',
    segments: '++id, name, context, filters',
    automations: '++id, name, active, trigger_type, conditions, action',
    customer_notes: '++id, customer_id, content, date_created, author',
    reports: '++id, title, frequency, time, channels, metrics',
    product_components: '++id, parent_id, child_id, quantity',
    suppliers: '++id, name, email, contact_person, lead_time_days',
    purchase_orders: '++id, supplier_id, status, date_created, expected_date',
    visits: '++id, visit_id, start_time, last_activity, ip',
    tax_rates: 'id, name, rate, class',
    invoice_layouts: '++id, name, active',
    todos: '++id, text, done, created_at',
    custom_reports: '++id, name, source',
    email_templates: '++id, name, blocks, globalStyles, created_at, updated_at',
    reviews: 'id, product_id, order_id, customer_id, status, rating, date_created'
});

// Version 20: Multi-tenancy
db.version(20).stores({
    accounts: '++id, name, domain, created_at',

    // Explicitly nullify old tables to trigger deletion (after migration)
    products: null,
    orders: null,
    customers: null,
    coupons: null,
    tax_rates: null,
    reviews: null,

    // New tables with Compound Primary Keys [account_id+id]
    products_v2: '[account_id+id], account_id, name, status, price, stock_quantity, sku, date_modified, cost_price, *local_tags, tax_status, tax_class, bin_location, supplier_id',
    orders_v2: '[account_id+id], account_id, status, total, date_created, customer_id, currency, total_tax, *local_tags',
    customers_v2: '[account_id+id], account_id, email, first_name, last_name, role, username, *local_tags',
    coupons_v2: '[account_id+id], account_id, code, amount, discount_type, date_expires',
    tax_rates_v2: '[account_id+id], account_id, name, rate, class',
    reviews_v2: '[account_id+id], account_id, product_id, order_id, customer_id, status, rating, date_created',

    // Existing tables getting account_id added (keeping ++id)
    settings: '++id, account_id, [account_id+key], value',
    dashboard_users: '++id, username, role', // Users are global for now, or add account_id if specific? Let's make them global first.
    roles: '++id, name', // Global roles
    segments: '++id, account_id, name, context, filters',
    automations: '++id, account_id, name, active, trigger_type, conditions, action',
    customer_notes: '++id, account_id, customer_id, content, date_created, author',
    reports: '++id, account_id, title, frequency, time, channels, metrics',
    product_components: '++id, account_id, parent_id, child_id, quantity',
    suppliers: '++id, account_id, name, email, contact_person, lead_time_days',
    purchase_orders: '++id, account_id, supplier_id, status, date_created, expected_date',
    visits: '++id, account_id, visit_id, start_time, last_activity, ip',
    invoice_layouts: '++id, account_id, name, active',
    todos: '++id, account_id, text, done, created_at',
    custom_reports: '++id, account_id, name, source',
    email_templates: '++id, account_id, name, blocks, globalStyles, created_at, updated_at'
}).upgrade(async tx => {
    // 1. Create Default Account if not exists
    let accountId = 1;
    const existingAccounts = await tx.table('accounts').count();
    if (existingAccounts === 0) {
        accountId = await tx.table('accounts').add({
            name: 'Default Account',
            domain: 'localhost',
            created_at: new Date().toISOString()
        });
    }

    // 2. Helper to migrate data to new tables
    const migrateToV2 = async (oldTable, newTable) => {
        const rows = await tx.table(oldTable).toArray();
        if (rows.length > 0) {
            const newRows = rows.map(r => ({ ...r, account_id: accountId }));
            await tx.table(newTable).bulkAdd(newRows);
        }
    };

    // Migrate content tables
    await migrateToV2('products', 'products_v2');
    await migrateToV2('orders', 'orders_v2');
    await migrateToV2('customers', 'customers_v2');
    await migrateToV2('coupons', 'coupons_v2');
    await migrateToV2('tax_rates', 'tax_rates_v2');
    await migrateToV2('reviews', 'reviews_v2');

    // 3. Update existing tables with account_id
    const tablesToUpdate = [
        'settings', 'segments', 'automations', 'customer_notes', 'reports',
        'product_components', 'suppliers', 'purchase_orders', 'visits',
        'invoice_layouts', 'todos', 'custom_reports', 'email_templates'
    ];

    for (const tableName of tablesToUpdate) {
        await tx.table(tableName).toCollection().modify(r => {
            if (r.account_id === undefined) r.account_id = accountId;
        });
    }
});

// Version 21: Live Chat Schema
db.version(21).stores({
    contacts: '++id, account_id, email, name, last_seen, ip, location',
    conversations: '++id, account_id, contact_id, status, last_message_at, unread_count',
    messages: '++id, account_id, conversation_id, sender, created_at, read',
    saved_replies: '++id, account_id, shortcut, content'
});

// Version 22: Optimization Indices
// Version 23: Scalabilty Indices
db.version(23).stores({
    // Add compound index [account_id+name] for fast autocomplete/search
    products_v2: '[account_id+id], [account_id+name], [account_id+date_created], account_id, name, status, price, stock_quantity, sku, date_modified, cost_price, *local_tags, tax_status, tax_class, bin_location, supplier_id',
    orders_v2: '[account_id+id], [account_id+date_created], account_id, status, total, date_created, customer_id, currency, total_tax, *local_tags'
});

// Map old table names to new ones for code compatibility
db.products = db.table('products_v2');
db.orders = db.table('orders_v2');
db.customers = db.table('customers_v2');
db.coupons = db.table('coupons_v2');
db.tax_rates = db.table('tax_rates_v2');
db.reviews = db.table('reviews_v2');

export const saveSetting = async (key, value, accountId) => {
    if (!accountId) throw new Error("AccountId is required for saving settings");
    const existing = await db.settings.where('[account_id+key]').equals([accountId, key]).first();
    if (existing) {
        await db.settings.update(existing.id, { value });
    } else {
        await db.settings.add({ key, value, account_id: accountId });
    }
};

export const getSetting = async (key, accountId) => {
    if (!accountId) return null;
    const setting = await db.settings.where('[account_id+key]').equals([accountId, key]).first();
    return setting ? setting.value : null;
};
