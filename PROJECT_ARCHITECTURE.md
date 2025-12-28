# WooDash Project Architecture Documentation

## 1. Project Overview

**WooDash** is a high-performance, local-first dashboard for WooCommerce. It is designed to provide store owners with a lightning-fast interface for managing products, orders, and customers, bypassing the often slow WordPress admin panel.

### Core Principles
- **Local-First:** Data is synchronized from WooCommerce to a local IndexedDB (via Dexie.js). The UI reads primarily from this local database, ensuring instant load times.
- **No Middleman Server:** The application connects directly from the user's browser to their WooCommerce API. No data passes through a third-party server.
- **Privacy & Security:** API keys are stored in `localStorage`. Sensitive operations run within the browser sandbox.
- **Multi-Tenancy:** Supports managing multiple WooCommerce stores (Accounts) from a single interface.

### Technology Stack
- **Frontend Framework:** React.js (Vite)
- **Local Database:** Dexie.js (Wrapper for IndexedDB)
- **State Management:** React Context API (`SyncContext`, `SettingsContext`, `AuthContext`, `AccountContext`)
- **API Interaction:** `@woocommerce/woocommerce-rest-api` (Client-side)
- **UI Components:** Glassmorphism design, Lucide React icons, Sonner (Toasts), Recharts (Analytics).
- **CSS:** Vanilla CSS with scoped variables and utility classes.

---

## 2. Directory Structure

```
src/
├── assets/          # Static assets
├── components/      # Reusable UI components (Sidebar, AIChat, etc.)
├── context/         # React Context Providers (Global State)
├── db/              # Database Schema and configuration
├── hooks/           # Custom React Hooks
├── layouts/         # Page layouts (DashboardLayout)
├── pages/           # Main route views
├── services/        # Business logic and external API handling
├── App.jsx          # Main Router and App entry point
└── main.jsx         # React DOM root
```

---

## 3. Core Modules & Architecture

### 3.1. Local Database (`src/db/db.js`)
The application uses **Dexie.js** to manage an IndexedDB database named `WooDashDB`.
- **Schema Versioning:** The schema evolves using version numbers.
    - **v20:** Introduced Multi-tenancy. Tables like `products`, `orders` were migrated to `products_v2` etc., with Compound Primary Keys `[account_id+id]`.
    - **v21:** Added Live Chat / CRM tables (`contacts`, `conversations`, `messages`).
- **Data Access:** All React components use `useLiveQuery` to reactively fetch data from `db`.

### 3.2. Synchronization Engine (`src/services/sync.js` & `src/context/SyncContext.jsx`)
- **Logic:** The `sync.js` service handles fetching data from WooCommerce in batches.
- **Delta Sync:** It compares `date_modified` timestamps to only fetch updated records.
- **Flow:** `API -> Transform -> BulkPut (IndexedDB)`.
- **Context:** `SyncContext` manages the global sync state (`idle`, `syncing`, `error`), progress bars, and auto-sync intervals.

### 3.3. Authentication & Security (`src/context/AuthContext.jsx`)
- **Session:** Uses a local `dashboard_users` table to manage app-specific users.
- **Encryption:** Passwords are hashed using `bcryptjs`.
- **Permissions:** Role-based access control (Admin, Manager, etc.) determines feature visibility.
- **API Keys:** WooCommerce Consumer Key/Secret are stored in `db.settings` or `localStorage`, never exposed.

### 3.4. Multi-Tenancy (`src/context/AccountContext.jsx`)
- **Accounts:** The `accounts` table stores store credentials (Name, Domain).
- **Context:** `AccountContext` provides the `activeAccount` object.
- **Isolation:** Data queries often filter by `account_id` or use compound keys to ensure data isolation between stores.

---

## 4. File-by-File Documentation

### Data Layer (`src/db/`)
- **`db.js`**: Defines the Dexie database instance. Contains the `stores` schema definition and helper methods for setting/getting key-value settings.

### Services (`src/services/`)
- **`api.js`**: Wrapper for WooCommerce REST API. Handles authentication injection and standardizes responses. Includes `batchProducts` for bulk updates.
- **`sync.js`**: "The Brain" of the offline mode. Contains specific functions (`syncProducts`, `syncOrders`) to pull data from API and save to DB. Handles pagination and error retries.
- **`backupService.js`**: Provides functions to `exportDatabase` (dump specific tables to JSON) and `importDatabase` (restore from JSON).

### Context Providers (`src/context/`)
- **`SettingsContext.jsx`**: Exposes application settings (Currency, Timezone, AI Keys) to the entire app.
- **`SyncContext.jsx`**: Controls the synchronization lifecycle. Provides `syncStatus` and `runFullSync` methods.
- **`AuthContext.jsx`**: Manages the currently logged-in dashboard user (`dashboard_users` table). Handles Login/Logout and Permission checks.
- **`AccountContext.jsx`**: Manages the list of WooCommerce stores connected. Handles switching the `activeAccount` which triggers UI updates.

### Layouts (`src/layouts/`)
- **`DashboardLayout.jsx`**: The main scaffolding. Includes:
    - **`Sidebar`**: Navigation menu.
    - **`TopBar`**: Contains `GlobalSearch`, `ThemeToggle`, `TodoPanel`, and `Notifications`.
    - **`SyncOverlay`**: Visual indicator when sync is in progress.

### Pages (`src/pages/`)
- **`DashboardHome.jsx`**: Landing page. Displays Widgets (Sales, Visitors), Real-time charts, and Activity Feeds.
- **`Orders.jsx`**: List view of orders. Features:
    - Advanced Filtering (Segment Builder).
    - Batch Pick List Generation (PDF).
    - CSV Export.
- **`Products.jsx`**: Inventory grid. Features:
    - Bulk Actions (Stock status, Delete).
    - Custom Tagging System.
    - `useSortableData` for column sorting.
- **`Inventory.jsx`**: Specialized view for "Recipes" (Composite Products).
    - Allows defining Bundles (1 Box = 3 Items).
    - Calculates "Potential Stock" based on component availability.
- **`Reports.jsx`**: Analytics hub.
    - PDF/CSV Report Generation.
    - "Digests": Scheduling automated email/slack reports (Simulated).
    - Custom Report Builder.
- **`Inbox.jsx`**: CRM & Live Chat interface.
    - 3-Pane Layout: Contacts List -> Chat -> User Profile.
    - MagicMap: Visualization of customer location.
- **`Settings.jsx`**: Configuration.
    - Tabs: General, Connection, Sync, AI, SMTP, Danger Zone.
    - Backup & Restore interface.
- **`Help.jsx`**: Internal Documentation.
    - Architecture docs, User guides.

### Hooks (`src/hooks/`)
- **`useStats.js`**: Aggregates general store stats (Revenue, Orders count) from DB.
- **`useProductStats.js`**: Advanced product analytics (Top Sellers, Margins, Dead Stock).
- **`useSortableData.js`**: Generic hook for table sorting logic (Text, Dates, Numbers).

### Components (`src/components/`)
- **`AIChat.jsx`**: Floating Chatbot.
    - Uses OpenRouter API.
    - Context-aware: Feeds summaries of store data (Revenue, Low Stock) to the LLM for accurate answers.
    - Navigation: Can redirect users to pages via natural language prompts.

---

## 5. Future Roadmap & Improvements
Based on code analysis:
1.  **AI Implementation:** Move from direct API calls in `AIChat` to a more structured "Agent" system that can perform actions (e.g., "Create a coupon").
2.  **Live Chat Real-time:** Implement actual WebSocket or polling mechanism for the `Inbox` (currently has simulated elements).
3.  **Role Granularity:** Expand `AuthContext` to support granular permission editing in the UI.
4.  **Testing:** Add unit tests for critical paths (`sync.js`, `calculatePotentialStock`).
