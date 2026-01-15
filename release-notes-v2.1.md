# 🚀 Overseek v2.1 — Shiny Fixes & Making Moves

**Release Date:** January 14, 2026

---

## ✨ What's New

### 🔮 Predictive Inventory Forecasting
Say goodbye to stockouts before they happen! Our new AI-powered inventory forecasting system uses historical sales data, seasonality detection, and market trends to predict demand at the SKU level.

- **Ensemble Demand Prediction** — Multiple ML models working together for accurate forecasting
- **Seasonality Detection** — Automatically identifies weekly, monthly, and yearly sales patterns
- **Lead-Time Aware Alerts** — Proactive stockout warnings based on supplier delivery times
- **Integrated Notifications** — Stockout alerts flow through the centralized Notification Engine

### 🛡️ Role-Based Access Control (RBAC)
Fine-grained permissions are here! Control exactly who can access what across your team.

- **Custom Roles** — Define roles with granular permission sets
- **Permission Matrix** — Admin, Manager, Staff role templates out of the box
- **Secure by Default** — All routes protected with role verification

### 📱 Sidebar Navigation Audit
We audited and updated the sidebar to ensure all new features are easily discoverable:

- All Jan 2026 features now accessible from navigation
- Inventory Forecast page added to sidebar
- Cleaner organization of feature groups

---

## 🔧 Bug Fixes & Improvements

### 🔐 Meta Token Expiration Fix
**Critical Fix:** Meta Ads and Inbox tokens were expiring after 24 hours instead of 60 days.

- Implemented proper long-lived token exchange protocol
- Added token expiration tracking and automatic refresh
- Enhanced debug logging for Meta API calls
- Credentials now cached for 5 minutes to reduce API overhead

### 💬 Live Chat Improvements
- Enhanced WooCommerce integration for seamless customer context
- Business hours now dictate auto-reply behavior
- Emails route to agents when business is closed

### 📊 Reporting & Analytics
- **Metadata Casing** — Desktop and PWA now preserve exact letter casing from WooCommerce
- **Visitor Profile** — Fixed incorrect visit ordering in visitor timeline
- **Search Relevance** — Tuned search scoring so "Golf Bangle" ranks above "9ct Bangles"

### 📦 Product & Order Fixes
- **Product Variants** — Weights and measurements now display correctly for variants
- **Sales History** — Total order amount now shows properly in sales history
- **Order Attribution** — Attribution data visible in order list, detail pages, and PWA

### 💼 Inbox Enhancements
- **Multi-Select Conversations** — Merge multiple conversations with unified recipient display
- **Interaction History** — Navigate to all previous customer conversations from sidebar widget
- **Canned Responses** — Rich text support + editable labels replacing static categories

---

## 🧹 Housekeeping

### Code Quality
- Comprehensive senior dev code review of AI Marketing Co-Pilot
- Removed test logs, debug files, and temporary artifacts
- Pushed all Notification Engine updates to GitHub

### Documentation
- Updated CHANGELOG.md with full v2.0.0 feature list
- Enhanced README with Meta Ads, AI Co-Pilot, and BI sections
- New Help Center articles for AI & Marketing Intelligence

---

## 📋 Technical Notes

- **Build Status:** ✅ Client & Server compile cleanly
- **Dependencies:** All up to date
- **Database:** Schema migrations applied successfully

---

## 🎯 What's Next

Check out our [Future Work roadmap](./Future%20Work.md) for upcoming features including:
- Amazon/eBay Marketplace Sync
- Auspost Carrier Integration
- SMS Marketing Campaigns
- RFM Customer Segmentation
- Predictive Churn Scoring

---

**Full Changelog:** [v2.0.0...v2.1.0](https://github.com/MerlinStacks/overseek/compare/v2.0.0...v2.1.0)
