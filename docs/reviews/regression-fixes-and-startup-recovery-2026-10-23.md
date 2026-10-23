# Regression fixes and startup recovery

Follow-up to [the last-15-commit audit](last-15-commits-regression-audit-2026-10-23.md) and the supplied production startup logs. Application changes are local; nothing was deployed and no production jobs, receipts, stock, emails or data were modified.

## Implemented

- **Tracking reads:** a typed pre-import failure releases only its own admission gate after a transactionally recorded `read-failed` outcome. Later scheduled attempts can run after backoff, including within the same scheduled occurrence. Errors during/after import, failed release transactions, and old ambiguous gates still fail closed. Health distinguishes a failed read from a successful observation.
- **Tracking milestones:** opaque provider IDs no longer hide exact recognized status/description text. Contradictory milestones and negated delivery remain unknown. A previously recorded unknown head can be corrected by rereading the same recognized scan without replaying customer automation.
- **Shipment email context:** new outbox payloads preserve the nested shipment status, scan description/location/time and tracking fields. A consumer-side adapter also supports already-frozen flat payloads and existing storefront callback fields without changing source receipts or substituting order status for shipment status.
- **AI models:** model discovery filters by explicit provider `tools` metadata; generation uses that same discovery for models outside the known fallback set. There is no vendor-prefix guess. Settings explain unavailable saved choices and catalog failures, cancel stale reads, and do not automatically overwrite saved models.
- **BOM forecasting:** forecasts now use active recipe lines, consistently with stock calculation. Disabled/deleted historical lines no longer break the entire account's forecasts. The forecast page explicitly explains this basis and warns that disabled lines must be reviewed before purchasing. Invalid **active** foreign/missing/ambiguous references, cycles, invalid quantities and graph limits still fail closed with HTTP 409, not false zero demand or repeated duplicate HTTP-500 stack traces.
- **Fastify:** request logging uses `LogController`, removing the deprecated top-level `disableRequestLogging` setting without re-enabling request logs.
- **Deployment shutdown:** startup directly execs Node instead of leaving npm/shell between Docker and the application. An integration test sends SIGTERM through the real startup script to a disposable fixture and observes its drain handler. The application drain deadline is two minutes and Compose's API grace period is 150 seconds. This addresses a deployment-related lost-lock risk; the historical stall logs alone do not prove that was their only cause.
- **Stalled BOM evidence:** failed/unknown BOM jobs under either existing ID convention are retained and surfaced as `BOM_SYNC_RECONCILIATION_REQUIRED`. Scheduled/manual bulk dispatch does not delete and blindly replace them. Status exposes the failure/progress, and logs include queue/account/job/progress context. Shared cancellation cannot erase failed BOM evidence. Successful completed jobs remain eligible for later scheduled runs.
- **Memory diagnosis:** the reported heap samples (130.7 → 260.1 → 221.5 MiB) are startup growth followed by a decrease, not evidence establishing a leak. Trend detection now requires the configured complete window (12 samples by default) and sustained rising low-water marks. High-heap pressure alerts and heap-dump thresholds remain active immediately. This does not claim that production memory is leak-free.

## Deployment and existing incidents

1. Build/deploy the matching API and client, and restart all old worker processes together. No new Prisma migration is introduced by these fixes; previously pending rollout prerequisites still apply.
2. Apply the API service's `stop_grace_period: 150s` in the actual deployment stack, not just the source file. The first replacement of an old npm-based container may still strand old work. A job exceeding the drain deadline, a forced kill, Redis interruption or event-loop starvation can still lose its lock; do not increase replay permissions to hide this.
3. The supplied failed jobs `sync_bom_a03315be-5bf4-47fa-bc5f-e8e5df59e8d5` and `sync_bom_17fed050-e5ca-4b90-8ce4-5b975cd90b4a` require **account-scoped operator review**. Stop any old worker that might still be writing, preserve job progress/history, compare live Woo stock and available audit acknowledgements, then approve a fresh current-state sync only after the outcome is reconciled. Do not blindly call retry, delete the failed job, or replay stock deductions. No production inspection or reconciliation was performed here.
4. Old pending/uncertain tracking gates cannot be classified retrospectively from their state alone. Compare scan transactions, outbox/subscriber receipts and delivery history before any explicit repair. This patch intentionally does not bulk-reset them.
5. Existing invalid active BOM references still need data correction in their owning account. These changes do not reactivate deleted lines, reassign foreign components or certify that an active recipe is materially complete.
6. Verify carrier response shapes, real Postgres locking, Docker shutdown, model catalog metadata and narrow-screen settings in staging. Local mocked tests do not establish provider availability or real customer delivery.

## Local verification

- Full client suite: **276 files / 1,580 tests passed**, including the two earlier timeout cases. Three new AI-settings tests also passed separately after they were added.
- Final full server suite: **417 files / 3,826 tests passed; 14 files / 132 tests skipped**. Additional focused checks passed for all changed regression paths, including the three new AI-settings tests.
- Client and server production builds passed. Application/operational TypeScript checks and Prisma schema validation passed.
- Startup migration/plugin integrity/SIGTERM checks: **24 passed**.
- Targeted server lint passed. Client lint has warnings, not errors, including existing effect/component patterns; no clean warning-free lint claim is made.
- `.gitignore` was already modified before this task and was not changed by these fixes.
