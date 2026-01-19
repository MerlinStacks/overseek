# Future Work & Roadmap

This document tracks planned enhancements, known bugs, and future feature ideas for the OverSeek platform.

---

## Implemented

- [x] **UI Overhaul 2026** — Premium Glassmorphism Redesign (Jan 2026)
  - Comprehensive design system update with `index.css` (variables, gradients, animations)
  - Upgraded Core UI: `Card`, `Modal`, `Tabs`, `CommandPalette`, `ThemeToggle`, `Skeleton`
  - Premium redesign of `LoginPage`, `SettingsPage`, and `DashboardPage`
  - Complete "Glassmorphism" styling for all major widgets: `StatusCenter`, `SalesChart`, `VisitorCount`, etc.
  - Full Dark Mode optimization across all updated components

- [x] **Unified Status Center Panel** — Single dashboard for monitoring all system health
  - Sync status and failure rates
  - Webhook delivery health
  - WooCommerce store connectivity
  - Revenue anomaly alerts
  - Dashboard widget + Settings panel integration

- [x] **Saved Views System** — Filter presets for high-traffic screens (Jan 2026)
  - Persistent saved filter views in Orders and Customers pages
  - Zustand store with localStorage persistence (account-scoped)
  - SavedViewsDropdown component for quick view management

- [x] **Skeleton Loaders** — Improved perceived performance (Jan 2026)
  - TableSkeleton, SkeletonAvatar, SkeletonText variants
  - Replaced spinner loading states in data tables

- [x] **Standardized Empty States** — Guided actions for empty screens
  - EmptyState component with contextual actions
  - Clear filter buttons, sync prompts, and examples

- [x] **Dark Mode Toggle** — User-controlled theme switching (Jan 2026)
  - ThemeContext with localStorage persistence
  - Light/Dark/System preference options
  - Animated toggle with Sun/Moon icons
  - CSS variables for consistent theming across all components

- [x] **Code Deduplication Refactoring** — Centralized utilities (Jan 2026)
  - Unified `utils/format.ts` with formatCurrency, formatNumber, formatCompact, formatPercent, formatDateTime variants
  - `utils/orderStatus.ts` for order status configuration (icons, colors, labels, next status, badge classes)
  - `utils/string.ts` for getInitials, truncate, capitalize, toTitleCase, slugify utilities
  - `utils/conversationStatus.ts` for chat conversation status/priority colors
  - Updated 35+ files: Mobile pages, desktop pages, widgets, analytics, settings, chat components
  - Removed ~300 lines of duplicate formatting/utility code
  - Consistent currency formatting with dynamic account currency support
  - Eliminated all local getInitials, formatDate, getStatusBadge implementations

- [x] **Team & Permissions Management** — Full user/role management (Jan 2026)
  - Edit team member roles (ADMIN/STAFF/VIEWER) inline in Team Settings
  - Assign custom AccountRoles to STAFF members for granular permissions
  - Added "Roles" tab in Settings with RoleManager for creating/editing custom roles
  - Backend PATCH endpoint for updating user role and permissions `/api/accounts/:id/users/:userId`
  - Permission hierarchy: OWNER > ADMIN > Custom Role + User overrides

---

## Planned

### Marketplace Sync
- [ ] **Amazon/eBay Inventory Sync**
  - Two-way stock sync
  - Order import from marketplaces
  - Unified product catalog

---

### Shipping & Logistics

- [ ] **Auspost Carrier Integration**
  - Live tracking integration in order detail
  - Shipping label generation from dashboard
  - Delivery exception alerts (notify on delays)
  - Rate lookup and comparison

---

### PWA Enhancements



---

### AI & Intelligence

---

### Customer Intelligence

- [ ] **RFM Segmentation** — Recency, Frequency, Monetary scoring (industry standard)
- [ ] **Behavioral Segments** — Cart abandoners, Browse-no-purchase, One-time vs Repeat
- [ ] **Predictive Churn Scoring** — Identify at-risk customers before they leave
- [ ] **Customer Health Score** — Composite metric from engagement, purchase frequency, support
- [ ] **VIP Detection** — Auto-flag high-value customers for priority treatment

---

### Marketing

- [ ] **SMS Marketing Campaigns** — Marketing SMS alongside email broadcasts
  - SMS automation triggers (abandoned cart, post-purchase)
  - Two-way SMS conversations in inbox
  - Subscriber opt-in/opt-out compliance
  
- [ ] **Email A/B Testing** — Subject line and content testing
- [ ] **Send Time Optimization** — AI-powered optimal send time per recipient
- [ ] **Dynamic Email Content** — Personalized product recommendations in emails

---

### PWA App

- [ ] In the meta data on the desktop version and pwa we need it to be the correct letter casing, if Woocommerce shows lowercase, we need lowercase and if uppercase we need uppercase.

---

### Quick Wins

- [ ] Email open/click tracking visualization
- [ ] Bulk order status update
- [ ] Order timeline (events log)
- [ ] Export customer segments to CSV


---

### Fixes & Stabilization

- [x] **Standardize X-Account-ID API Calls** — useApi hook with centralized headers (Jan 2026)
- [x] **Friendly Error Messages** — Client error utilities with friendly message mapping (Jan 2026)
- [x] **System Health Diagnostics Page** — Enhanced with services, queues, sync, webhooks (Jan 2026)

---

### Data Quality & Resilience

- [x] **Sync Health Timeline** — Tracked via SyncLog + /admin/sync-status endpoint
- [x] **Automatic Backfill** — Handled by SchedulerService scheduled jobs
- [x] **Schema Audit** — ValidationError class in errors.ts taxonomy

---

### Core UX Clarity

- [x] **Unified Status Center Panel** — Sync, Webhooks, Store Health, Revenue Alerts
- [x] **Standardized Empty States** — Guided actions and examples
- [x] **Saved Views System** — Rapid filters in high-traffic screens (Orders, Customers)