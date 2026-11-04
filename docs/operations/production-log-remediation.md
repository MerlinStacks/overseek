# Production log fixes and safe rollout

## Compatibility

These fixes add no schema migrations, dependencies, required environment variables,
new backup version, or changed route response shapes. Existing unrelated checkout
changes are outside this patch's rollout guarantees. No production data, credentials,
stock, queues or deployment were changed as part of validation.

- Scheduled backups and `POST /admin/accounts/:accountId/backup/save` now stream
  database pages through gzip inside the same repeatable-read transaction. The
  version `1.0` JSON envelope, secret masking, table ordering, nested relations,
  stored metadata and download format remain compatible. Temporary files are
  removed on failure; publication waits for the DB snapshot transaction to commit.
  Retention runs only after successful publication. The occurrence claim still
  prevents immediate repeated scheduled attempts on failure.
- `generateBackup`, `saveBackupToStorage`, and the direct JSON download route remain
  available unchanged. The materialized download retains its 100 MiB safety limit;
  use **Save backup**, then download the stored gzip, for larger exports. Streaming
  exports have a 1 GiB uncompressed budget and the existing 120-second transaction
  timeout. Reads remain bounded by parent pages, not by nested relation size. These
  account exports are not a replacement for database backups: existing restore
  limitations (including products/customers) remain unchanged.
- GoldAPI keeps `GOLD_API_KEY` and existing ounce-to-gram/margin behavior. Public
  pricing still works without credentials when the provider permits access.
  Optional `METALS_API_KEY` enables the metals.dev fallback (requested in grams).
  No demo-key request is sent. Provider calls have a 10-second timeout; non-finite,
  zero or negative prices do not overwrite cached prices. Stale-price warnings
  remain; a credential problem cannot be fixed by silently inventing a price.
- Pinterest event generation, event IDs, timestamps, stored responses and historical
  retry payloads are unchanged. HTTP 400/422 failures get the existing
  `NON_RETRYABLE:` marker to stop scheduled unchanged-payload replays. A legacy
  failure may be retried once more before receiving that marker. Network failures,
  rate limits, server errors and credential failures retain their retry behavior.
  Logs now identify the delivery/event without dumping customer/provider payloads.
- Order-sync summaries distinguish intentional excluded statuses from schema
  failures. Invalid orders still warn, with bounded field paths and error codes
  instead of customer values. Validation failures still suppress destructive
  full-sync reconciliation. No status whitelist was broadened and no skipped
  order is fabricated or imported to make the counters green.
- Only the obsolete `experiment-significance-check` name is added to the existing
  deprecated repeatable-schedule cleanup and no-op dispatch. Unknown names still
  warn. The actual cleanup executes when the updated scheduler starts; it was not
  run against production during development.
- Routine memory snapshots default to info; existing
  `MEMORY_MONITOR_LOG_LEVEL=warn` is still honored. High-heap and sustained-growth
  warnings/alerts remain. Routine PDFKit selection is info and A4 layout details
  are debug; renderer selection, invoice bytes and canonical checks are unchanged.

## Operator actions still required

1. **Backup coverage:** verify a recent database backup before rollout. After
   rollout, save an account backup, download it and check gzip/JSON integrity in
   staging. Test existing restore-supported tables only in an isolated database;
   never run a destructive restore as a production smoke test. Persisted backup
   files must stay on the existing mounted storage volume.
2. **Gold prices:** configure a valid `GOLD_API_KEY` (preferred existing option) or
   `METALS_API_KEY` in the API environment (`stack.env` for the Compose install),
   recreate/restart the API through the normal deployment process, then deliberately
   refresh gold prices and verify currency, unit and timestamp. Alternatively set
   approved manual prices while the provider is unavailable. Keep keys out of logs.
3. **Pinterest:** use the delivery ID from a new rejection log to inspect that
   account's stored `ConversionDelivery.response` and `lastError` through authorized
   diagnostics. The supplied 422 lines do not contain enough information to prove
   which field Pinterest rejected. Repair the actual cause before any deliberate
   replay; preserve the original event ID/time and do not mass-reset old failures.
4. **BOM:** both reported accounts retain a failed/stalled stock-sync job. Preserve
   its identity, progress and write evidence. An inventory operator must establish
   which Woo stock writes actually applied and reconcile them using an approved
   recovery procedure before unblocking. This patch intentionally does not remove,
   replay, auto-complete or cancel that evidence. The guard is not a logging bug.
5. **Invoice relay:** `order_unavailable` remains a scoped 404. Check that the Woo
   order was synced into the correct account (and was not deliberately excluded or
   rejected by validation), then retry the original invoice request. Do not remove
   the account filter or queue an unscoped import to hide the timing gap.
6. **Malformed JSON and Woo network retries:** malformed requests stay rejected
   with 400; no execution endpoint is added. Occasional `ECONNRESET` remains handled
   by the existing bounded backoff. Investigate persistent failures rather than
   disabling request validation or retry bounds.

## Verification and rollback

Targeted tests cover old/new backup envelope equality, above-materialized-limit
streaming, finite streaming budget, write/transaction/registration cleanup,
scheduled claims, unchanged route contracts, provider failures, stale prices,
Pinterest evidence/retries, excluded/invalid orders, scheduler cleanup, memory
alert compatibility and existing BOM/invoice safety guards. No live provider calls,
stock writes, migrations or production recovery were performed.

Roll back code through the normal release process, retaining DB data and storage
volumes. Old code can still read generated version `1.0` gzip exports. A known
obsolete repeatable job removed by startup cleanup need not be recreated. Failure
markers are compatible with the pre-existing retry filter; do not remove them just
to make historical events retry after rollback.
