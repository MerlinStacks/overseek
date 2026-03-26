#!/usr/bin/env node

import { Command } from 'commander';
import { OverseekClient } from '@overseek/core';
import { requireConfig, saveConfig } from './config';
import { printJson, printTable, printSummary } from './output';

const program = new Command();

program
  .name('overseek')
  .description('OverSeek CLI — query your WooCommerce store from the terminal')
  .version('1.0.0');

// ── Configure ─────────────────────────────────

program
  .command('configure')
  .description('Save API connection settings to ~/.overseek/config.json')
  .requiredOption('--url <url>', 'OverSeek API base URL')
  .requiredOption('--token <token>', 'JWT bearer token')
  .requiredOption('--account-id <id>', 'Account ID')
  .action((opts) => {
    saveConfig({ url: opts.url, token: opts.token, accountId: opts.accountId });
    console.log('Configuration saved to ~/.overseek/config.json');
  });

// ── Helper to get client ──────────────────────

function getClient(): OverseekClient {
  const config = requireConfig();
  return new OverseekClient({ baseUrl: config.url, token: config.token, accountId: config.accountId });
}

// ── Orders ────────────────────────────────────

const orders = program.command('orders').description('Query orders');

orders
  .command('list')
  .description('List orders')
  .option('--limit <n>', 'Max results', '20')
  .option('--status <status>', 'Filter by status')
  .option('--email <email>', 'Filter by billing email')
  .option('--json', 'Output raw JSON')
  .action(async (opts) => {
    const client = getClient();
    const res = await client.listOrders({
      limit: parseInt(opts.limit),
      status: opts.status,
      billingEmail: opts.email,
    });
    if (opts.json) return printJson(res);
    printTable(
      res.orders.map((o) => ({
        '#': o.number || o.wooId,
        status: o.status,
        total: `${o.currency} ${o.total}`,
        date: o.dateCreated?.slice(0, 10) ?? '—',
      }))
    );
  });

orders
  .command('get <id>')
  .description('Get order details')
  .option('--json', 'Output raw JSON')
  .action(async (id, opts) => {
    const client = getClient();
    const order = await client.getOrder(id);
    if (opts.json) return printJson(order);
    printSummary(`Order #${order.number || order.wooId}`, {
      Status: order.status,
      Total: `${order.currency} ${order.total}`,
      Date: order.dateCreated,
      Tracking: order.tracking_number || '—',
      Tags: order.tags?.join(', ') || '—',
    });
  });

// ── Products ──────────────────────────────────

const products = program.command('products').description('Query products');

products
  .command('list')
  .description('List or search products')
  .option('--limit <n>', 'Results per page', '20')
  .option('--page <n>', 'Page number', '1')
  .option('-q, --query <text>', 'Search query')
  .option('--json', 'Output raw JSON')
  .action(async (opts) => {
    const client = getClient();
    const res = await client.listProducts({
      limit: parseInt(opts.limit),
      page: parseInt(opts.page),
      q: opts.query,
    });
    if (opts.json) return printJson(res);
    printTable(
      res.products.map((p) => ({
        ID: p.wooId,
        Name: p.name,
        SKU: p.sku || '—',
        Price: p.price,
        Stock: p.stockQuantity ?? '—',
        Status: p.stockStatus,
      }))
    );
  });

products
  .command('get <id>')
  .description('Get product details')
  .option('--json', 'Output raw JSON')
  .action(async (id, opts) => {
    const client = getClient();
    const product = await client.getProduct(id);
    if (opts.json) return printJson(product);
    printSummary(product.name, {
      'WooCommerce ID': product.wooId,
      SKU: product.sku || '—',
      Price: product.price,
      'Regular Price': product.regularPrice ?? '—',
      'Sale Price': product.salePrice ?? '—',
      Stock: product.stockQuantity ?? '—',
      'Stock Status': product.stockStatus,
      Type: product.type,
    });
  });

// ── Customers ─────────────────────────────────

const customers = program.command('customers').description('Query customers');

customers
  .command('list')
  .description('List or search customers')
  .option('--limit <n>', 'Results per page', '20')
  .option('--page <n>', 'Page number', '1')
  .option('-q, --query <text>', 'Search query')
  .option('--json', 'Output raw JSON')
  .action(async (opts) => {
    const client = getClient();
    const res = await client.listCustomers({
      limit: parseInt(opts.limit),
      page: parseInt(opts.page),
      q: opts.query,
    });
    if (opts.json) return printJson(res);
    printTable(
      res.customers.map((c) => ({
        ID: c.wooId,
        Name: `${c.firstName} ${c.lastName}`.trim(),
        Email: c.email,
        Orders: c.ordersCount ?? '—',
        Spent: c.totalSpent ?? '—',
      }))
    );
  });

customers
  .command('get <id>')
  .description('Get customer profile')
  .option('--json', 'Output raw JSON')
  .action(async (id, opts) => {
    const client = getClient();
    const c = await client.getCustomer(id);
    if (opts.json) return printJson(c);
    printSummary(`${c.firstName} ${c.lastName}`, {
      Email: c.email,
      'WooCommerce ID': c.wooId,
      Orders: c.ordersCount ?? '—',
      'Total Spent': c.totalSpent ?? '—',
      'Customer Since': c.dateCreated ?? '—',
    });
  });

// ── Analytics ─────────────────────────────────

const analytics = program.command('analytics').description('View analytics and reports');

analytics
  .command('sales')
  .description('Sales summary for a date range')
  .option('--start <date>', 'Start date (YYYY-MM-DD)')
  .option('--end <date>', 'End date (YYYY-MM-DD)')
  .option('--json', 'Output raw JSON')
  .action(async (opts) => {
    const client = getClient();
    const res = await client.getSalesSummary({ startDate: opts.start, endDate: opts.end });
    if (opts.json) return printJson(res);
    printSummary('Sales Summary', {
      Revenue: `${res.currency} ${res.total.toLocaleString()}`,
      Orders: res.count,
    });
  });

analytics
  .command('top-products')
  .description('Top selling products')
  .option('--start <date>', 'Start date (YYYY-MM-DD)')
  .option('--end <date>', 'End date (YYYY-MM-DD)')
  .option('--json', 'Output raw JSON')
  .action(async (opts) => {
    const client = getClient();
    const res = await client.getTopProducts({ startDate: opts.start, endDate: opts.end });
    if (opts.json) return printJson(res);
    printTable(
      (res as any[]).map((p) => ({
        Product: p.name,
        Qty: p.quantity,
        Revenue: p.total,
      }))
    );
  });

analytics
  .command('ads')
  .description('Advertising performance summary')
  .option('--json', 'Output raw JSON')
  .action(async (opts) => {
    const client = getClient();
    const res = await client.getAdsSummary();
    if (opts.json) return printJson(res);
    printSummary('Ad Performance', {
      Spend: `${res.currency} ${res.spend.toLocaleString()}`,
      ROAS: `${res.roas.toFixed(2)}x`,
      Clicks: res.clicks.toLocaleString(),
      Impressions: res.impressions.toLocaleString(),
    });
  });

analytics
  .command('forecast')
  .description('Sales forecast')
  .option('--days <n>', 'Days to forecast', '30')
  .option('--json', 'Output raw JSON')
  .action(async (opts) => {
    const client = getClient();
    const res = await client.getSalesForecast(parseInt(opts.days));
    if (opts.json) return printJson(res);
    printJson(res); // Forecast shape varies — show as JSON
  });

analytics
  .command('anomalies')
  .description('Revenue anomaly detection')
  .option('--json', 'Output raw JSON')
  .action(async (opts) => {
    const client = getClient();
    const res = await client.getAnomalies();
    if (opts.json) return printJson(res);
    printJson(res);
  });

// ── Inventory ─────────────────────────────────

const inventory = program.command('inventory').description('Inventory and stock management');

inventory
  .command('health')
  .description('Stock health report — products at risk of stockout')
  .option('--json', 'Output raw JSON')
  .action(async (opts) => {
    const client = getClient();
    const res = await client.getInventoryHealth();
    if (opts.json) return printJson(res);
    printTable(
      (res as any[]).map((item) => ({
        Product: item.productName || item.sku,
        SKU: item.sku,
        Stock: item.stockQuantity,
        Risk: item.riskLevel,
        'Days Left': item.daysOfStock ?? '—',
      }))
    );
  });

inventory
  .command('purchase-orders')
  .description('List purchase orders')
  .option('--status <status>', 'Filter by status')
  .option('--json', 'Output raw JSON')
  .action(async (opts) => {
    const client = getClient();
    const res = await client.listPurchaseOrders({ status: opts.status });
    if (opts.json) return printJson(res);
    printTable(
      (res as any[]).map((po) => ({
        ID: po.id?.slice(0, 8),
        Status: po.status,
        Supplier: po.supplierName || '—',
        Cost: po.totalCost ?? '—',
        Date: po.createdAt?.slice(0, 10) ?? '—',
      }))
    );
  });

// ── Inbox ─────────────────────────────────────

const inbox = program.command('inbox').description('Unified inbox / conversations');

inbox
  .command('list')
  .description('List conversations')
  .option('--limit <n>', 'Max results', '20')
  .option('--status <status>', 'Filter by status')
  .option('--json', 'Output raw JSON')
  .action(async (opts) => {
    const client = getClient();
    const res = await client.listConversations({
      limit: parseInt(opts.limit),
      status: opts.status,
    });
    if (opts.json) return printJson(res);
    printTable(
      res.conversations.map((c) => ({
        ID: c.id?.slice(0, 8),
        Channel: c.channel,
        Customer: c.customerName || c.customerEmail || '—',
        Status: c.status,
        Last: c.lastMessageAt?.slice(0, 16) ?? '—',
      }))
    );
  });

inbox
  .command('unread')
  .description('Show unread conversation count')
  .option('--json', 'Output raw JSON')
  .action(async (opts) => {
    const client = getClient();
    const res = await client.getUnreadCount();
    if (opts.json) return printJson(res);
    console.log(`\n  Unread conversations: ${res.count}\n`);
  });

// ── Reviews ───────────────────────────────────

const reviews = program.command('reviews').description('Product reviews');

reviews
  .command('list')
  .description('List reviews')
  .option('--limit <n>', 'Results per page', '20')
  .option('--status <status>', 'Filter by status')
  .option('--search <text>', 'Search reviews')
  .option('--json', 'Output raw JSON')
  .action(async (opts) => {
    const client = getClient();
    const res = await client.listReviews({
      limit: parseInt(opts.limit),
      status: opts.status,
      search: opts.search,
    });
    if (opts.json) return printJson(res);
    printTable(
      res.reviews.map((r) => ({
        Product: r.productName || '—',
        Rating: '★'.repeat(r.rating) + '☆'.repeat(5 - r.rating),
        Reviewer: r.reviewer,
        Status: r.status,
        Date: r.dateCreated?.slice(0, 10) ?? '—',
      }))
    );
  });

// ── SEO ───────────────────────────────────────

const seo = program.command('seo').description('Search Console / SEO data');

seo
  .command('keywords')
  .description('Keyword rankings from Google Search Console')
  .option('--start <date>', 'Start date (YYYY-MM-DD)')
  .option('--end <date>', 'End date (YYYY-MM-DD)')
  .option('--limit <n>', 'Max results', '20')
  .option('--json', 'Output raw JSON')
  .action(async (opts) => {
    const client = getClient();
    const res = await client.getKeywordRankings({
      startDate: opts.start,
      endDate: opts.end,
      limit: parseInt(opts.limit),
    });
    if (opts.json) return printJson(res);
    printTable(
      (res as any[]).map((kw) => ({
        Keyword: kw.keyword,
        Position: kw.position?.toFixed(1),
        Clicks: kw.clicks,
        Impressions: kw.impressions,
        CTR: `${(kw.ctr * 100).toFixed(1)}%`,
      }))
    );
  });

// ── Sync ──────────────────────────────────────

program
  .command('sync-status')
  .description('WooCommerce sync status')
  .option('--json', 'Output raw JSON')
  .action(async (opts) => {
    const client = getClient();
    const res = await client.getSyncStatus();
    if (opts.json) return printJson(res);
    printSummary('Sync Status', {
      Status: res.status,
      'Last Sync': res.lastSync ?? '—',
      Products: res.productsCount ?? '—',
      Orders: res.ordersCount ?? '—',
      Customers: res.customersCount ?? '—',
    });
  });

// ── Run ───────────────────────────────────────

program.parseAsync().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
