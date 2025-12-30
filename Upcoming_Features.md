# Roadmap & Features

## Completed
- [x] **Speed up searching**: Implemented Postgres Trigram (GIN) Indices for instant fuzzy search. This achieves "Elasticsearch-like" performance for the catalog without the heavy infrastructure overhead.
- [x] **Rebuild sync engine**: Migrated to a "Thin Client" architecture. Products are now archived in Postgres (via Passive Proxy Sync) and fetched via API, significantly reducing Browser Memory usage.
- [x] **Speed up the sync process**: Optimized with parallel worker threads and passive archival.
- [x] **Refine Analytics Validation**: Display 'No prev data' instead of misleading 0%/100% when no historical data exists.
- [x] **Fix Reviews Sync**: Resolved syntax errors in the worker preventing reviews from syncing and indexing correctly.
- [x] **Fix Sidebar Dark/Light Mode**: Sidebar logo is now visible in Light Mode via dynamic CSS variables.
- [x] **BOM Feature Flag**: Implemented account-specific feature toggles. The BOM (Bill of Materials) view is now hidden unless enabled in the Admin Panel per tenant.
- [x] **Refactored Overseek Helper**: Converted legacy PHP plugin to modern Class-based architecture with optimized performance.
- [x] **Server Security**: Added Helmet (Headers), Compression (Gzip), and Morgan (Logging) to Node.js server.
- [x] **Frontend Performance**: Implemented Route-based Code Splitting (React.lazy) to reduce initial bundle size.
- [x] **Testing Infrastructure**: Setup Playwright for End-to-End testing and Husky/Lint-Staged for pre-commit quality checks.

## Planned
- [ ] Full Data Export feature
- [ ] Ad revenue tracking [Meta Ads, Google Ads]
- [ ] Integrate emails into the inbox
- [ ] Improve WooCommerce plugin: Include Live Chat features with UI editor.
