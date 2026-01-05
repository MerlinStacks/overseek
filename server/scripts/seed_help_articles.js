"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
const collections = [
    {
        title: 'Getting Started',
        slug: 'getting-started',
        description: 'Navigation, Dashboard, and core concepts.',
        icon: 'Compass',
        order: 0,
        articles: [
            {
                title: 'Welcome to OverSeek v2',
                slug: 'welcome-to-overseek',
                excerpt: 'An introduction to the OverSeek platform and its core philosophy.',
                order: 0,
                content: `
# Welcome to OverSeek v2

OverSeek is a modern, high-performance warehouse and analytics dashboard designed specifically for WooCommerce. Unlike traditional dashboards that feel slow and clunky, OverSeek is built on a "local-first" philosophy.

## How it Works
Instead of loading data from WooCommerce every time you click a page, OverSeek maintains a **local mirror** of your store's data. This allows for:
- **Instant Search**: Find any product, order, or customer in milliseconds.
- **Advanced Analytics**: Run complex reports that would normally crash a WordPress site.
- **Real-Time Responsiveness**: Drag-and-drop interfaces for easy management.

## Key Features
- **Global Command Palette**: Press \`Cmd+K\` (or \`Ctrl+K\`) to navigate anywhere.
- **In-Situ Picklists**: Generate picklists directly from the Orders page.
- **Dynamic Gold Pricing**: Automatically update your product COGS based on live market data.
- **SEO Health**: Get real-time feedback on your product listings.

We hope you enjoy using OverSeek!
`
            },
            {
                title: 'Mastering the Global Command Palette',
                slug: 'global-command-palette',
                excerpt: 'Learn how to navigate OverSeek like a pro using keyboard shortcuts.',
                order: 1,
                content: `
# Global Command Palette

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
> Use the **Up** and **Down** arrow keys to navigate results, and **Enter** to select.
`
            }
        ]
    },
    {
        title: 'Product Management',
        slug: 'product-management',
        description: 'Managing products, SEO scoring, and syncing.',
        icon: 'Package',
        order: 1,
        articles: [
            {
                title: 'Achieving 100/100 SEO Score',
                slug: 'seo-score-remediation',
                excerpt: 'A comprehensive guide to optimizing your products for search engines.',
                order: 0,
                content: `
# Maximizing Your SEO Score

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
    - Ensure your focus keyword is relevant and used naturally.
`
            },
            {
                title: 'Visual vs. Code Editor',
                slug: 'product-editors',
                excerpt: 'Switching between the rich text editor and raw HTML mode.',
                order: 1,
                content: `
# Text Editors

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
- **classes**: Add custom Tailwind or utility classes.
- **Best For**: Advanced formatting and troubleshooting layout issues.

> [!NOTE]
> Changes sync automatically between modes. You can switch back and forth without losing data.
`
            },
            {
                title: 'Forcing Product Sync',
                slug: 'forcing-sync',
                excerpt: 'How to manually refresh a product from WooCommerce.',
                order: 2,
                content: `
# Forcing a Sync

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
- Look for error messages in the top-right notification area.
`
            }
        ]
    },
    {
        title: 'Inventory & Fulfillment',
        slug: 'inventory-fulfillment',
        description: 'Picklists, BOMs, Purchase Orders, and Stock.',
        icon: 'Truck',
        order: 2,
        articles: [
            {
                title: 'In-Situ Picklists',
                slug: 'insitu-picklists',
                excerpt: 'Generating paper-optimized picklists directly from the Orders page.',
                order: 0,
                content: `
# In-Situ Picklists

OverSeek v2 introduces "In-Situ" picklists, removing the need for a separate "Picking" tab. You can generate picklists directly where you manage orders.

## How to Generate
1.  Go to the **Orders** page.
2.  Select the orders you want to fulfill using the checkboxes.
3.  Click the yellow **"Generate Picklist"** button in the top action bar.

## Features
- **Path Optimization**: Items are sorted by **Bin Location** alphanumerically (e.g., A-1, A-2, B-1), ensuring the most efficient walking path through your warehouse.
- **Batching**: Identical items across multiple orders are aggregated into a single line item.
- **Stock Warnings**: If an item is out of stock, it will be highlighted in **RED** on the printed list.
- **BOM Expansion**: If you sell "Kits" or "Bundles" (Products with a Bill of Materials), the picklist automatically lists the *component parts* needed, not just the parent bundle name.
`
            },
            {
                title: 'Purchase Orders & Snapshots',
                slug: 'purchase-orders',
                excerpt: 'Managing supplier procurement and cost tracking.',
                order: 1,
                content: `
# Purchase Orders

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
- **CANCELLED**: Order voided.
`
            },
            {
                title: 'Understanding BOMs',
                slug: 'bill-of-materials',
                excerpt: 'How OverSeek handles complex assemblies and kits.',
                order: 2,
                content: `
# Bill of Materials (BOM)

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
4.  Add **Components** (other products) or **Supplier Items** (raw materials).
`
            },
            {
                title: 'Inventory Health Alerts',
                slug: 'inventory-alerts',
                excerpt: 'Proactive notifications for low stock based on sales velocity.',
                order: 3,
                content: `
# Inventory Health Alerts

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

You will receive a **single daily email** summarizing all products that have fallen below your threshold, giving you time to reorder before stockouts occur.
`
            }
        ]
    },
    {
        title: 'Analytics & Reporting',
        slug: 'analytics-reporting',
        description: 'Custom reports, Report Builder, and Live View.',
        icon: 'BarChart2',
        order: 3,
        articles: [
            {
                title: 'Report Builder Guide',
                slug: 'report-builder',
                excerpt: 'Create flexible custom reports for any data point.',
                order: 0,
                content: `
# Report Builder

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

This will generate a leaderboard of your best-performing products for the selected period.
`
            },
            {
                title: 'Live Cart Tracking',
                slug: 'live-tracking',
                excerpt: 'Monitor active shopping carts in real-time.',
                order: 1,
                content: `
# Live Cart Tracking

See exactly what is happening on your store *right now*.

## How it works
OverSeek tracks "Sessions" of visitors on your WooCommerce site. If they add an item to their cart, it appears instantly in the **Live View**.

## The Live Dashboard
Go to **Live** in the sidebar. You will see:
- **Active Visitors**: Number of people currently browsing.
- **Active Carts**: Number of people with items in their cart.
- **Potential Revenue**: Total value of all active carts.

## Abandoned Cart Recovery
If a logged-in user (or a guest who entered their email at checkout) leaves without buying, they are flagged for **Abandoned Cart Automation** (configured in the Marketing tab).
`
            }
        ]
    },
    {
        title: 'Settings & Configuration',
        slug: 'settings-config',
        description: 'Platform configuration, Gold Price, and Account settings.',
        icon: 'Settings',
        order: 4,
        articles: [
            {
                title: 'Dynamic Gold Pricing',
                slug: 'gold-pricing',
                excerpt: 'Automating COGS based on live market gold rates.',
                order: 0,
                content: `
# Dynamic Gold Pricing

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
> Ensure your product weights are accurate and set to **Grams** for this calculation to work correctly.
`
            }
        ]
    }
];
function main() {
    return __awaiter(this, void 0, void 0, function* () {
        console.log('🌱 Seeding Help Center Content...');
        for (const collectionData of collections) {
            const { articles } = collectionData, colFields = __rest(collectionData, ["articles"]);
            // 1. Upsert Collection
            const collection = yield prisma.helpCollection.upsert({
                where: { slug: colFields.slug },
                update: colFields,
                create: colFields,
            });
            console.log(`✅ Processed Collection: \${collection.title}\`);

        // 2. Upsert Articles
        for (const articleData of articles) {
            await prisma.helpArticle.upsert({
                where: { slug: articleData.slug },
                update: {
                    ...articleData,
                    collectionId: collection.id
                },
                create: {
                    ...articleData,
                    collectionId: collection.id
                },
            });
            console.log(\`   📄 Processed Article: \${articleData.title}\`);
        }
    }

    console.log('✨ Seeding completed successfully!');
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
            );
        }
    });
}
