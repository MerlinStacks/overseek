# Changelog

All notable changes to this project will be documented in this file.

## [2.3.1] - 2026-02-01

### 🔒 Security & Code Quality
- **XSS Audit Verified**: Confirmed all 9 `dangerouslySetInnerHTML` usages properly sanitized with DOMPurify.
- **Debug Logging Cleanup**: Removed 14 debug `console.log` statements from production server code (`workers/index.ts`, `BOMInventorySyncService.ts`).

---

## [2.3.0] - 2026-01-25

### 🏷️ White-Label & Self-Hosting Support
- **Environment-Based Branding**: All hardcoded domain references removed from codebase.
  - Server: `APP_NAME`, `APP_URL`, `API_URL`, `CONTACT_EMAIL` environment variables.
  - Client: `VITE_APP_NAME`, `VITE_SUPPORT_EMAIL`, `VITE_LEGAL_EMAIL`, `VITE_PRIVACY_EMAIL` for frontend branding.
- **Configurable Legal Pages**: Terms of Service, Privacy Policy, and Data Deletion pages now use environment-configured contact emails.
- **Site Configuration Module**: New `client/src/config/site.ts` centralizes all frontend branding settings.

### 📚 Documentation Improvements
- **Environment Template**: Created `stack.env.example` with comprehensive documentation for all configuration options.
- **README Configuration Section**: Added detailed environment variable tables for branding, URLs, and CORS settings.
- **WordPress Plugin README**: New documentation covering installation, configuration, REST API endpoints, and troubleshooting.
- **Contributing Guide**: Updated with Redis requirement and Getting Started setup commands.

### 🔌 WordPress Plugin Enhancements
- **Removed Hardcoded Defaults**: API URL now requires explicit configuration (no fallback to external domains).
- **Server Tracking Improvements**: All endpoints use configured API URL instead of hardcoded values.

### ⚙️ Infrastructure
- **Elasticsearch 9.2.4**: Confirmed compatibility with fresh deployments.
- **Build Verification**: Full Docker build and deployment tested successfully.

---

## [2.2.0] - 2026-01-19

### 💬 Unified Chat & Inbox System
- **ChatWindow Component**: Full-featured chat interface with real-time message display, attachment support, and conversation management.
- **MessageBubble Component**: Email-style message rendering with quoted content detection, collapsible threads, and attachment pills.
- **Multi-Channel Composer**: Unified composition for chat, email, and SMS with "From" account selection.
- **File Attachments**: Drag-and-drop file uploads with XHR progress tracking and staged-upload model.
- **AI Draft Generation**: One-click AI-powered response drafts in the inbox composer.
- **Canned Responses**: Rich-text templates with editable labels for rapid agent replies.

### 🧾 Invoice Designer & Rendering
- **Drag-and-Drop Canvas**: Visual invoice builder with `react-grid-layout` for flexible component placement.
- **Dynamic Data Binding**: Template variables for order, customer, and line item data.
- **PDF Generation**: jsPDF-based renderer with synchronized preview-to-output layout.
- **Print Styling**: Clean print media queries for professional invoice output.

### 📧 Email Service Infrastructure
- **SchedulerService**: Orchestrates background tasks including IMAP polling, digest reports, and marketing automations.
- **EmailService**: Unified SMTP/IMAP handling with parallel polling and exponential backoff.
- **Unified Email Settings**: Consolidated SMTP/IMAP configuration into single account entries.
- **NewEmailModal**: Full composition modal with file attachments and rich text editing.

### 📱 PWA & Mobile Enhancements
- **MobileInventory Component**: Touch-optimized product management with search, low stock filtering, and list/grid views.
- **Avatar Upload**: Profile photo upload directly from mobile PWA.
- **Order Details (Mobile)**: Full order management parity between desktop and PWA.
- **Share Target Handling**: PWA can receive shared content from native apps.

### 🚀 Account Onboarding Wizard
- **Multi-Step Setup Flow**: Guided wizard for WooCommerce, tracking plugin, email, and ad account integration.
- **Demo Store Persistence**: Frictionless exploration mode before full account configuration.
- **Skip-Enabled Steps**: Each wizard step can be skipped for flexible onboarding.

### 🔔 Notification & Push System
- **Push Diagnostics Page**: Admin interface for subscription testing and notification debugging.
- **Account Isolation Fix**: Desktop notifications now correctly filtered by user's account ID.
- **10-Minute Auto-Dismiss**: Push notifications automatically clear after timeout.

### ⚡ Performance Optimizations
- **OrderSync OOM Resolution**: Batch processing prevents memory exhaustion during large syncs.
- **PicklistService N+1 Fix**: Bulk product/BOM fetching eliminates query explosion.
- **EmbeddingService Batching**: Aggregated API calls for vector embedding updates.
- **TrackingService Cleanup**: Non-blocking event loop for rate limit maintenance.
- **ProductSync Batch Delete**: Efficient reconciliation with `deleteMany` operations.
- **Customer Count Optimization**: Reduced DB calls during order count recalculation.
- **Variation Updates**: Parallelized product variation syncs in ProductsService.

### 🔒 Security & Stability
- **Customer Lookup Fix**: Blocked cross-account customer data access vulnerability.
- **Chat Widget Escaping**: Proper JS escaping prevents injection from user-provided content.
- **Inbox AI Policy Caching**: TTL-based caching with route-based invalidation.

### ✨ Additional Enhancements
- **BOM Self-Linking Prevention**: UI blocks circular BOM references with inventory route validation.
- **Gold Price Types**: Configurable precious metal pricing with margin settings.
- **Miscellaneous Costs Field**: Repeatable additional costs on products and variations.
- **Tax Inclusive Revenue**: Account-level setting for gross revenue reporting.
- **Payment Fees in Profitability**: Gateway fees now included in profit calculations.
- **Search Relevance Ranking**: Improved result ordering across all search UIs.
- **Ad Groups Fetching**: Real Google Ads Ad Group data retrieval for campaigns.
- **Sentry Integration**: Client-side error monitoring with automatic reporting.
- **Active Visitors Widget**: 24-hour visitor total displayed below real-time count.

### 🐛 Bug Fixes
- **Inbox Sidebar Timing**: Fixed conversation update time showing incorrect "distance to now".
- **Attachment Display**: Attachments render as pills instead of inline markdown.
- **Order Metadata Display**: Line breaks preserved and multi-image galleries rendered.
- **TypeScript Build Errors**: Resolved type mismatches in OrderSync, Sentry, and inbox components.
- **Vite React Resolution**: Fixed package resolution for React 19 compatibility.

### ⚙️ Infrastructure
- **Docker CI Enhancement**: Multi-service health verification in deployment pipeline.
- **Build Verification**: All services tested and healthy in Docker environment.

---

## [2.0.1] - 2026-01-17

### ✨ Enhancements
- **AI Co-Pilot Optimization**: Implemented 5-minute TTL localStorage caching to prevent redundant per-visit analysis.
- **Email Message Rendering**: Enhanced quote detection for Gmail, Outlook, and iOS Mail with collapsible "View more" for long threads.
- **Inbox Composer**: Added "From" dropdown for agents to select sending email account when replying.
- **Product Editor**: BOM products now correctly update Cost of Goods Sold (COGS) calculations.
- **Product History**: Edit history now correctly displays all changes including BOM and COGS modifications.

### 🐛 Bug Fixes
- **Analytics Date Range**: Fixed "yesterday" always appearing blank; default time period now correctly set to "today".
- **Auto-Reply Sender**: Auto-replies now send from the email account that received the original message.
- **Email Ingestion**: Improved IMAP reliability with parallel polling, batch limits, and exponential backoff.
- **Guest Order Linking**: Inbox now correctly links conversations to WooCommerce orders via billing email for guests.
- **Layout Containment**: Resolved fixed positioning conflicts on AI Co-Pilot page.
- **React Hook Errors**: Fixed "Invalid hook call" errors in FlowsPage and AdminDashboard components.

### ⚙️ Infrastructure
- **Docker GeoIP**: GeoIP databases now persisted across container rebuilds via named volume.
- **Build Fixes**: Resolved server-side Prisma type mismatches and client-side Vite build failures.
- **Tailwind CSS v4**: Fixed `@utility` naming convention errors for hover states.
- **Prisma Transactions**: Resolved timeout issues in CustomerSync with batch size optimization.

---

## [2.0.0] - 2026-01-14

### 🤖 AI Marketing Co-Pilot
- **Intelligent Ad Optimization**: Complete 6-phase AI advisor replacing traditional digital marketing agents.
  - Phase 1: Multi-Period Analysis (7d/30d/90d) with historical snapshots and statistical significance.
  - Phase 2: Cross-Channel Attribution with LTV-based optimization.
  - Phase 3: Funnel-Aware Recommendations with audience/geo/device analysis.
  - Phase 4: Marketing Knowledge Base with confidence scoring and explainability.
  - Phase 5: Recommendation tracking with feedback-based learning loop.
  - Phase 6: Proactive Alert System for critical performance regressions.
- **Cross-Platform Comparison**: Unified insights across Google Ads and Meta Ads campaigns.
- **Stock-Aware Optimization**: Automatically excludes out-of-stock items from ad suggestions.

### 📊 Proactive Business Intelligence
- **Email Digests**: Automated Daily/Weekly stakeholder summaries via `DigestReportService`.
  - Core metrics: Revenue, Order Count, AOV, New Customers with period-over-period change detection.
  - Top 5 traffic sources and Top 5 products by quantity sold.
  - Color-coded trend indicators (Green ↑ / Red ↓).
- **Customer Cohort Analysis**: Order-based behavioral segmentation via `CustomerCohortService`.
  - Retention cohorts (monthly repeat purchase rates over 12-month horizon).
  - Acquisition source cohorts (Google Ads, Meta, Organic retention comparison).
  - Product-based cohorts (retention by first product category purchased).
- **Product Performance Ranking**: High-velocity benchmarking via `ProductRankingService`.
  - Top/Bottom performers with multi-period trends (7d/30d/90d/YTD).
  - Profit margin visibility using COGS subtraction.
  - Revenue, Units Sold, and Order Count rankings.

### 📱 Mobile & PWA Enhancements
- **Order Attribution**: Marketing attribution visible in desktop order list, order detail, and PWA.
- **Tag Management**: Operational tags can be added/removed directly from PWA order detail.
- **Customer Navigation**: Fixed mobile customer profile dead-end with proper order data display.
- **Activity Timeline**: Visit-based activity timeline for visitor profiles on mobile.

### 💬 Unified Inbox Suite
- **Rich Text Canned Responses**: Full rich text support matching inbox composer capabilities.
- **Canned Response Labels**: Editable/deletable labels replacing static categories.
- **Conversation Search**: Backend search by message content, customer name, and email.
- **Multi-Select Merge**: Safe protocol for merging conversations with multi-channel recipient display.
- **Interaction History**: Clickable timeline linking to past conversation threads.

### 🔔 Notification Engine
- **Centralized Alerting**: Event-driven `NotificationEngine.ts` decouples business logic from delivery.
- **Diagnostic Logging**: `NotificationDelivery` model provides 100% observability of all alerts.
- **Multi-Channel Support**: Unified handling for In-App, Web Push (VAPID), and Socket.IO protocols.

### ⚙️ Infrastructure Modernization
- **Prisma 7**: Migrated to Driver Adapter pattern with native PostgreSQL connections.
- **Elasticsearch 9.2**: Upgraded with refactored API calls (removed deprecated `body` wrapper).
- **Tailwind CSS v4**: Migrated to Oxide engine with CSS-first `@import` syntax.
- **ESLint 9**: Flat config migration with TypeScript-ESLint 8.
- **TypeScript 5.8**: Upgraded client workspace for modern type-checking.
- **Dependency Cleanup**: Removed `lodash`, `axios`, and `multer` in favor of native solutions.
- **Log Hygiene**: Standardized Pino 10 JSON output with consistent formatting.
- **Connection Pool**: 50-connection pool optimized for high-concurrency multi-account syncs.

### 🐛 Bug Fixes
- **Revenue Widget**: Fixed timezone issue causing incorrect "today's" revenue calculation.
- **Search Relevance**: Improved product search ranking for more relevant results.
- **Transaction Timeouts**: Resolved Prisma transaction timeouts with batch size optimization (25 items).
- **Visitor Ordering**: Corrected visit order display in visitor profile modal.

---

## [1.1.0] - 2026-01-07

### 🤖 AI Intelligence
- **AI Chat Assistant**: Data-aware chatbot that can query WooCommerce orders, products, and advertising metrics.
- **AI Product Rewriting**: One-click AI-powered product description generation on the product edit page.
- **AI Prompts Management**: Super Admin page for configuring and managing global AI prompt templates.
- **Multi-Model Support**: Integration with OpenRouter API supporting GPT-4, Claude, and other models.

### 📣 Google Ads Integration
- **OAuth Connection**: Securely link Google Ads accounts with proper redirect handling.
- **Campaign Monitoring**: Track spend, impressions, clicks, conversions, and CTR.
- **ROAS Tracking**: Automatic Return on Ad Spend calculations with `action_values` parsing.
- **Shopping Campaign Context**: Associate products with active Google Shopping campaigns.
- **AI-Powered Insights**: Query ad performance data through the AI assistant.

### ✨ Enhancements
- **Product Edit Page**:
  - Added **Sales History** tab showing all orders containing the product.
  - Added **SEO/Merchant Center score tooltips** with actionable improvement hints on hover.
  - Added **WooCommerce categories, tags, and inventory status** display.
  - Added **Sync Settings button** for manual measurement unit refresh.
- **Email Designer**: Fullscreen editing mode for distraction-free template design.
- **Platform SMTP**: Super Admin configurable system-wide SMTP settings with connection testing.
- **Super Admin Panel**:
  - Added **Credentials page** with tab-based interface for platform integrations.
  - Improved **account management** with robust error handling and deletion support.

### 🐛 Bug Fixes
- **Setup Wizard**: Fixed flash issue causing demo account creation on hard refresh while logged in.
- **Admin API**: Resolved 500 errors on `/api/admin/stats`, `/api/accounts`, and account endpoints.
- **Bull Dashboard**: Fixed continuous "Loading" state issue.
- **Email Inbox**: Improved IMAP connection handling and error logging.

### ⚙️ Infrastructure
- Refactored large files (`TrackingService.ts`, `ads.ts`, `ProductEditPage.tsx`) for improved maintainability.
- Added production logging standards replacing `console.log` with dedicated logger.

## [1.0.0] - 2026-01-06

### 🚀 Major Features
- **Analytics & Intelligence Suite**: Introduced a comprehensive analytics engine including:
  - Real-time **Visitor Logs** for tracking user sessions.
  - Granular **E-commerce Tracking** (Add to Cart, Checkout Start, Purchase events).
  - **Search Term Analysis** to understand customer intent.
- **Report Builder V2**: A complete redesign of the reporting interface.
  - New **Master-Detail Layout** for easier navigation.
  - **Premade Reports Tab** for quick access to common metrics.
  - Refactored architecture with a dedicated service layer for improved performance.
- **Visual Invoice Designer**: 
  - Drag-and-drop interface for customizing invoice layouts.
  - Built with `react-grid-layout` for flexible design capabilities.
- **Command Palette**: Fully functional global search for Products and Orders, accessible via keyboard shortcuts.
- **Integrated Help Center**: In-app documentation covering Getting Started, Product Management, and more.

### ✨ Enhancements
- **Product Edit Page**: 
  - Added a **Code Editor** toggle for advanced product description editing.
  - Revamped **SEO Health** panel with a visual score progress bar and actionable improvement hints.
- **Inventory & Orders**:
  - **Picklist Generation** is now integrated directly into the Orders List.
  - added support for generating and downloading Picklists as PDFs.
- **UI/UX Polish**:
  - Implemented a modern **Glassmorphism** design language across the application.
  - Added a **Sync Status Indicator** in the sidebar for real-time connection monitoring.
  - Improved z-index management for the Notifications panel.

### 🐛 Bug Fixes
- **Deployment**: Resolved `No such image: overseek-api:latest` errors during Portainer stack deployment.
- **Reporting**: Fixed an aggregation bug in "Product Performance" reports where quantities were incorrectly reporting as zero.
- **Build System**: Resolved Vite import errors with `react-grid-layout` (WidthProvider/Responsive types).
- **Stability**: Fixed `ReferenceError` crashes in the Product Edit page and ensured consistent component loading.

### ⚙️ Infrastructure
- Established initial V1.0.0 release baseline.
- Standardized `docker-compose` configuration for production deployments.
