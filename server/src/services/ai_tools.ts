import { OrderTools } from './tools/OrderTools';
import { InventoryTools } from './tools/InventoryTools';
import { SalesTools } from './tools/SalesTools';
import { ProductTools } from './tools/ProductTools';
import { CustomerTools } from './tools/CustomerTools';
import { AdsTools } from './tools/AdsTools';
import { WooCommerceTools } from './tools/WooCommerceTools';
import { AnalyticsTools } from './tools/AnalyticsTools';
import { Logger } from '../utils/logger';

export interface ToolDefinition {
    name: string;
    description: string;
    parameters: {
        type: string;
        properties: any;
        required: string[];
    };
}

export class AIToolsService {

    static getDefinitions(): ToolDefinition[] {
        return [
            // ─────────────────────────────────────────────────────────
            // Orders & Sales
            // ─────────────────────────────────────────────────────────
            {
                name: "get_recent_orders",
                description: "Get recent orders for the store. Useful for answering questions about latest sales, order volume, or specific recent transactions.",
                parameters: {
                    type: "object",
                    properties: {
                        limit: { type: "integer", description: "Number of orders to retrieve (default 5, max 20)" },
                        status: { type: "string", description: "Filter by status (e.g., 'completed', 'processing', 'pending')" }
                    },
                    required: []
                }
            },
            {
                name: "get_sales_analytics",
                description: "Get sales analytics for a specific period.",
                parameters: {
                    type: "object",
                    properties: {
                        period: { type: "string", description: "Time period: 'today', 'yesterday', 'last_7_days', 'last_30_days', 'this_month'", enum: ["today", "yesterday", "last_7_days", "last_30_days", "this_month"] }
                    },
                    required: ["period"]
                }
            },
            {
                name: "get_revenue_breakdown",
                description: "Get revenue breakdown for a period with comparison to the previous period. Shows current vs previous revenue, order counts, and trend.",
                parameters: {
                    type: "object",
                    properties: {
                        period: { type: "string", description: "Time period: 'today', 'yesterday', 'last_7_days', 'last_30_days', 'this_month'", enum: ["today", "yesterday", "last_7_days", "last_30_days", "this_month"] }
                    },
                    required: []
                }
            },

            // ─────────────────────────────────────────────────────────
            // Products & Inventory
            // ─────────────────────────────────────────────────────────
            {
                name: "get_inventory_summary",
                description: "Get a summary of inventory, including low stock items.",
                parameters: {
                    type: "object",
                    properties: {
                        limit: { type: "integer", description: "Number of low stock items to list (default 5)" }
                    },
                    required: []
                }
            },
            {
                name: "search_products",
                description: "Search for specific products by name or keyword.",
                parameters: {
                    type: "object",
                    properties: {
                        query: { type: "string", description: "Product name or keyword to search for" }
                    },
                    required: ["query"]
                }
            },
            {
                name: "get_top_products",
                description: "Get the best selling products ranked by units sold.",
                parameters: {
                    type: "object",
                    properties: {
                        limit: { type: "integer", description: "Number of products to return (default 5)" }
                    },
                    required: []
                }
            },

            // ─────────────────────────────────────────────────────────
            // Customers & Reviews
            // ─────────────────────────────────────────────────────────
            {
                name: "find_customer",
                description: "Find a customer by name or email.",
                parameters: {
                    type: "object",
                    properties: {
                        query: { type: "string", description: "Email address or name of the customer" }
                    },
                    required: ["query"]
                }
            },
            {
                name: "get_top_customers",
                description: "Get the top customers ranked by total spending.",
                parameters: {
                    type: "object",
                    properties: {
                        limit: { type: "integer", description: "Number of customers to return (default 5)" }
                    },
                    required: []
                }
            },
            {
                name: "get_review_summary",
                description: "Get a summary of product reviews including average rating, distribution, and recent reviews.",
                parameters: {
                    type: "object",
                    properties: {
                        limit: { type: "integer", description: "Number of recent reviews to include (default 5)" }
                    },
                    required: []
                }
            },

            // ─────────────────────────────────────────────────────────
            // Store Overview
            // ─────────────────────────────────────────────────────────
            {
                name: "get_store_overview",
                description: "Get a general overview of the store including total products, customers, orders, reviews, lifetime revenue, and recent activity.",
                parameters: {
                    type: "object",
                    properties: {},
                    required: []
                }
            },

            // ─────────────────────────────────────────────────────────
            // Advertising (Meta & Google Ads)
            // ─────────────────────────────────────────────────────────
            {
                name: "get_ad_performance",
                description: "Get advertising performance metrics (spend, impressions, clicks, CTR, ROAS) from connected ad accounts. Can filter by platform.",
                parameters: {
                    type: "object",
                    properties: {
                        platform: { type: "string", description: "Optional filter: 'meta' or 'google'. Leave empty for all platforms.", enum: ["meta", "google"] }
                    },
                    required: []
                }
            },
            {
                name: "compare_ad_platforms",
                description: "Compare performance between Meta Ads (Facebook/Instagram) and Google Ads. Shows aggregated metrics per platform and a recommendation based on ROAS.",
                parameters: {
                    type: "object",
                    properties: {},
                    required: []
                }
            },
            {
                name: "analyze_google_ads_campaigns",
                description: "Analyze Google Ads campaigns with detailed performance breakdown. Shows top spenders, highest ROAS campaigns, underperformers, and high performers. Use this to understand campaign-level performance.",
                parameters: {
                    type: "object",
                    properties: {
                        days: { type: "integer", description: "Number of days to analyze (default 30)" }
                    },
                    required: []
                }
            },
            {
                name: "analyze_meta_ads_campaigns",
                description: "Analyze Meta Ads (Facebook/Instagram) campaigns with detailed performance breakdown. Shows top spenders, highest ROAS campaigns, underperformers, and high performers.",
                parameters: {
                    type: "object",
                    properties: {
                        days: { type: "integer", description: "Number of days to analyze (default 30)" }
                    },
                    required: []
                }
            },
            {
                name: "get_ad_optimization_suggestions",
                description: "Get AI-powered optimization suggestions for all ad campaigns (Google and Meta). Analyzes performance data and provides actionable recommendations for budget allocation, underperforming campaigns, scaling opportunities, and cross-platform comparison.",
                parameters: {
                    type: "object",
                    properties: {},
                    required: []
                }
            },

            // ─────────────────────────────────────────────────────────
            // Advanced Analytics (New)
            // ─────────────────────────────────────────────────────────
            {
                name: "get_visitor_traffic",
                description: "Get real-time visitor traffic. Shows who is on the site right now, their location, and what they are viewing.",
                parameters: { type: "object", properties: {}, required: [] }
            },
            {
                name: "get_search_insights",
                description: "Get top search terms customers are using on the site.",
                parameters: { type: "object", properties: {}, required: [] }
            },
            {
                name: "get_profitability",
                description: "Calculate store profitability and margins based on COGS.",
                parameters: {
                    type: "object",
                    properties: {
                        period: { type: "string", description: "Time period (e.g., 'this_month', 'last_30_days')", enum: ["this_month", "last_30_days"] }
                    },
                    required: ["period"]
                }
            },
            {
                name: "forecast_sales",
                description: "Forecast sales revenue for the next 7 days based on recent trends.",
                parameters: { type: "object", properties: {}, required: [] }
            },
            {
                name: "analyze_customer_segment",
                description: "Analyze specific customer segments like 'whales' (top spenders) or 'at_risk' (churning high value).",
                parameters: {
                    type: "object",
                    properties: {
                        segment: { type: "string", enum: ["at_risk", "whales"] }
                    },
                    required: ["segment"]
                }
            }
        ];
    }

    // ========================================================================
    // Tool Registry - Maps tool names to their execution handlers
    // ========================================================================

    private static readonly TOOL_REGISTRY: Record<string, (args: Record<string, unknown>, accountId: string) => Promise<unknown>> = {
        // Orders & Sales
        get_recent_orders: (args, accountId) => OrderTools.getRecentOrders(accountId, args.limit as number | undefined, args.status as string | undefined),
        get_sales_analytics: (args, accountId) => SalesTools.getSalesAnalytics(accountId, args.period as string),
        get_revenue_breakdown: (args, accountId) => WooCommerceTools.getRevenueBreakdown(accountId, args.period as string | undefined),

        // Products & Inventory
        get_inventory_summary: (args, accountId) => InventoryTools.getInventorySummary(accountId, args.limit as number | undefined),
        search_products: (args, accountId) => ProductTools.searchProducts(accountId, args.query as string),
        get_top_products: (args, accountId) => WooCommerceTools.getTopProducts(accountId, args.limit as number | undefined),

        // Customers & Reviews
        find_customer: (args, accountId) => CustomerTools.findCustomer(accountId, args.query as string),
        get_top_customers: (args, accountId) => WooCommerceTools.getTopCustomers(accountId, args.limit as number | undefined),
        get_review_summary: (args, accountId) => WooCommerceTools.getReviewSummary(accountId, args.limit as number | undefined),

        // Store Overview
        get_store_overview: (_args, accountId) => WooCommerceTools.getStoreOverview(accountId),

        // Advertising
        get_ad_performance: (args, accountId) => AdsTools.getAdPerformance(accountId, args.platform as string | undefined),
        compare_ad_platforms: (_args, accountId) => AdsTools.compareAdPlatforms(accountId),
        analyze_google_ads_campaigns: (args, accountId) => AdsTools.analyzeGoogleAdsCampaigns(accountId, (args.days as number) || 30),
        analyze_meta_ads_campaigns: (args, accountId) => AdsTools.analyzeMetaAdsCampaigns(accountId, (args.days as number) || 30),
        get_ad_optimization_suggestions: (_args, accountId) => AdsTools.getAdOptimizationSuggestions(accountId),

        // Advanced Analytics
        get_visitor_traffic: (_args, accountId) => AnalyticsTools.getVisitorTraffic(accountId),
        get_search_insights: (_args, accountId) => AnalyticsTools.getSearchInsights(accountId),
        get_profitability: (args, accountId) => AnalyticsTools.getProfitability(accountId, args.period as string),
        forecast_sales: (_args, accountId) => AnalyticsTools.forecastSales(accountId),
        analyze_customer_segment: (args, accountId) => AnalyticsTools.analyzeCustomerSegments(accountId, args.segment as 'at_risk' | 'whales' | 'new'),
    };

    /**
     * Execute a tool by name with the given arguments.
     * Uses a registry pattern instead of switch for maintainability.
     */
    static async executeTool(name: string, args: Record<string, unknown>, accountId: string): Promise<unknown> {
        Logger.debug(`[AITools] Executing ${name} for account ${accountId}`, { args });

        const handler = this.TOOL_REGISTRY[name];
        if (!handler) {
            throw new Error(`Unknown tool: ${name}`);
        }

        return handler(args, accountId);
    }
}

