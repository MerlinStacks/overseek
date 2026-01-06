# Overseek: The Sovereign Commerce Operating System
## Ultimate Reference Manual & Feature Guide

**Last Updated:** January 2026
**Version:** 2.0 (Iron Core)

---

## 1. Introduction & Philosophy

**Overseek** is a sovereign, self-hosted commerce operating system designed to replace disjointed SaaS tools with a unified, high-performance "Iron Core." It empowers merchants with total data ownership, zero-latency intelligence, and a unified nervous system for their commerce operations.

It consolidates the functionality of platforms like **Metorik** (Analytics), **FunnelKit** (Marketing), **Crisp** (Chat), and **Matomo** (Tracking) into a single, cohesive interface.

### The "Iron Core" Philosophy
1.  **Sovereignty First**: You own your database. There are no third-party data silos. You decide when to prune your data, not a SaaS billing cycle.
2.  **Instant Speed**: We use a **Server-First** architecture.
    *   **Hot Tier (Planned)**: Future implementation will use local browser storage (IndexedDB via Dexie.js) to mirror recent active data for instant searching without hitting the server.
    *   **Cold Tier (Postgres)**: The remote server holds all data, accessed via efficient pagination.
3.  **Unified Intelligence**: A single mesh where customer support acts on inventory patterns, and marketing listens to logistics data.
    *   *Example*: If a user complains about a delay in Chat, the agent can instantly see the "Backordered" status from the Inventory module without switching tabs.

---

## 2. Infrastructure & Architecture

Overseek is built as a modern full-stack monorepo designed for performance, scale, and ease of deployment.

### 2.1 The Tech Stack
*   **Frontend (The Head)**: Built with **React 18**, **Vite**, and **TypeScript**.
    *   **Architecture**: "Thin Client" model (`AnalyticsService.ts`). The client handles UI state and visualization, but heavy number-crunching is offloaded to the API.
    *   **State Management**: **React Context** (`AuthContext`, `SocketContext`) manages global user sessions and real-time streams.
*   **Backend (The Spine)**: **Express** (Node.js) provides the API layer, with middleware for security (Helmet, CORS) and request parsing.
*   **Database (The Memory)**: **PostgreSQL 16**.
    *   **pgvector**: Enabled for future AI/Vector search capabilities.
    *   **Schema**: managed via Prisma ORM (`schema.prisma`), serving as the single source of truth for all data models.
*   **Search Engine (The Eyes)**: **Elasticsearch 7.17**.
    *   **OmniSearch**: Powers the global command palette (`Cmd+K`). It indexes Orders, Customers, and Products for sub-second text search, distinct from the transactional SQL database.
*   **Real-Time Mesh**: **Redis 7** (AOF Persistence) and **Socket.io**.
    *   **Live Updates**: Pushes "Order Created" or "Message Received" events to connected clients instantly.
    *   **Presence**: Tracks which users are currently viewing specific documents (e.g., "User A is viewing Order #123") via Redis Hashes in `CollaborationService.ts`.

### 2.2 Background Workers
Heavy lifting is offloaded to **BullMQ** workers to keep the API responsive (verified in `server/src/workers/index.ts`).
*   `ORDERS_QUEUE`: Syncs new orders from WooCommerce.
*   `PRODUCTS_QUEUE`: Updates inventory levels and catalog data.
*   `CUSTOMERS_QUEUE`: Syncs customer profiles and lifetime value data.
*   `REVIEWS_QUEUE`: Imports product reviews.
*   `REPORTS_QUEUE`: Generates heavy PDF/CSV reports on a schedule.

### 2.3 Middleware & Security
*   **Rate Limiting**: Configured in `app.ts`.
    *   **Limit**: 2000 requests per 15 minutes per IP. This high limit accommodates the aggressive polling nature of the dashboard's "Live View".
*   **Security Headers**: `Helmet` is configured with a strict Content Security Policy (CSP).
    *   **Note**: CSP is dynamically adjusted to allow the injection of the Chat Widget script.
*   **Encryption**: Sensitive credentials (e.g., SMTP passwords, Meta Ads tokens) are encrypted at rest using **AES-256** (`encryption.ts`).
*   **Cache Control**: All API responses enforce `no-store` headers to ensure data viewed in the dashboard is always real-time.

---

## 3. Integration Protocols

Overseek connects to your existing commerce platforms (primarily WooCommerce) using a dual-protocol strategy designed for both speed and depth.

### Protocol A: Live Analytics (Zero-Config)
*Designed for instant visibility without complex API permissions.*

*   **Concept**: This protocol allows you to start tracking visitors immediately, even if you don't have full API keys for the store yet.
*   **Mechanism**: A "Paste JSON" configuration model.
*   **The Config Blob**:
    ```json
    {
      "apiUrl": "https://your-overseek-instance.com",
      "accountId": "acc_123456789"
    }
    ```
*   **Steps to Enable**:
    1.  Navigate to `Settings > Analytics` in the Overseek Dashboard.
    2.  Copy the generated JSON blob.
    3.  In WordPress, go to `WooCommerce > Overseek`.
    4.  Paste the blob into the "Connection Config" field and click Save.
*   **Events Captured**:
    *   `pageview`: Tracks every page load.
    *   `add_to_cart`: Captures `product_id` and `quantity` (vital for Abandoned Cart recovery).
    *   `checkout_start`: The moment a user focuses the billing email field.
    *   `heartbeat`: Pings every 30 seconds to track "Time on Site".

### Protocol B: Core Sync Engine (Deep Data)
*Designed for operational control (Inventory, Orders, Customers).*

*   **Concept**: A deep, bi-directional sync that mirrors your WooCommerce database into Overseek.
*   **Handshake**: Uses the standard WooCommerce REST API (`wc/v3`).
    *   **Permissions**: We recommend **Read/Write** keys. "Read" allows for analytics, but "Write" is required to update inventory, manage orders, or push tracking numbers back to the store.
*   **Synchronization Strategy**:
    *   **Delta Pull**: To save bandwidth, Overseek only requests records modified *after* the `last_synced_at` timestamp of the previous successful sync.
    *   **Webhooks**: Overseek automatically registers webhooks (if Write access is available) to receive real-time push events (`order.created`, `product.updated`) immediately without waiting for the next poll.

---

## 4. Feature Modules (The A-Z Guide)

### 📊 Analytics & Growth
*   **Live Vitals Monitor**: A real-time dashboard showing revenue velocity, active visitor count, and "pulses" for carts and conversions.
*   **Attribution Modeling**: Distinguishes between sources to show true marketing ROI.
    *   **First Click**: How did they *find* you? (Brand Awareness)
    *   **Last Click**: What made them *buy*? (Conversion Driver)
*   **Reporting Engine**: An automated system (`ReportWorker`) that generates comprehensive PDFs (Weekly/Monthly execution summaries) and emails them to stakeholders.

### 🤖 Automation & Marketing
*   **Visual Flow Builder**: A powerful, drag-and-drop node editor built on **React Flow**.
    *   **Nodes**: Trigger (start), Action (Email/SMS), Delay (Wait X hours), Condition (If/Else).
    *   **Interface**: `FlowBuilder.tsx` provides the canvas.
*   **Automation Engine (The Brain)**: The server-side logic (`AutomationEngine.ts`) that executes these flows.
    *   **Trigger Filters**: Can pre-filter users involved in an automation (e.g. "Only run if Order Value > $50").
    *   **Cycle Guard**: A safety mechanism that imposes a hard limit of **20 steps** to prevent infinite loops in faulty user-created flows.
    *   **Context Injection**: Dynamic variables like `{{customer.firstName}}` are replaced with real data at runtime.
    *   **Dynamic Attachments**: Can generate documents (like Invoices) mid-flow and attach them to subsequent emails.

### 🛍️ Commerce Engine
*   **Hyper-Grid**: A high-performance table interface for managing Orders, Products, and Customers.
    *   **Features**: Bulk tagging, status changing, and "Excel-like" editing.
*   **Supplier Management**: Track product sources and manage **Shadow Inventory** (stock held at the supplier, not in your warehouse).
*   **Identity Matrix (CRM)**: A unified customer profile that merges:
    *   **Order History**: LTV (Lifetime Value), AOV (Average Order Value).
    *   **Communication**: Merges chat logs and email threads into a single timeline.
    *   **Engagement**: Tracks marketing email opens and clicks.

### 💬 Communication Mesh (Unified Inbox)
*   **Dynamic Chat Widget (The "Trojan Horse")**:
    *   **Smart Loading**: The widget script (`widget.js`) is dynamically generated by the server. It checks "Business Hours" and IP Blocks *before* sending code to the client. If the store is closed, the widget code is effectively empty, saving the client from loading heavy UI libraries.
    *   **Features**: Live Chat, Product Cards ("Buy Now"), and File Sharing.
*   **Collaborative Inbox**:
    *   **Presence**: See who else is viewing a ticket to prevent collisions.
    *   **Internal Notes**: Yellow-highlighted messages visible only to staff.
    *   **Canned Responses**: Quick template monitoring.

### 🧠 Intelligence Oracle (Heuristics)
*   **OmniSearch**: A "Spotlight" for your commerce data. Press `Cmd+K` to search anything—Customer Name, Order ID, SKU, or Setting. Backed by **Elasticsearch** for typo-tolerance.
*   **Inventory Intelligence**: `InventoryTools.ts` analyzes stock velocity to surface:
    *   **Low Stock**: Items approaching reorder points.
    *   **Dead Stock**: Items that haven't moved in X days.
*   **Sales Intelligence**: `SalesTools.ts` performs on-the-fly aggregation for "Today vs. Yesterday" performance comparisons.

### 📢 Marketing & Optimization
*   **SEO Scoring Engine**: Analyzing product titles, descriptions, and URL handles against 20+ SEO best practices (`SeoScoringService`).
*   **Merchant Center Validator**: Checks products for Google Shopping compliance (checking for GTIN, Image, Price, and Availability).
*   **Visual Invoice Designer**: A drag-and-drop editor (`InvoiceDesigner.tsx`) that allows you to build custom PDF layouts for your invoices, saved as JSON templates.

### 🏭 Operations & Fabrication
*   **Audit Mode**: A mobile-first interface designed for barcode scanners. Warehouse staff can scan a Bin Location and verify the counts.
*   **Fabrication Nervous System**: Manages **Bills of Materials (BOM)**. Critical for merchants who manufacture their own goods (e.g., jewelry, furniture). Tracks raw material usage against finished goods.
*   **Gold Price Service**: Connects to `GoldAPI.io` to update product prices in real-time based on market spot prices (for jewelry merchants).
*   **Picklist Generation**: Generates optimized PDF picklists that sort items by Bin Location to minimize walking distance in the warehouse.

### 🛠️ Administration & Maintenance
*   **System Health UI**: A dedicated dashboard (`SystemHealth.tsx`) for system admin.
    *   **Capabilities**: Monitor Server Uptime, View/Download System Logs, Clear Logs manually.
*   **Maintenance Scripts**: A suite of CLI tools in `server/src/scripts` for power users:
    *   `reindex-orders.ts`: Forces a complete rebuild of the Elasticsearch index.
    *   `deep-diagnostic.ts`: Runs integrity checks on database relationships.

---

## 5. Roadmap vs. Reality

To ensure complete transparency, this section distinguishes between what is currently shipped and what is planned.

### ✅ Implemented (Reality)
*   **Core**: Full "Iron Core" stack (Node, React, Postgres, Redis, Elastic).
*   **Chat**: Dynamic server-side widget generation.
*   **Automation**: Server-side execution engine with cycle guards.
*   **Integration**: Full WooCommerce sync + Live Analytics.

### 🚧 Roadmap (Vision)
*   **The Janitor**: *Planned*. An automated background service to prune old logs and analytics data based on retention policies.
*   **Stack Purge**: *Planned*. A "Factory Reset" button to wipe all data and start fresh without command-line intervention.
*   **Neural AI**: *Planned*. Replacing the current heuristic logic (`SalesTools.ts`) with actual LLM-based predictive modeling for inventory forecasting.

---

*This document serves as the master source of truth for the Overseek ecosystem.*

---

## 6. Additional Technical Reference (Micro-Features)

### 6.1 Hybrid Logic Engines
To ensure both **instant UI feedback** and **reliable background processing**, Overseek implements a "Hybrid" logic strategy for key features:

*   **SEO Scoring**:
    *   **Client (`seoScoring.ts`)**:Runs in real-time within the `ProductEditor`. As you type, the score updates instantly without hitting the API.
    *   **Server (`SeoScoringService.ts`)**: Runs systematically during bulk imports or nightly audits to catch regressions.
*   **Invoice Generation**:
    *   **Client (`InvoiceGenerator.ts`)**: Uses `jspdf` to render PDF previews in the browser using a **12-Column Grid System**. It performs `{{handlebars}}` variable replacement locally.
    *   **Server**: Uses a matching logic to generate attachments for automated emails.

### 6.2 Administrative Access Points
*   **Bull Board UI**: The background worker dashboard is securely proxied via `vite.config.ts`.
    *   **URL**: `/admin/queues`
### 6.3 Advanced Developer Tools
*   **Debug Endpoints**: Located in `server/src/routes/debug.ts`, these allow for raw Elasticsearch queries (e.g., `GET /api/debug/count`) to verify index integrity without using the UI.
*   **Ad Token Masking**: The `AdsService` middleware (`ads.ts`) automatically masks access tokens (returning only the first 10 chars) before sending data to the frontend, preventing credential leakage in browser network logs.
### 6.7 Ecosystem Integrations & Utilities
*   **WordPress Plugin Internals**: The `overseek-integration-single.php` plugin includes a hidden REST endpoint (`POST /wp-json/overseek/v1/settings`). This allows the Overseek Dashboard to purely **Auto-Configure** the plugin if it has valid WooCommerce API keys, bypassing the need for the user to manually paste the JSON config blob in some scenarios.
*   **Diagnostic Forensics**: The `deep-diagnostic.ts` script allows you to bypass the Prisma ORM entirely. It executes raw SQL (`SELECT tablename FROM pg_catalog.pg_tables`) to provide a "True Count" of every row in the database, which is critical for verifying if Prisma is "hallucinating" or if migrations failed silently.
### 6.8 Intelligence & State Management
*   **Recursive AI Loop**: The `AIService` implements a **multi-turn agentic loop** (max 5 turns) that forces the LLM to use the `AIToolsService` to fetch real database stats before answering. It includes a fallback mechanism that defaults to `mistral-7b-instruct` if the configured OpenRouter key fails.
*   **Context Persistence Strategy**: The `AccountContext` provider implements a "Sticky Session" logic on the client. It prioritizes the active memory state, falls back to `localStorage` (for page reloads), and finally defaults to the first available account, ensuring multi-store merchants never "get lost" between navigations.
### 6.9 Hidden Data Capabilities
*   **Embedded Help Center CMS**: The database schema includes `HelpCollection` and `HelpArticle` tables, indicating that Overseek contains a fully-functional, self-hosted specific Content Management System for internal documentation, decoupled from WordPress.
*   **Workforce Management**: The `User` table contains `shiftStart` and `shiftEnd` fields, enabling basic roster management and "Active Shift" visibility for support agents.
*   **Audit Trail API**: A dedicated `audits.ts` route exposes the `AuditLog` table, ensuring that every sensitive action (Price Change, Stock Adjustment) is legally retrievable via API for compliance purposes.
*   **Public Chat API**: The `chat-public.ts` route is isolated from the main `chat.ts` logic. It is specifically hardened (rate-limited, no auth required) to handle high-volume traffic from the widget without exposing the agent-facing API surface.
*   **Worker Concurrency**: The `QueueFactory` is hardcoded to a **concurrency limit of 5**. This means a single specific queue (e.g., `sync-orders`) can process maximum 5 jobs in parallel per container. This prevents the API from being overwhelmed during massive initial syncs.
### 6.6 User Interface & Reporting Specification
*   **Report Types**: The `ReportsPage` exposes four specific views:
    *   **Overview**: Standard KPI cards (Rev, AOV).
    *   **Forecasting**: A linear regression chart for future sales.
    *   **Stock Velocity**: Identifies fast/slow moving SKUs.
    *   **Custom Builder**: A drag-and-drop interface for ad-hoc queries.
*   **Product Editor Capabilities**:
    *   **History Timeline**: Every product page has a dedicated audit trail tab showing *who* changed *what* field and *when* (`HistoryTimeline.tsx`).
    *   **Collision Detection**: The `PresenceAvatars` component shows real-time "heads" of other staff members currently editing the same product to prevent overwrite conflicts.
    *   **Gold Price Panel**: A specialized widget for jewelry merchants that calculates live margin based on the configured weight and daily spot price.

### 6.10 System Internals & Recovery
*   **Destructive Rebuild Protocol**: The `reindex-orders.ts` script allows for a "Scorched Earth" disaster recovery. It physically deletes the Elasticsearch index and rebuilds it from the raw JSON stored in PostgreSQL (`wooOrder.rawData`), ensuring true data symmetry even if the search index is corrupted.
*   **Superuser Bootstrap**: A hardcoded `create-admin.ts` script exists to force-create the `admin@overseek.com` credentials (bcrypt hash) if the admin is locked out.
*   **Cryptographic Standard**: Data at rest (tokens, secrets) is encrypted using **AES-256-GCM**. The system uses a SHA-256 hash of the `ENCRYPTION_KEY` to derive a stable 32-byte key, and stores data in a `iv:authTag:encryptedData` format to prevent tampering.
*   **Chaos Engineering**: The server includes `repro.ts` and `invoke_error.ts`, designed to simulate high-concurrency race conditions (e.g., token attacks, non-existent user creation) against the production database to verify transactional integrity.

### 6.11 Warehouse Operations
*   **Client-Side Picklist**: The `printPicklist.ts` utility generates a pure HTML/CSS print view for warehouse staff. It aggregates items by Bin Location and aggregates quantities across multiple orders, showing a "Total Qty" per bin to optimize walking paths.

### 6.12 Sync Engine Mechanics
*   **Composite Key Integrity**: The `OrderSync` engine uses a composite key `{ accountId_wooId }` to prevent data collision between multiple stores.
*   **Review Heuristics**: The `ReviewSync` engine implements a **Probabilistic Linker**. It scans the last 50 orders for a matching product + customer email to "guess" the originating order for a review, as WooCommerce does not provide this link natively.
*   **Historical Muting**: The engine logic (`OrderSync.ts`) specifically checks if an order is older than 24 hours (`< 24 * 60 * 60 * 1000`) before emitting `ORDER.CREATED` events. This prevents "New Order" automation spam during historical data imports.
*   **Event Emission**: The system emits granular events:
    *   `ORDER.CREATED`: New orders < 24h old.
    *   `order:completed`: Hardcoded event when status flips to 'completed'.
    *   `ORDER.SYNCED`: Generic event for every touch.
*   **Validation Layer**: Middleware uses `zod` schemas for strict runtime payload validation (`validate.ts`), returning structured JSON error arrays that the frontend form libraries consume directly (mapped by field name).

### 6.13 Automated Reporting Implementation
*   **Server-Side Resolution**: The `ReportWorker` resolves dynamic ranges (`today`, `7d`, `ytd`) at runtime.
*   **SMTP Dependency**: Automated reports **require** a user-configured SMTP account marked as `isDefault`. The system expressly does *not* provide a fallback "System No-Reply" address, meaning reporting will fail silently (log warning only) if the user has not configured their own email gateway.

### 6.14 Client API Layer
*   **Multi-Tenant Header**: The client `api.ts` injects `X-Account-ID` headers on every request, enabling the backend to scope queries to the correct tenant without relying on session state.
*   **Error Normalization**: The `ApiError` class wraps all non-2xx responses, allowing components to catch and display user-friendly messages.

### 6.15 Logging & Observability
*   **PII Guard**: The `requestLogger.ts` middleware explicitly comments out body logging (`// body: req.body`) to prevent accidental PII (Personally Identifiable Information) from being written to logs.

### 6.16 Scheduler Service (Cron Engine)
The `SchedulerService.ts` is the heartbeat of all background operations. It uses a combination of BullMQ repeatable jobs and Node.js `setInterval` tickers.

*   **Global Sync Orchestrator**: A cron job (`*/15 * * * *`) that finds all accounts and dispatches incremental sync jobs with **Low Priority (1)**. If a manual sync (Priority 10) is already running for an account, this job is skipped, preventing conflicts.
*   **Inventory Alerts**: A daily cron (`0 8 * * *`) that calls `InventoryService.sendLowStockAlerts()` for every account.
*   **Email Polling**: A `setInterval` every 2 minutes that queries all `IMAP` email accounts and calls `emailService.checkEmails()`.
*   **Report Scheduler**: A `setInterval` every 15 minutes that queries `ReportSchedule` for due jobs and dispatches them to `QUEUES.REPORTS`.
*   **Abandoned Cart Check**: A `setInterval` every 15 minutes that finds sessions where:
    *   `cartValue > 0`
    *   `lastActiveAt` is between 1 and 24 hours ago.
    *   `email` is captured (not null).
    *   `abandonedNotificationSentAt` is null.
    It then triggers the `ABANDONED_CART` automation for each matching session.

### 6.17 Purchase Order Service (B2B Procurement)
*   **Inbound Inventory Calculation**: The `getInboundInventory()` method aggregates all `PurchaseOrderItem` quantities where the parent PO status is `ORDERED`. This is used to display **"Shadow Stock"** (stock on the way) in the Inventory UI.
*   **Status Workflow**: `DRAFT` → `ORDERED` → `RECEIVED` → `CLOSED`.

### 6.18 Segment Service (Customer Segmentation Engine)
*   **Rule DSL**: Supports a JSON-based rule definition with `AND`/`OR` grouping.
*   **Operators**: Numeric (`gt`, `lt`, `gte`, `lte`, `eq`) and String (`contains`, `equals`, `startsWith`).
*   **Supported Fields**: `totalSpent`, `ordersCount`, `email`, `firstName`, `lastName`.
*   **Preview Limit**: The `previewCustomers` method returns a maximum of 50 customers to prevent UI overload.
*   **Dynamic Resolution**: `getCustomerIdsInSegment` resolves the full list at runtime when a campaign is dispatched, ensuring the segment is always up-to-date.

### 6.19 Tracking Script Internals
The tracking script (`tracking.js`) is dynamically generated by the server and contains client-side analytics logic.

*   **Visitor ID Cookie**: A UUID stored in `_os_vid` with a 365-day expiry.
*   **Beacon API**: Uses `navigator.sendBeacon()` for reliable event delivery during page unloads, falling back to `fetch()`.
*   **UTM Capture**: Automatically extracts `utm_source`, `utm_medium`, `utm_campaign` from the URL query parameters.
*   **Heartbeat**: A 30-second `setInterval` that emits `heartbeat` events to keep the session alive, but **only if `document.visibilityState === 'visible'`** to avoid counting background tabs.
*   **Email Capture (Abandoned Cart)**: Listens to **both** `blur` and `change` events on `input#billing_email` to capture autofilled values.
*   **Cart Value Parsing**: Parses the WooCommerce mini-cart HTML fragment (`div.widget_shopping_cart_content`) to extract the cart total via regex (`text.replace(/[^0-9.]/g, '')`).

### 6.20 Webhook Security (Inbound API)
The `webhook.ts` route handles incoming WooCommerce webhooks with strict security.

*   **HMAC-SHA256 Verification**: Every incoming request is verified against a base64-encoded HMAC-SHA256 signature using the `webhookSecret` (or fallback `wooConsumerSecret`).
*   **Strict Rejection**: If no secret is configured for an account, the webhook is **rejected with 401**, not silently accepted.
*   **Notification Generation**: On `order.created`, a `Notification` record is automatically created, powering the in-app notification bell.
*   **Topics Handled**: `order.created`, `order.updated`, `product.created`, `product.updated`, `customer.created`, `customer.updated`.

### 6.21 Event Bus (Internal Pub/Sub)
The `events.ts` module defines a lightweight, in-process event bus using Node.js `EventEmitter`.

*   **Typed Events**: `EVENTS.ORDER.SYNCED`, `EVENTS.ORDER.CREATED`, `EVENTS.ORDER.COMPLETED`, `EVENTS.REVIEW.LEFT`, `EVENTS.EMAIL.RECEIVED`.
*   **Error Handling**: The bus has a global `error` listener that logs failures via `Logger.error`.
*   **Debug Logging**: Every `emit()` call is logged at the `debug` level, enabling full traceability of inter-service communication.
