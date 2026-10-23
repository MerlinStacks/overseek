# Woo variation images and blocked BOM scheduling

Follow-up to the extended log from the same `2026-10-23T02:23:33Z` boot. The old PostgreSQL warning and BOM message do not by themselves demonstrate deployment of the subsequent [pg/lock follow-up](pg-transaction-and-bom-lock-followup-2026-10-23.md); that failed-job message lacks its execution-origin/renewal fields.

## Fixed locally

### Valid no-image variations were being quarantined

WooCommerce can return `image: null` for a variation without a dedicated image. `WooProductVariationSchema` accepted only an object or an omitted field, rejecting otherwise valid variations.

The variation image field now explicitly accepts null. The sync keeps `rawData.image: null` and stores an empty dedicated-image array, allowing existing parent-image fallback rather than inventing an image. Malformed non-null image objects, invalid variation IDs and invalid parent gallery entries still fail validation. Local COGS/override ownership is unchanged.

Regression tests exercise all **78** variations across the five parent-product patterns in the supplied log, plus null/missing/valid/malformed image schema cases. No invalid-payload warning is suppressed to make the test pass.

### A blocked BOM repeatedly failed the entire dispatch pass

The scheduler previously dispatched healthy entity queues and BOM as one call. The retained failed BOM job then threw before schedule timestamps were advanced. Subsequent fast/full ticks repeated the due pass and the same error.

Changes:

- Dispatch/checkpoint healthy entity queues independently of BOM admission.
- Treat `BOM_SYNC_RECONCILIATION_REQUIRED` as an explicit blocked BOM recheck, leaving its failed job and progress intact.
- Move the next BOM check to its configured interval without setting `lastScheduledAt`: no BOM job was dispatched successfully.
- Warn only after an account/snapshot/interval-conditional schedule update succeeds. Another process advancing or editing the row prevents a duplicate warning or stale overwrite.
- Coalesce overlapping fast/full passes in one process.
- Check backlog only in requested queues, so unrelated BOM backlog cannot block order-only admission.
- Unexpected queue errors still surface as errors and do not falsely advance the BOM schedule.

This removes the repeated whole-account dispatch failure; it does **not** reconcile or replay the failed stock-sync occurrence.

## Existing data recovery after deployment

The product-sync checkpoint was allowed to advance with quarantined variations. A normal incremental sync may therefore not revisit an unchanged parent automatically.

In account `17fed050-e5ca-4b90-8ce4-5b975cd90b4a`, deliberately refresh these five products from Woo after deploying the fix:

- `93754` — 26 affected variations
- `93930` — 12
- `93943` — 12
- `71343` — 2
- `93902` — 26

Use the existing account-scoped product refresh flow (`POST /api/products/:wooId/sync`) or an explicitly reviewed full product sync. This is not permission to replay BOM stock writes. No production refresh, API call, job deletion, stock update or deployment was performed here.

The blocked BOM in account `a03315be-5bf4-47fa-bc5f-e8e5df59e8d5` still requires the previously documented stock/worker/history review. Do not delete it just to silence the scheduler.

## Verification

- Targeted schema/product-sync/scheduler/dispatch tests: **36 passed**.
- Targeted server lint passed.
- No schema migration is introduced.
- Final shared-checkout server suite: **421 files / 3,850 tests passed; 14 files / 132 tests skipped**.
- Final server production build/typecheck passed. An initial global typecheck hit an unrelated concurrent `ChatSettingsStore.ts` edit; that work was left untouched and the final build passed after it changed independently.
- Later heap samples decrease from 423.4 to 185.6 MiB (3% of the heap limit). This is reassuring, not a certification that every memory path is leak-free.
