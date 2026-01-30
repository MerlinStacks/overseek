/**
 * Static Help Centre content - embedded in the application bundle.
 * This ensures documentation is available on every install without database seeding.
 */

export interface HelpArticle {
    id: string;
    title: string;
    slug: string;
    excerpt: string;
    content: string;
    order: number;
    collectionSlug: string;
    updatedAt: string;
}

export interface HelpCollection {
    id: string;
    title: string;
    slug: string;
    description: string;
    icon: string;
    order: number;
    articles: HelpArticle[];
}

const LAST_UPDATED = '2026-01-19';

export const helpCollections: HelpCollection[] = [
    {
        id: 'col-getting-started',
        title: 'Getting Started',
        slug: 'getting-started',
        description: 'Navigation, Dashboard, and core concepts.',
        icon: 'Compass',
        order: 0,
        articles: [
            {
                id: 'art-welcome',
                title: 'Welcome to OverSeek v2',
                slug: 'welcome-to-overseek',
                excerpt: 'An introduction to the OverSeek platform and its core philosophy.',
                order: 0,
                collectionSlug: 'getting-started',
                updatedAt: LAST_UPDATED,
                content: `# Welcome to OverSeek v2

OverSeek is a modern, high-performance warehouse and analytics dashboard designed specifically for WooCommerce. Unlike traditional dashboards that feel slow and clunky, OverSeek is built on a "local-first" philosophy.

## How it Works
Instead of loading data from WooCommerce every time you click a page, OverSeek maintains a **local mirror** of your store's data. This allows for:
- **Instant Search**: Find any product, order, or customer in milliseconds.
- **Advanced Analytics**: Run complex reports that would normally crash a WordPress site.
- **Real-Time Responsiveness**: Drag-and-drop interfaces for easy management.

## Key Features
- **Global Command Palette**: Press \`Cmd+K\` (or \`Ctrl+K\`) to navigate anywhere.
- **Customizable Dashboard**: Drag-and-drop widgets with 17+ analytics and operations options.
- **Dark Mode**: Premium Glassmorphism design with full light/dark/system theme support.
- **AI Marketing Co-Pilot**: Intelligent ad optimization with actionable recommendations.
- **3-Tier Notifications**: In-app, real-time socket, and push notifications.
- **Mobile PWA**: Full-featured companion app for on-the-go management.
- **Team Management**: Invite team members with custom roles and granular permissions.

## What's New in 2026
- **Saved Views**: Filter presets for Orders and Customers pages
- **Status Center**: Unified system health monitoring
- **Revenue Anomaly Detection**: AI-powered alerts for unusual patterns
- **Enhanced Inbox**: Multi-channel with AI drafts and attachment pills

We hope you enjoy using OverSeek!`
            },
            {
                id: 'art-command-palette',
                title: 'Mastering the Global Command Palette',
                slug: 'global-command-palette',
                excerpt: 'Learn how to navigate OverSeek like a pro using keyboard shortcuts.',
                order: 1,
                collectionSlug: 'getting-started',
                updatedAt: LAST_UPDATED,
                content: `# Global Command Palette

The Command Palette is the fastest way to use OverSeek. It allows you to search for products, orders, customers, and navigate to any page without taking your hands off the keyboard.

## Opening the Palette
Press **\`Cmd+K\`** (Mac) or **\`Ctrl+K\`** (Windows) anywhere in the application.

## What can you do?
### 1. Navigation
Type the name of any page to jump to it instantly:
- "Settings"
- "Reports"
- "Inventory"

### 2. Search
- **Products**: Search by name or SKU.
- **Orders**: Search by order number (e.g., "1001").
- **Customers**: Search by name or email.

### 3. Actions
Perform quick actions directly from the palette:
- "Create New Product"
- "Sync Store"
- "Logout"

> [!TIP]
> Use the **Up** and **Down** arrow keys to navigate results, and **Enter** to select.`
            }
        ]
    },
    {
        id: 'col-dashboard-interface',
        title: 'Dashboard & Interface',
        slug: 'dashboard-interface',
        description: 'Widgets, theming, layouts, and saved views.',
        icon: 'LayoutDashboard',
        order: 1,
        articles: [
            {
                id: 'art-customizing-dashboard',
                title: 'Customizing Your Dashboard',
                slug: 'customizing-dashboard',
                excerpt: 'Learn how to personalize your dashboard with drag-and-drop widgets.',
                order: 0,
                collectionSlug: 'dashboard-interface',
                updatedAt: LAST_UPDATED,
                content: `# Customizing Your Dashboard

Your OverSeek dashboard is fully customizable. Add, remove, and rearrange widgets to create the perfect command center for your business.

## Dashboard Modes

### Locked Mode (Default)
Widgets are fixed in place. This prevents accidental changes while working.

### Unlocked Mode
Click the **Lock** icon in the top-right to unlock. Now you can:
- **Drag** widgets to reposition them
- **Resize** widgets by grabbing corners
- **Remove** widgets using the X button

> [!TIP]
> Changes are saved automatically when you lock the dashboard again.

## Adding Widgets

1. Unlock the dashboard
2. Click **Add Widget**
3. Browse the Widget Gallery
4. Click a widget to add it

## Widget Categories

| Category | Examples |
|----------|----------|
| **Analytics** | Sales Chart, Revenue Trends, Traffic Sources |
| **Operations** | Status Center, Recent Orders, Low Stock Alerts |
| **Marketing** | AI Suggestions, Campaign Performance |
| **Communication** | Unread Messages, Active Visitors |

## Mobile Dashboard

The mobile companion app uses a simplified, feed-style layout optimized for touch. Desktop layout changes do not affect mobile.`
            },
            {
                id: 'art-dashboard-widgets',
                title: 'Understanding Widgets',
                slug: 'understanding-widgets',
                excerpt: 'A guide to the 17+ dashboard widgets available in OverSeek.',
                order: 1,
                collectionSlug: 'dashboard-interface',
                updatedAt: LAST_UPDATED,
                content: `# Understanding Widgets

OverSeek includes 17+ pre-built widgets to monitor every aspect of your business.

## Core Widgets

### Status Center
A unified health monitor showing:
- **Sync Status**: WooCommerce connection health
- **Webhook Delivery**: Success/failure rates
- **Queue Health**: Background job processing
- **Revenue Alerts**: Anomaly detection warnings

### Sales Chart
Interactive revenue visualization with:
- Daily, weekly, monthly views
- Year-over-year comparison
- Trend indicators (↑ green, ↓ red)

### Active Visitors
Real-time count of people browsing your store, with:
- 24-hour visitor total
- Active cart count
- Potential revenue value

### Total Sales
Period summary showing:
- Gross revenue
- Order count
- Average Order Value (AOV)

## Analytics Widgets

- **Traffic Sources**: Where visitors come from
- **Conversion Funnel**: Cart → Checkout → Purchase rates
- **Customer Cohorts**: Retention heatmaps
- **Product Rankings**: Best and worst sellers

## Operations Widgets

- **Recent Orders**: Live order feed
- **Low Stock Alerts**: Products below threshold
- **Pending Actions**: Orders awaiting fulfillment

## AI Widgets

- **AI Suggestions**: Marketing recommendations
- **Revenue Forecast**: Predictive sales modeling
- **Anomaly Alerts**: Unusual pattern detection

> [!NOTE]
> Widget data respects your timezone settings. All aggregations use your local business day.`
            },
            {
                id: 'art-dark-mode',
                title: 'Dark Mode & Theming',
                slug: 'dark-mode-theming',
                excerpt: 'Switch between light, dark, and system themes.',
                order: 2,
                collectionSlug: 'dashboard-interface',
                updatedAt: LAST_UPDATED,
                content: `# Dark Mode & Theming

OverSeek features a modern Glassmorphism design with full dark mode support.

## Theme Options

### Light Mode
Bright backgrounds with high contrast. Best for:
- Well-lit environments
- Print-friendly viewing
- Maximum readability

### Dark Mode
Rich dark backgrounds with subtle gradients. Best for:
- Low-light environments
- Reduced eye strain
- Extended work sessions

### System (Auto)
Automatically matches your operating system preference. The theme switches when your OS changes between light and dark mode.

## Switching Themes

1. Click your **profile avatar** in the top-right
2. Find the **Theme** toggle
3. Click to cycle through: Light → Dark → System

You can also access the theme toggle from **Settings > Appearance**.

## Design Philosophy

The 2026 interface uses "Premium Glassmorphism":
- Translucent card backgrounds
- Subtle blur effects
- Smooth gradient accents
- Micro-animations for feedback

> [!TIP]
> Your theme preference is saved and syncs across all your devices.`
            },
            {
                id: 'art-saved-views',
                title: 'Saved Views System',
                slug: 'saved-views',
                excerpt: 'Create and manage filter presets for Orders and Customers pages.',
                order: 3,
                collectionSlug: 'dashboard-interface',
                updatedAt: LAST_UPDATED,
                content: `# Saved Views System

Saved Views let you create reusable filter presets for high-traffic pages like Orders and Customers.

## What are Saved Views?

Instead of manually setting filters every time, save your common filter combinations:
- "Pending Shipments" → Status: Processing, Payment: Paid
- "VIP Customers" → Order Count: 5+, Total Spent: $500+
- "This Week's Orders" → Date: Last 7 days

## Creating a Saved View

1. Go to **Orders** or **Customers** page
2. Apply your desired filters
3. Click **Save View** in the filter bar
4. Enter a name for your view
5. Click **Save**

## Using Saved Views

1. Click the **Saved Views** dropdown
2. Select your view
3. Filters are instantly applied

## Managing Views

- **Rename**: Click the edit icon next to a view
- **Delete**: Click the trash icon
- **Reorder**: Drag views to change their order

## Scope

Saved Views are **account-specific**:
- Each account has its own saved views
- Team members share the same views within an account
- Switching accounts loads that account's views

> [!NOTE]
> Views are stored locally in your browser. They persist across sessions but are not synced between devices.`
            }
        ]
    },
    {
        id: 'col-product-management',
        title: 'Product Management',
        slug: 'product-management',
        description: 'Managing products, SEO scoring, and syncing.',
        icon: 'Package',
        order: 1,
        articles: [
            {
                id: 'art-seo-score',
                title: 'Achieving 100/100 SEO Score',
                slug: 'seo-score-remediation',
                excerpt: 'A comprehensive guide to optimizing your products for search engines.',
                order: 0,
                collectionSlug: 'product-management',
                updatedAt: LAST_UPDATED,
                content: `# Maximizing Your SEO Score

OverSeek includes a real-time SEO scoring engine directly in the Product Edit page. The goal is to reach a score of **100/100** for every product.

## Scoring Criteria

### 1. Content Integrity (40 pts)
- **Title Length**: Product names must be at least 5 characters long.
- **Description**: You must have a description or short description of at least 50 characters.
- **Images**: At least one image must be standard.
- **Price**: The product must have a valid price.

### 2. Keyword Optimization (60 pts)
You must set a **Focus Keyword** in the SEO tab to unlock these points.
- **Keyword in Title**: The focus keyword must appear in the product title.
- **Keyword in Description**: The keyword must be present in the description.
- **Keyword in URL**: The keyword should be part of the product's permalink/slug.

## Remediation Steps
If your score is low:
1.  **Check the SEO Panel**: Open the "SEO Analysis" tab in the right sidebar.
2.  **Review Action Items**: Look for red "Failed" tests.
3.  **Fix Issues**:
    - Update the title to be more descriptive.
    - Write a richer description using the Visual Editor.
    - Add a high-quality product image.
    - Ensure your focus keyword is relevant and used naturally.`
            },
            {
                id: 'art-editors',
                title: 'Visual vs. Code Editor',
                slug: 'product-editors',
                excerpt: 'Switching between the rich text editor and raw HTML mode.',
                order: 1,
                collectionSlug: 'product-management',
                updatedAt: LAST_UPDATED,
                content: `# Text Editors

The Product Edit page features a dual-mode description editor, giving you flexibility in how you manage content.

## Visual Editor
Powered by **ReactQuill**, the visual editor offers a familiar "Word-like" experience.
- **Formatting**: Bold, Italic, Headings, Lists.
- **Media**: Insert images easily.
- **Best For**: General content creation and quick edits.

## Code Editor
Click the \`</>\` icon to switch to the **Code Editor**.
- **Raw HTML**: Edit the underlying HTML directly.
- **Shortcodes**: Perfect for managing WooCommerce shortcodes.
- **Classes**: Add custom Tailwind or utility classes.
- **Best For**: Advanced formatting and troubleshooting layout issues.

> [!NOTE]
> Changes sync automatically between modes. You can switch back and forth without losing data.`
            },
            {
                id: 'art-forcing-sync',
                title: 'Forcing Product Sync',
                slug: 'forcing-sync',
                excerpt: 'How to manually refresh a product from WooCommerce.',
                order: 2,
                collectionSlug: 'product-management',
                updatedAt: LAST_UPDATED,
                content: `# Forcing a Sync

Sometimes, you make a change in WooCommerce directly, and you need it to appear in OverSeek immediately without waiting for the background sync cycle.

## Single Product Sync
1.  Navigate to the **Product Edit Page**.
2.  Look at the top header.
3.  Click the **Sync** button (refresh icon).

The system will:
1.  Fetch the latest data from WooCommerce API.
2.  Update the local database.
3.  Re-calculate SEO scores.
4.  Re-index the product in Elasticsearch.

## Troubleshooting
If a sync fails:
- Check your internet connection.
- Ensure the WooCommerce site is online.
- Look for error messages in the top-right notification area.`
            }
        ]
    },
    {
        id: 'col-inventory',
        title: 'Inventory & Fulfillment',
        slug: 'inventory-fulfillment',
        description: 'Picklists, BOMs, Purchase Orders, and Stock.',
        icon: 'Truck',
        order: 2,
        articles: [
            {
                id: 'art-picklists',
                title: 'In-Situ Picklists',
                slug: 'insitu-picklists',
                excerpt: 'Generating paper-optimized picklists directly from the Orders page.',
                order: 0,
                collectionSlug: 'inventory-fulfillment',
                updatedAt: LAST_UPDATED,
                content: `# In-Situ Picklists

OverSeek v2 introduces "In-Situ" picklists, removing the need for a separate "Picking" tab. You can generate picklists directly where you manage orders.

## How to Generate
1.  Go to the **Orders** page.
2.  Select the orders you want to fulfill using the checkboxes.
3.  Click the yellow **"Generate Picklist"** button in the top action bar.

## Features
- **Path Optimization**: Items are sorted by **Bin Location** alphanumerically (e.g., A-1, A-2, B-1), ensuring the most efficient walking path through your warehouse.
- **Batching**: Identical items across multiple orders are aggregated into a single line item.
- **Stock Warnings**: If an item is out of stock, it will be highlighted in **RED** on the printed list.
- **BOM Expansion**: If you sell "Kits" or "Bundles" (Products with a Bill of Materials), the picklist automatically lists the *component parts* needed, not just the parent bundle name.`
            },
            {
                id: 'art-purchase-orders',
                title: 'Purchase Orders & Snapshots',
                slug: 'purchase-orders',
                excerpt: 'Managing supplier procurement and cost tracking.',
                order: 1,
                collectionSlug: 'inventory-fulfillment',
                updatedAt: LAST_UPDATED,
                content: `# Purchase Orders

Keep track of inbound inventory and supplier costs using the Purchase Order (PO) system.

## Creating a PO
1.  Go to **Inventory > Purchase Orders**.
2.  Click **New Purchase Order**.
3.  Select a **Supplier**.
4.  Add items from the Supplier's catalog or your internal product list.

## Data Snapshots
When you add an item to a PO, OverSeek takes a **Snapshot**.
- It records the *current* Name, SKU, and Cost.
- If the product changes later (e.g., price increase), your historical PO remains accurate to what you actually paid at the time.

## Status Workflow
- **DRAFT**: Planning phase. No stock impact.
- **ORDERED**: Sent to supplier. Stock is counted as "Inbound".
- **RECEIVED**: Items have arrived. Stock is added to your inventory.
- **CANCELLED**: Order voided.`
            },
            {
                id: 'art-bom',
                title: 'Understanding BOMs',
                slug: 'bill-of-materials',
                excerpt: 'How OverSeek handles complex assemblies and kits.',
                order: 2,
                collectionSlug: 'inventory-fulfillment',
                updatedAt: LAST_UPDATED,
                content: `# Bill of Materials (BOM)

A Bill of Materials (BOM) defines what "stuff" makes up a product. This is essential for:
- **Kits/Bundles**: Selling a "Camera Kit" that is composed of a Body + Lens + Bag.
- **Manufacturing**: Selling a finished good made of raw materials.

## Recursive Resolution
OverSeek supports **Recursive BOMs**.
- If Product A is made of Product B.
- And Product B is made of Part C.
- When you sell Product A, the picklist will tell you to pick **Part C**.

## Setting up a BOM
1.  Go to a Product.
2.  Open the **Logistics** tab.
3.  Find the **Bill of Materials** section.
4.  Add **Components** (other products) or **Supplier Items** (raw materials).`
            },
            {
                id: 'art-inventory-alerts',
                title: 'Inventory Health Alerts',
                slug: 'inventory-alerts',
                excerpt: 'Proactive notifications for low stock based on sales velocity.',
                order: 3,
                collectionSlug: 'inventory-fulfillment',
                updatedAt: LAST_UPDATED,
                content: `# Inventory Health Alerts

Don't wait until you reach 0 stock to reorder. OverSeek monitors your **Sales Velocity** to predict when you will run out.

## Days of Inventory Remaining
The core metric is:
\`Current Stock / (Total Sold in Last 30 Days / 30)\`

If you have 10 units, and you sell 1 per day, you have **10 Days Remaining**.

## Configuring Alerts
1.  Go to **Settings > Inventory**.
2.  Set the **"Low Stock Threshold (Days)"** (e.g., 14 days).
3.  Add email recipients.
4.  Enable the system.

You will receive a **single daily email** summarizing all products that have fallen below your threshold, giving you time to reorder before stockouts occur.`
            }
        ]
    },
    {
        id: 'col-analytics',
        title: 'Analytics & Reporting',
        slug: 'analytics-reporting',
        description: 'Custom reports, Email Digests, Cohorts, and Live View.',
        icon: 'BarChart2',
        order: 3,
        articles: [
            {
                id: 'art-report-builder',
                title: 'Report Builder Guide',
                slug: 'report-builder',
                excerpt: 'Create flexible custom reports for any data point.',
                order: 0,
                collectionSlug: 'analytics-reporting',
                updatedAt: LAST_UPDATED,
                content: `# Report Builder

The Custom Report Builder allows you to answer specific questions about your business that standard dashboards miss.

## Creating a Report
1.  Go to **Reports > Custom**.
2.  **Date Range**: Select a preset (Last 30 Days) or custom range.
3.  **Metrics**: Choose what to calculate (Total Sales, Net Sales, Order Count, Items Sold).
4.  **Dimension**: Choose how to group the data (By Day, By Month, By Product, By Customer).
5.  **Filters**: (Optional) Filter by specific categories or status.

## Example: Top Products
- **Metrics**: Items Sold, Net Sales
- **Dimension**: Product Name
- **Sort By**: Net Sales (Desc)

This will generate a leaderboard of your best-performing products for the selected period.`
            },
            {
                id: 'art-live-tracking',
                title: 'Live Cart Tracking',
                slug: 'live-tracking',
                excerpt: 'Monitor active shopping carts in real-time.',
                order: 1,
                collectionSlug: 'analytics-reporting',
                updatedAt: LAST_UPDATED,
                content: `# Live Cart Tracking

See exactly what is happening on your store *right now*.

## How it works
OverSeek tracks "Sessions" of visitors on your WooCommerce site. If they add an item to their cart, it appears instantly in the **Live View**.

## The Live Dashboard
Go to **Live** in the sidebar. You will see:
- **Active Visitors**: Number of people currently browsing.
- **Active Carts**: Number of people with items in their cart.
- **Potential Revenue**: Total value of all active carts.

## Abandoned Cart Recovery
If a logged-in user (or a guest who entered their email at checkout) leaves without buying, they are flagged for **Abandoned Cart Automation** (configured in the Marketing tab).`
            },
            {
                id: 'art-email-digests',
                title: 'Scheduled Email Digests',
                slug: 'email-digests',
                excerpt: 'Receive automated daily or weekly performance summaries.',
                order: 2,
                collectionSlug: 'analytics-reporting',
                updatedAt: LAST_UPDATED,
                content: `# Scheduled Email Digests

Stay informed without logging in. OverSeek can send you automated performance summaries directly to your inbox.

## Digest Types

### Daily Digest
Summarizes **yesterday's** performance compared to the day before:
- Revenue, Order Count, AOV, New Customers
- Top 5 traffic sources
- Top 5 products by quantity sold

### Weekly Digest
Summarizes the **last 7 days** compared to the preceding week:
- All daily metrics aggregated
- Week-over-week trend analysis

## Setting Up Digests
1.  Go to **Reports > Schedules**.
2.  Click **New Digest**.
3.  Choose **Daily** or **Weekly**.
4.  Add recipient email addresses.
5.  Set the delivery time (e.g., 8:00 AM).

## Understanding the Report
- **Green ↑**: Metric improved vs. previous period
- **Red ↓**: Metric declined vs. previous period
- **Percentage**: Shows the magnitude of change`
            },
            {
                id: 'art-customer-cohorts',
                title: 'Customer Cohort Analysis',
                slug: 'customer-cohorts',
                excerpt: 'Understand retention and acquisition patterns through behavioral segmentation.',
                order: 3,
                collectionSlug: 'analytics-reporting',
                updatedAt: LAST_UPDATED,
                content: `# Customer Cohort Analysis

Cohorts help you understand long-term customer behavior beyond single-order metrics.

## Available Cohorts

### Retention Cohorts
Groups customers by their **first purchase month** and tracks how many return in subsequent months.
- See if January customers are more loyal than December customers
- Identify seasonal patterns in repeat behavior
- Track 12-month retention horizons

### Acquisition Source Cohorts
Compares retention rates by **how customers found you**:
- Google Ads vs. Meta Ads vs. Organic
- Which channel brings the most loyal customers?
- Informs budget allocation decisions

### Product-Based Cohorts
Segments customers by their **first product category**:
- Do "Ring" buyers return more than "Necklace" buyers?
- Identify "gateway products" that lead to high LTV
- Optimize merchandising strategy

## Accessing Cohorts
Go to **Reports > Cohorts** to view all three analysis types with visual heatmaps and trend indicators.`
            },
            {
                id: 'art-product-rankings',
                title: 'Product Performance Rankings',
                slug: 'product-rankings',
                excerpt: 'Quickly identify your top and bottom performing products.',
                order: 4,
                collectionSlug: 'analytics-reporting',
                updatedAt: LAST_UPDATED,
                content: `# Product Performance Rankings

The ranking engine provides at-a-glance visibility into your product catalog performance.

## Ranking Criteria
Products are ranked by:
- **Revenue**: Total sales value
- **Units Sold**: Quantity shipped
- **Order Count**: Number of orders containing the product

## Time Periods
Compare across multiple windows:
- **7 Days**: Recent momentum
- **30 Days**: Monthly performance
- **90 Days**: Quarterly trends
- **YTD**: Year-to-date totals

## Trend Indicators
Each product shows a trend arrow:
- **↑ Green**: Performance improving vs. previous period
- **↓ Red**: Performance declining
- **→ Gray**: Stable (less than 5% change)

## Profit Margins
When COGS (Cost of Goods Sold) is set, the ranking includes **profit margin percentages** to identify your most profitable products, not just highest revenue.

## Accessing Rankings
Go to **Reports > Products** and toggle between "Top Performers" and "Bottom Performers" tabs.`
            }
        ]
    },
    {
        id: 'col-ai-marketing',
        title: 'AI & Marketing Intelligence',
        slug: 'ai-marketing',
        description: 'AI Marketing Co-Pilot, Ad Platform Connections, and Optimization.',
        icon: 'TrendingUp',
        order: 4,
        articles: [
            {
                id: 'art-ai-copilot',
                title: 'AI Marketing Co-Pilot Guide',
                slug: 'ai-marketing-copilot',
                excerpt: 'Using the intelligent ad optimization advisor to improve campaign performance.',
                order: 0,
                collectionSlug: 'ai-marketing',
                updatedAt: LAST_UPDATED,
                content: `# AI Marketing Co-Pilot

The AI Marketing Co-Pilot is an intelligent advisor that analyzes your advertising data and provides actionable optimization recommendations.

## How It Works

Instead of manually analyzing spreadsheets, the Co-Pilot:
1. **Aggregates Data**: Pulls metrics from Google Ads and Meta Ads
2. **Analyzes Trends**: Compares 7d, 30d, and 90d performance windows
3. **Applies Intelligence**: Uses marketing best practices and statistical analysis
4. **Generates Recommendations**: Provides specific, actionable suggestions

## Key Capabilities

### Multi-Period Analysis
See how campaigns perform across different timeframes with statistical significance scoring to filter out noise.

### Cross-Channel Attribution
Understand how Google and Meta Ads work together—does Google assist Meta conversions or vice versa?

### LTV-Based Optimization
Move beyond immediate ROAS to focus on Customer Lifetime Value and payback periods.

### Funnel-Aware Insights
Different expectations for Top-of-Funnel (awareness) vs. Bottom-of-Funnel (conversion) campaigns.

## Understanding Recommendations

Each suggestion includes:
- **Confidence Score**: How reliable is this recommendation (based on data volume)
- **Expected Impact**: Estimated improvement if implemented
- **Reasoning**: Why the AI made this suggestion

## Taking Action
Review recommendations in **Marketing > Co-Pilot**. Mark suggestions as "Implemented" or "Dismissed" to help the system learn your preferences.`
            },
            {
                id: 'art-ad-connections',
                title: 'Connecting Ad Platforms',
                slug: 'connecting-ad-platforms',
                excerpt: 'Set up Google Ads and Meta Ads OAuth connections for unified insights.',
                order: 1,
                collectionSlug: 'ai-marketing',
                updatedAt: LAST_UPDATED,
                content: `# Connecting Ad Platforms

OverSeek integrates directly with Google Ads and Meta Ads to pull campaign performance data.

## Google Ads Setup

1. Go to **Settings > Integrations > Google Ads**
2. Click **Connect Google Ads**
3. Sign in with your Google account
4. Grant permission to access your Google Ads data
5. Select the Ads accounts you want to monitor

### What Data is Synced?
- Campaign names, status, and budgets
- Impressions, clicks, conversions
- Cost and ROAS metrics
- Daily performance snapshots

## Meta Ads Setup

1. Go to **Settings > Integrations > Meta Ads**
2. Click **Connect Meta Business**
3. Sign in with your Facebook account
4. Grant permission to access your Ad accounts
5. Select the accounts you want to monitor

### What Data is Synced?
- Campaign and Ad Set performance
- Reach, impressions, clicks, conversions
- Spend and cost metrics
- Audience breakdowns

## Cross-Platform Comparison

Once both platforms are connected, OverSeek enables:
- **Unified Dashboard**: See Google and Meta side-by-side
- **True ROAS**: Match ad spend to actual WooCommerce revenue
- **Attribution Analysis**: Understand cross-platform customer journeys

## Troubleshooting

### Token Expired
OAuth tokens expire periodically. If you see "Reconnect Required", simply re-authorize the platform.

### Missing Data
- Ensure you selected the correct account during setup
- Data syncs every 6 hours; new campaigns may take time to appear`
            }
        ]
    },
    {
        id: 'col-inbox',
        title: 'Communication & Inbox',
        slug: 'communication-inbox',
        description: 'Unified Inbox, Canned Responses, and Conversation Management.',
        icon: 'MessageSquare',
        order: 5,
        articles: [
            {
                id: 'art-inbox-overview',
                title: 'Unified Inbox Overview',
                slug: 'unified-inbox',
                excerpt: 'Managing customer conversations across email, chat, and social channels.',
                order: 0,
                collectionSlug: 'communication-inbox',
                updatedAt: LAST_UPDATED,
                content: `# Unified Inbox

The Unified Inbox brings all your customer communications into one place.

## Supported Channels
- **Email**: Via IMAP integration with your business email
- **Live Chat**: From visitors using the embedded chat widget
- **Social Media**: Facebook and Instagram messages (when connected)

## The Interface

### Conversation List
The left panel shows all conversations sorted by recency. Unread messages are highlighted.

### Message Thread
The center panel shows the full conversation history with a customer.

### Customer Context
The right panel shows:
- Customer profile and order history
- Previous conversations
- Tags and notes

## Assigning Conversations
Click **Assign** to route a conversation to a specific team member. Assignments trigger notifications.

## Status Management
- **Open**: Needs attention
- **Snoozed**: Hidden temporarily (will resurface at set time)
- **Closed**: Resolved

## Business Hours
OverSeek can auto-reply when your business is closed, letting customers know when to expect a response.`
            },
            {
                id: 'art-canned-responses',
                title: 'Canned Responses',
                slug: 'canned-responses',
                excerpt: 'Create and use reusable message templates with rich formatting.',
                order: 1,
                collectionSlug: 'communication-inbox',
                updatedAt: LAST_UPDATED,
                content: `# Canned Responses

Canned responses are pre-written message templates that save time on common replies.

## Creating a Canned Response
1. Go to **Settings > Inbox > Canned Responses**
2. Click **New Response**
3. Enter a **Title** (for easy searching)
4. Write your **Content** using the rich text editor
5. Assign **Labels** for organization
6. Click **Save**

## Rich Text Support
Canned responses support full formatting:
- **Bold**, *italic*, and lists
- Links and formatted text
- Structured layouts

## Using Labels
Labels help organize your templates:
- **Shipping**: Tracking inquiries, delivery updates
- **Returns**: Return policies, refund status
- **Product**: Size guides, care instructions

Create, edit, and delete labels from the Settings page.

## Inserting a Canned Response
While composing a reply:
1. Click the **Canned Responses** icon (or press \`/\`)
2. Search by title or label
3. Click to insert
4. Edit as needed before sending

## Dynamic Variables
Use variables that auto-fill with customer data:
- \`{{customer.name}}\`
- \`{{order.number}}\`
- \`{{order.status}}\``
            },
            {
                id: 'art-conversation-management',
                title: 'Conversation Search & Merge',
                slug: 'conversation-management',
                excerpt: 'Finding conversations and consolidating duplicate customer threads.',
                order: 2,
                collectionSlug: 'communication-inbox',
                updatedAt: LAST_UPDATED,
                content: `# Conversation Management

Keep your inbox organized with search and merge capabilities.

## Searching Conversations

### Quick Search
Use the search bar at the top of the Inbox to find conversations by:
- **Message content**: What was said
- **Customer name**: Who you're talking to
- **Email address**: Customer's email

### Filters
Combine search with filters:
- Status (Open, Closed, Snoozed)
- Assigned team member
- Channel (Email, Chat, Social)
- Date range

## Merging Conversations

Sometimes the same customer contacts you through multiple channels, creating duplicate threads.

### How to Merge
1. Select conversations using the checkboxes
2. Click **Merge** in the action bar
3. Choose the **Primary Conversation** (the one to keep)
4. Confirm the merge

### What Happens
- All messages are combined into the primary thread
- The merged conversation shows all recipient channels
- Original conversations are archived (not deleted)

## Interaction History
Each customer's profile shows their complete **Interaction Timeline**:
- Past conversations (clickable to view)
- Order history
- Site visits and activity

This provides full context before responding.`
            }
        ]
    },
    {
        id: 'col-team-account',
        title: 'Team & Account',
        slug: 'team-account',
        description: 'Setup wizard, team management, roles, and permissions.',
        icon: 'Users',
        order: 7,
        articles: [
            {
                id: 'art-setup-wizard',
                title: 'Account Setup Wizard',
                slug: 'account-setup-wizard',
                excerpt: 'A guided walkthrough for connecting your WooCommerce store and integrations.',
                order: 0,
                collectionSlug: 'team-account',
                updatedAt: LAST_UPDATED,
                content: `# Account Setup Wizard

The Setup Wizard guides you through connecting OverSeek to your WooCommerce store and optional integrations.

## When Does It Run?

The wizard appears automatically when:
- You create your first account
- You add a new store via the Account Switcher

## Wizard Steps

### Step 1: WooCommerce Connection
Connect your store using API credentials:
1. Enter your **Store URL** (e.g., https://mystore.com)
2. Provide your **Consumer Key** and **Consumer Secret**
3. Click **Verify Connection**

> [!TIP]
> Generate API keys in WooCommerce > Settings > Advanced > REST API.

### Step 2: Tracking Plugin
Install the OverSeek tracking plugin on your WordPress site:
- Enables visitor tracking
- Powers abandoned cart recovery
- Connects live chat widget

### Step 3: Email Configuration (Optional)
Configure SMTP for sending emails:
- Order notifications
- Marketing campaigns
- Automated workflows

### Step 4: Ad Platforms (Optional)
Connect advertising accounts:
- Google Ads
- Meta (Facebook/Instagram) Ads

## Skipping Steps

Every step has a **Skip for now** option. You can complete setup later from Settings.

## Demo Mode

If you skip WooCommerce connection, a **Demo Store** with sample data is created automatically. This lets you explore the platform before connecting your real store.`
            },
            {
                id: 'art-team-management',
                title: 'Team Management & Invitations',
                slug: 'team-management',
                excerpt: 'Invite team members and manage access to your account.',
                order: 1,
                collectionSlug: 'team-account',
                updatedAt: LAST_UPDATED,
                content: `# Team Management

Collaborate with your team by inviting members to your OverSeek account.

## Accessing Team Settings

Go to **Settings > Team** to manage your team.

## Inviting Members

1. Click **Invite Team Member**
2. Enter their **email address**
3. Select a **role** (Admin, Staff, or Viewer)
4. Click **Send Invitation**

The invitee receives an email with a link to join your account.

## Role Hierarchy

| Role | Capabilities |
|------|-------------|
| **Owner** | Full access. Cannot be removed. Only one per account. |
| **Admin** | Full access except ownership transfer. Can manage team. |
| **Staff** | Operational access. Can view and edit orders, customers, conversations. |
| **Viewer** | Read-only access. Can view but not modify data. |

## Managing Existing Members

From the Team page:
- **Change Role**: Click the role dropdown next to a member
- **Remove Member**: Click the trash icon (requires confirmation)

## Pending Invitations

View and resend pending invitations. Invitations expire after 7 days.

> [!NOTE]
> Team members can belong to multiple accounts. Each account has its own role assignment.`
            },
            {
                id: 'art-custom-roles',
                title: 'Custom Roles & Permissions',
                slug: 'custom-roles-permissions',
                excerpt: 'Create granular permission sets for your team.',
                order: 2,
                collectionSlug: 'team-account',
                updatedAt: LAST_UPDATED,
                content: `# Custom Roles & Permissions

For advanced access control, create custom roles with specific permission sets.

## Accessing the Roles Manager

Go to **Settings > Roles** to create and manage custom roles.

## Creating a Custom Role

1. Click **New Role**
2. Enter a **Role Name** (e.g., "Support Agent")
3. Configure **Permissions** using the toggles
4. Click **Save**

## Permission Categories

### Commerce
- View Orders
- Edit Orders
- Process Refunds
- Manage Products
- View Analytics

### Communication
- Access Inbox
- Send Messages
- Manage Canned Responses

### Marketing
- View Campaigns
- Create Campaigns
- Manage Automations

### Settings
- View Settings
- Edit Settings
- Manage Team

## Assigning Custom Roles

When assigning a role to a team member:
1. Select **Staff** as the base role
2. Choose your **Custom Role** from the dropdown
3. The custom role's permissions override the default Staff permissions

## Permission Hierarchy

Permissions are resolved in this order:
1. **Owner/Admin**: Always has full access
2. **Custom Role**: Applied to Staff members
3. **User Overrides**: Individual exceptions (coming soon)

> [!IMPORTANT]
> Only Owners and Admins can create and assign custom roles.`
            },
            {
                id: 'art-user-profile',
                title: 'User Profile & Sessions',
                slug: 'user-profile-sessions',
                excerpt: 'Manage your personal settings, security, and active sessions.',
                order: 3,
                collectionSlug: 'team-account',
                updatedAt: LAST_UPDATED,
                content: `# User Profile & Sessions

Your profile contains personal settings that apply across all accounts you belong to.

## Accessing Your Profile

Click your **avatar** in the top-right, then select **Profile**.

## Personal Information

Update your:
- **Display Name**: Shown in conversations and activity logs
- **Email Address**: Used for login and notifications
- **Avatar**: Upload a profile picture

## Security Settings

### Change Password
1. Enter your current password
2. Enter and confirm your new password
3. Click **Update Password**

### Two-Factor Authentication (2FA)
Add an extra layer of security:
1. Click **Enable 2FA**
2. Scan the QR code with an authenticator app
3. Enter the verification code
4. Save your **backup codes** securely

### Active Sessions
View all devices where you're currently logged in:
- **Device Type**: Desktop, Mobile, Tablet
- **Location**: Approximate location based on IP
- **Last Active**: When the session was last used

Click **Revoke** to log out of a specific session.

## Notification Preferences

Control how you receive notifications:
- **Email Notifications**: Digest summaries, alerts
- **Push Notifications**: Real-time browser/mobile alerts
- **Sound Alerts**: Audio notifications for new messages

> [!TIP]
> Revoking all sessions is useful if you suspect your account was compromised.`
            }
        ]
    },
    {
        id: 'col-notifications',
        title: 'Notifications',
        slug: 'notifications',
        description: 'Push notifications, alerts, and notification preferences.',
        icon: 'Bell',
        order: 8,
        articles: [
            {
                id: 'art-notification-overview',
                title: 'Notification System Overview',
                slug: 'notification-system-overview',
                excerpt: 'Understanding the three-tier notification architecture.',
                order: 0,
                collectionSlug: 'notifications',
                updatedAt: LAST_UPDATED,
                content: `# Notification System Overview

OverSeek uses a three-tier notification system to ensure you never miss important events.

## The Three Tiers

### 1. In-App Notifications
Displayed in the **Status Center** widget and notification bell:
- Always available when logged in
- Full history of events
- Mark as read/unread

### 2. Real-Time Socket Notifications
Instant updates while the dashboard is open:
- New messages appear immediately
- Order alerts flash in widgets
- No page refresh needed

### 3. Web Push Notifications
Delivered even when OverSeek is closed:
- Works on desktop and mobile browsers
- Appears in your system notification center
- Click to open the relevant page

## Notification Types

| Category | Examples |
|----------|----------|
| **Orders** | New order, status change, refund requested |
| **Messages** | New inbox message, chat initiated |
| **Inventory** | Low stock alert, stockout warning |
| **Marketing** | Campaign completed, ad performance alert |
| **System** | Sync failure, integration disconnected |

## Account Isolation

Notifications are strictly isolated per account:
- Switching accounts shows different notifications
- Multi-account users only see relevant alerts
- No cross-account data leakage

> [!NOTE]
> High-priority notifications (sync failures, stockouts) are marked with red badges.`
            },
            {
                id: 'art-push-notifications',
                title: 'Configuring Push Notifications',
                slug: 'configuring-push-notifications',
                excerpt: 'Enable browser and mobile push notifications.',
                order: 1,
                collectionSlug: 'notifications',
                updatedAt: LAST_UPDATED,
                content: `# Configuring Push Notifications

Push notifications keep you informed even when OverSeek isn't open.

## Enabling Push Notifications

### Desktop Browsers
1. Go to **Settings > Notifications**
2. Click **Enable Push Notifications**
3. Your browser will ask for permission—click **Allow**
4. You'll receive a test notification confirming setup

### Mobile (PWA)
1. Add OverSeek to your home screen
2. Open the app and go to Settings
3. Enable push notifications
4. Allow when prompted by your device

## Notification Categories

Toggle which events trigger push notifications:

| Category | Default |
|----------|---------|
| New Messages | ✓ On |
| New Orders | ✓ On |
| Low Stock Alerts | ✓ On |
| Sync Failures | ✓ On |
| Marketing Alerts | Off |

## Troubleshooting

### Not Receiving Notifications?

1. **Check Browser Permissions**: Look for the lock icon in the address bar
2. **Check System Settings**: Ensure your OS allows browser notifications
3. **Check Do Not Disturb**: Disable DND mode on your device
4. **Re-enable**: Try disabling and re-enabling in Settings

### Notifications Delayed?

Push notifications rely on background service workers. If your browser is closed completely, notifications may be delayed until you reopen it.

> [!TIP]
> Keep at least one browser tab open for instant notifications.`
            },
            {
                id: 'art-desktop-preferences',
                title: 'Desktop Notification Preferences',
                slug: 'desktop-notification-preferences',
                excerpt: 'Fine-tune notification behavior and auto-dismissal settings.',
                order: 2,
                collectionSlug: 'notifications',
                updatedAt: LAST_UPDATED,
                content: `# Desktop Notification Preferences

Customize how notifications appear and behave on your desktop.

## Notification Display

### Notification Style
- **Banner**: Brief notification that disappears automatically
- **Alert**: Stays until dismissed (for high-priority events)

### Sound Settings
- **Notification Sound**: Toggle audio alerts
- **Sound Type**: Choose from several notification tones
- **Volume**: Adjust notification volume

## Auto-Dismissal

Notifications automatically disappear after a set time:
- **Default**: 10 minutes for standard notifications
- **High Priority**: Requires manual dismissal
- **Snooze Expiry**: Persists until acknowledged

## Grouping & Stacking

When multiple notifications arrive quickly:
- Similar notifications are **grouped** by conversation
- New messages update existing notification badges
- Click to see all grouped items

## Assignment Filtering

For team environments:
- **My Assignments Only**: Only see notifications for conversations assigned to you
- **All Team**: See all account notifications
- **Mentions Only**: Only when you're @mentioned

## Quiet Hours

Set times when notifications are muted:
1. Go to **Settings > Notifications > Quiet Hours**
2. Set **Start** and **End** times
3. Choose which days to apply

During quiet hours, notifications are still logged but won't trigger alerts.

> [!IMPORTANT]
> High-priority alerts (sync failures, stockouts) bypass quiet hours by default.`
            }
        ]
    },
    {
        id: 'col-settings',
        title: 'Settings & Configuration',
        slug: 'settings-config',
        description: 'Platform configuration, Gold Price, and Account settings.',
        icon: 'Settings',
        order: 6,
        articles: [
            {
                id: 'art-gold-pricing',
                title: 'Dynamic Gold Pricing',
                slug: 'gold-pricing',
                excerpt: 'Automating COGS based on live market gold rates.',
                order: 0,
                collectionSlug: 'settings-config',
                updatedAt: LAST_UPDATED,
                content: `# Dynamic Gold Pricing

For jewelry merchants, the cost of goods varies daily with the market price of gold. OverSeek automates this calculation.

## Setup
1.  Go to **Settings**.
2.  Enable **Gold Price Calculator**.
3.  The system will fetch the current market price (XAU/USD) and convert it to specific karats (9k, 14k, 18k, 24k) per gram.

## Product Configuration
On a product:
1.  Set the **Weight** (in grams).
2.  The system calculates \`Material Cost = Weight * Daily Gold Price\`.
3.  This is added to any static "Labor Cost" to determine the final COGS.

> [!WARNING]
> Ensure your product weights are accurate and set to **Grams** for this calculation to work correctly.`
            }
        ]
    }
];

/**
 * Get all collections with their articles
 */
export function getHelpCollections(): HelpCollection[] {
    return helpCollections;
}

/**
 * Get all articles flattened with collection info
 */
export function getAllArticles(): (HelpArticle & { collection: { title: string; slug: string } })[] {
    return helpCollections.flatMap(collection =>
        collection.articles.map(article => ({
            ...article,
            collection: { title: collection.title, slug: collection.slug }
        }))
    );
}

/**
 * Get a single article by slug
 */
export function getArticleBySlug(slug: string): (HelpArticle & { collection: { title: string; slug: string } }) | null {
    for (const collection of helpCollections) {
        const article = collection.articles.find(a => a.slug === slug);
        if (article) {
            return {
                ...article,
                collection: { title: collection.title, slug: collection.slug }
            };
        }
    }
    return null;
}

/**
 * Search articles by query (client-side fuzzy search)
 */
export function searchArticles(query: string): (HelpArticle & { collection: { title: string; slug: string } })[] {
    const lowerQuery = query.toLowerCase();
    return getAllArticles().filter(article =>
        article.title.toLowerCase().includes(lowerQuery) ||
        article.excerpt.toLowerCase().includes(lowerQuery) ||
        article.content.toLowerCase().includes(lowerQuery)
    );
}
