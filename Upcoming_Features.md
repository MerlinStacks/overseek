# Roadmap & Features

## Completed
- [x] **Speed up searching**: Implemented Postgres Trigram (GIN) Indices for instant fuzzy search. This achieves "Elasticsearch-like" performance for the catalog without the heavy infrastructure overhead.
- [x] **Rebuild sync engine**: Migrated to a "Thin Client" architecture. Products are now archived in Postgres (via Passive Proxy Sync) and fetched via API, significantly reducing Browser Memory usage.
- [x] **Speed up the sync process**: Optimized with parallel worker threads and passive archival.
- [x] **Refine Analytics Validation**: Display 'No prev data' instead of misleading 0%/100% when no historical data exists.

## Planned
- [ ] Full Data Export feature
- [ ] Ad revenue tracking [Meta Ads, Google Ads]
- [ ] Integrate emails into the inbox
- [ ] Improve WooCommerce plugin: Include Live Chat features with UI editor.


The reviews are not syncing.

Dark/Light mode don't really change everything including the side bar.

Make the BOM feature a feature that we need to enable per account in the admin panel
