#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { OverseekClient, OverseekAPIError } from '@overseek/core';

// ── Config from environment ───────────────────

const OVERSEEK_URL = process.env.OVERSEEK_URL;
const OVERSEEK_TOKEN = process.env.OVERSEEK_TOKEN;
const OVERSEEK_ACCOUNT_ID = process.env.OVERSEEK_ACCOUNT_ID;

if (!OVERSEEK_URL || !OVERSEEK_TOKEN || !OVERSEEK_ACCOUNT_ID) {
  console.error(
    'Missing required environment variables: OVERSEEK_URL, OVERSEEK_TOKEN, OVERSEEK_ACCOUNT_ID'
  );
  process.exit(1);
}

const client = new OverseekClient({
  baseUrl: OVERSEEK_URL,
  token: OVERSEEK_TOKEN,
  accountId: OVERSEEK_ACCOUNT_ID,
});

// ── Helpers ───────────────────────────────────

function ok(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

function err(error: unknown) {
  const message =
    error instanceof OverseekAPIError
      ? `API error ${error.status}: ${error.body}`
      : error instanceof Error
        ? error.message
        : String(error);
  return { content: [{ type: 'text' as const, text: message }], isError: true as const };
}

// ── Server ────────────────────────────────────

const server = new McpServer({ name: 'overseek', version: '1.0.0' });

// ── Orders ────────────────────────────────────

server.tool(
  'overseek_orders_list',
  'List WooCommerce orders. Filter by status, customer ID, or billing email.',
  {
    limit: z.number().min(1).max(100).optional().describe('Max results (default 20)'),
    status: z.string().optional().describe('Order status (processing, completed, on-hold, etc.)'),
    customerId: z.string().optional().describe('WooCommerce customer ID'),
    billingEmail: z.string().optional().describe('Billing email address'),
  },
  async (args) => {
    try { return ok(await client.listOrders(args)); }
    catch (e) { return err(e); }
  }
);

server.tool(
  'overseek_orders_get',
  'Get a single order by ID (internal UUID or WooCommerce ID). Returns line items, shipping, tracking, tags.',
  {
    id: z.string().describe('Order ID (UUID or WooCommerce numeric ID)'),
  },
  async ({ id }) => {
    try { return ok(await client.getOrder(id)); }
    catch (e) { return err(e); }
  }
);

// ── Products ──────────────────────────────────

server.tool(
  'overseek_products_list',
  'List or search WooCommerce products. Returns name, SKU, price, stock, and status.',
  {
    page: z.number().optional().describe('Page number (default 1)'),
    limit: z.number().min(1).max(100).optional().describe('Results per page (default 20)'),
    q: z.string().optional().describe('Search query (name, SKU, description)'),
  },
  async (args) => {
    try { return ok(await client.listProducts(args)); }
    catch (e) { return err(e); }
  }
);

server.tool(
  'overseek_products_get',
  'Get a single product by WooCommerce product ID. Returns full details including variants, stock, pricing.',
  {
    id: z.string().describe('WooCommerce product ID'),
  },
  async ({ id }) => {
    try { return ok(await client.getProduct(id)); }
    catch (e) { return err(e); }
  }
);

// ── Customers ─────────────────────────────────

server.tool(
  'overseek_customers_list',
  'List or search customers. Returns name, email, order count, total spent.',
  {
    page: z.number().optional().describe('Page number (default 1)'),
    limit: z.number().min(1).max(100).optional().describe('Results per page (default 20)'),
    q: z.string().optional().describe('Search query (name, email)'),
  },
  async (args) => {
    try { return ok(await client.listCustomers(args)); }
    catch (e) { return err(e); }
  }
);

server.tool(
  'overseek_customers_get',
  'Get a single customer profile by internal ID. Full details, order count, lifetime value.',
  {
    id: z.string().describe('Customer internal ID'),
  },
  async ({ id }) => {
    try { return ok(await client.getCustomer(id)); }
    catch (e) { return err(e); }
  }
);

// ── Analytics ─────────────────────────────────

server.tool(
  'overseek_analytics_sales',
  'Sales summary (total revenue, order count, currency) for a date range.',
  {
    startDate: z.string().optional().describe('Start date (YYYY-MM-DD)'),
    endDate: z.string().optional().describe('End date (YYYY-MM-DD)'),
  },
  async (args) => {
    try { return ok(await client.getSalesSummary(args)); }
    catch (e) { return err(e); }
  }
);

server.tool(
  'overseek_analytics_sales_chart',
  'Sales data over time for charting — date, revenue, order count per interval.',
  {
    startDate: z.string().optional().describe('Start date (YYYY-MM-DD)'),
    endDate: z.string().optional().describe('End date (YYYY-MM-DD)'),
    interval: z.enum(['daily', 'weekly', 'monthly']).optional().describe('Data interval (default daily)'),
  },
  async (args) => {
    try { return ok(await client.getSalesChart(args)); }
    catch (e) { return err(e); }
  }
);

server.tool(
  'overseek_analytics_top_products',
  'Top-selling products for a date range — product name, quantity sold, revenue.',
  {
    startDate: z.string().optional().describe('Start date (YYYY-MM-DD)'),
    endDate: z.string().optional().describe('End date (YYYY-MM-DD)'),
  },
  async (args) => {
    try { return ok(await client.getTopProducts(args)); }
    catch (e) { return err(e); }
  }
);

server.tool(
  'overseek_analytics_ads',
  'Advertising summary across all connected ad platforms — spend, ROAS, clicks, impressions.',
  {},
  async () => {
    try { return ok(await client.getAdsSummary()); }
    catch (e) { return err(e); }
  }
);

server.tool(
  'overseek_analytics_product_rankings',
  'Product performance rankings sorted by revenue, units, orders, or margin.',
  {
    period: z.enum(['7d', '30d', '90d', 'ytd']).optional().describe('Time period (default 30d)'),
    sortBy: z.enum(['revenue', 'units', 'orders', 'margin']).optional().describe('Sort metric (default revenue)'),
    limit: z.number().optional().describe('Max results (default 10)'),
  },
  async (args) => {
    try { return ok(await client.getProductRankings(args)); }
    catch (e) { return err(e); }
  }
);

server.tool(
  'overseek_analytics_forecast',
  'AI-powered sales forecast for the next N days.',
  {
    days: z.number().optional().describe('Days to forecast (default 30)'),
  },
  async ({ days }) => {
    try { return ok(await client.getSalesForecast(days)); }
    catch (e) { return err(e); }
  }
);

server.tool(
  'overseek_analytics_customer_growth',
  'Customer growth metrics over a date range.',
  {
    startDate: z.string().optional().describe('Start date (YYYY-MM-DD)'),
    endDate: z.string().optional().describe('End date (YYYY-MM-DD)'),
  },
  async (args) => {
    try { return ok(await client.getCustomerGrowth(args)); }
    catch (e) { return err(e); }
  }
);

server.tool(
  'overseek_analytics_channels',
  'Acquisition channel breakdown — where traffic and orders come from.',
  {
    startDate: z.string().optional().describe('Start date (YYYY-MM-DD)'),
    endDate: z.string().optional().describe('End date (YYYY-MM-DD)'),
  },
  async (args) => {
    try { return ok(await client.getAcquisitionChannels(args)); }
    catch (e) { return err(e); }
  }
);

server.tool(
  'overseek_analytics_anomalies',
  'Detect revenue anomalies — unusual spikes or dips vs historical patterns.',
  {},
  async () => {
    try { return ok(await client.getAnomalies()); }
    catch (e) { return err(e); }
  }
);

// ── Inventory ─────────────────────────────────

server.tool(
  'overseek_inventory_health',
  'Inventory health report — products at risk of stockout, sorted by urgency.',
  {},
  async () => {
    try { return ok(await client.getInventoryHealth()); }
    catch (e) { return err(e); }
  }
);

server.tool(
  'overseek_inventory_settings',
  'Current inventory settings — thresholds, alert emails, enabled status.',
  {},
  async () => {
    try { return ok(await client.getInventorySettings()); }
    catch (e) { return err(e); }
  }
);

server.tool(
  'overseek_purchase_orders_list',
  'List purchase orders. Optionally filter by status.',
  {
    status: z.string().optional().describe('PO status (draft, ordered, received)'),
  },
  async (args) => {
    try { return ok(await client.listPurchaseOrders(args)); }
    catch (e) { return err(e); }
  }
);

server.tool(
  'overseek_purchase_orders_get',
  'Get a single purchase order by ID with line items.',
  {
    id: z.string().describe('Purchase order ID'),
  },
  async ({ id }) => {
    try { return ok(await client.getPurchaseOrder(id)); }
    catch (e) { return err(e); }
  }
);

// ── Inbox / Conversations ─────────────────────

server.tool(
  'overseek_inbox_list',
  'List customer conversations from the unified inbox. Filter by status and assignee.',
  {
    limit: z.number().min(1).max(100).optional().describe('Max results (default 50)'),
    status: z.string().optional().describe('Conversation status (open, closed, snoozed)'),
    assignedTo: z.string().optional().describe('Assignee user ID'),
    cursor: z.string().optional().describe('Pagination cursor from previous response'),
  },
  async (args) => {
    try { return ok(await client.listConversations(args)); }
    catch (e) { return err(e); }
  }
);

server.tool(
  'overseek_inbox_get',
  'Get a single conversation with full message history.',
  {
    id: z.string().describe('Conversation ID'),
  },
  async ({ id }) => {
    try { return ok(await client.getConversation(id)); }
    catch (e) { return err(e); }
  }
);

server.tool(
  'overseek_inbox_unread',
  'Get the count of unread conversations in the inbox.',
  {},
  async () => {
    try { return ok(await client.getUnreadCount()); }
    catch (e) { return err(e); }
  }
);

// ── Reviews ───────────────────────────────────

server.tool(
  'overseek_reviews_list',
  'List product reviews. Filter by status or search content. Returns reviewer, rating, review text.',
  {
    page: z.number().optional().describe('Page number (default 1)'),
    limit: z.number().optional().describe('Results per page (default 20)'),
    status: z.string().optional().describe('Review status'),
    search: z.string().optional().describe('Search review content'),
  },
  async (args) => {
    try { return ok(await client.listReviews(args)); }
    catch (e) { return err(e); }
  }
);

// ── Search Console / SEO ──────────────────────

server.tool(
  'overseek_seo_keywords',
  'Google Search Console keyword rankings — position, clicks, impressions, CTR.',
  {
    startDate: z.string().optional().describe('Start date (YYYY-MM-DD)'),
    endDate: z.string().optional().describe('End date (YYYY-MM-DD)'),
    limit: z.number().optional().describe('Max results (default 20)'),
  },
  async (args) => {
    try { return ok(await client.getKeywordRankings(args)); }
    catch (e) { return err(e); }
  }
);

// ── Sync Status ───────────────────────────────

server.tool(
  'overseek_sync_status',
  'WooCommerce sync status — last sync time, counts, health.',
  {},
  async () => {
    try { return ok(await client.getSyncStatus()); }
    catch (e) { return err(e); }
  }
);

// ── Start ─────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('OverSeek MCP server running on stdio');
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
