# Companion 2.25.10 and workflow repair

Prepared locally on 2026-10-23. No live update-feed publication, production
deployment, commit or push was performed.

## Changes and installation safety

- Update the native receipt test baseline for the three nullable embedding
  provenance columns already present in the application migration. Production
  migration files are unchanged. A native PostgreSQL regression applies the real
  migration to an existing product and verifies unknown provenance stays null
  while identity and source stock data remain unchanged.
- Ship the existing paid-order purchase checks in a new companion patch version,
  rather than changing the immutable 2.25.9 release bytes.
- Normalize the delivery-cache read query's ASCII identity/hash columns to an
  explicit UTF-8 binary collation before combining them with store postmeta.
  This fixes mixed-collation UNION failures, reproduced on MariaDB. It is a
  read-only query change, not a table conversion or stock/settings migration.
- Fix the native coexistence test to actually deactivate/reactivate the old
  plugin fixture before asserting environment invalidation. An already-active
  plugin's activation is correctly a no-op; production admission remains intact.
- Add an in-place 2.25.9-to-current upgrade regression on both WordPress matrix
  entries. The old ZIP comes from commit
  `683d9677c89070c2b571c91ded0820fce004a34e` and is checked against its immutable
  checksum before installation. Settings, activation, automatic-update
  preferences, product stock and existing purchase metadata must survive.
- Validate release packaging before the API image is published. Also verify
  client/server release pins agree, and run compatibility CI when client pins
  change. Existing validation and zero-skip requirements are not relaxed.

## Source-verified application artifact

- Version: **2.25.10**; 227 runtime files; 1,127,627 bytes.
- ZIP: `server/uploads/plugins/overseek-wc-plugin.zip`.
- ZIP SHA-256: `3249b4330ee0c93d0be4f8ff7513f6a97a80830ce5a18ad951065969f9514e42`.
- Manifest SHA-256: `82785ace7025034a3007decacdfe0927a73e2aa5e0482ef0af78caaa74b3456a`.
- Installer pins and `client/src/utils/pluginRelease.ts` identify these exact
  bytes. Native validation used this packaged plugin, not a source symlink.

## Local validation

- PostgreSQL 17.11 and 18.6: all **501** delivery tests passed on each; zero skips;
  the workflow's JSON-result assertions also passed.
- All **15** package/publication/download tests passed, including stale persistent
  volumes, partial previous installs, unchanged restarts, tampered packages and
  symlink rejection. All packaged PHP files passed PHP 8.4 syntax checks.
- Standalone purchase-link, paid-order retry/deduplication, delivery, storefront,
  cart-display and supported WooCommerce quote-version scripts passed.
- WordPress **7.0** and **7.1.1**, WooCommerce **11.1.1**, WBS **6.18.0**, PHP
  **8.4.26**, MariaDB **11.8.6**: native aggregates passed with **295** parent
  assertions each, all 43 subprocess runs passing, 80 saved classic/Blocks
  snapshots round-tripped through shared core per WordPress version, and no
  fixture cleanup errors. Both in-place upgrades preserved existing data.
- Backend typecheck and client lint/build passed. Client lint has pre-existing
  warnings; no lint errors. GitHub's exact MySQL 8.4 runner remains a post-push
  verification; local native WordPress validation used MariaDB, not MySQL 8.4.

## Rollout

1. Commit/push the changes and require fresh green GitHub workflow results.
2. Deploy matching API and web images so the application download and its client
   checksum pin change together. Refresh an older cached client before using
   the new download; its prior checksum correctly rejects different bytes.
3. Update the companion in place, without uninstalling. No database reset,
   settings deletion or stock rewrite is required. Existing delivery estimates
   retain the intentional version/environment readiness revalidation behavior.
4. Publish 2.25.10 separately through the existing update-site process if automatic
   WordPress updates are desired. Retain older versioned ZIPs and replace feed
   metadata last. This repository change does not publish the live SLDevs feed.
