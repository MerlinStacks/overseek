# Changelog

All notable changes to this project will be documented in this file.

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
