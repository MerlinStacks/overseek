# Production sync errors — 2026-11-13

Evidence: supplied logs from November 11–12. No production database, queue, or provider configuration was changed during this investigation.

## Code fixes

- **Order sync / `Critical event payload exceeds bounds`:** lifecycle events contain the Woo order snapshot, including arbitrary plugin metadata. The old 1 MiB inline limit threw inside the source transaction, rolling back order sync. Larger snapshots now use account-scoped, deterministic payload-chunk records in the same transaction. Each chunk is below 1 MiB; the complete snapshot remains bounded at 32 MiB. Dispatch verifies ownership and SHA-256 before claiming, then publishes the original payload. Missing/corrupt chunks leave work pending. Uncertain delivery remains non-replayable. No schema migration is needed. Retain chunk records alongside receipts, including uncertain receipts; do not independently purge them.
- **Targeted review 404:** a delayed webhook can reference a removed review. Explicit Woo invalid-review-ID 404s now settle without consumer actions or deletion of local evidence. Route/proxy 404s, permissions errors and server failures still propagate. Targeted sync does not advance the account-wide checkpoint. The supplied logs do not include the response code, so this explains the incident only if Woo returned its explicit invalid-ID code.

## Production follow-up

1. Deploy the code and retry the failed orders sync for the affected account. Confirm successful order sync and critical-event dispatch; do not clear uncertain outbox receipts or blindly replay historic side effects.
2. **BOM reconciliation:** both accounts have unresolved failed/uncertain jobs. In BOM Sync, an authorized inventory operator should inspect diagnostics and use **Repair & resume**, checking fresh stock and resolving mismatches. Do not delete the retained jobs, reset progress, or suppress this safety check just to remove the warning.
3. **Pinterest 422:** retrieve the account-scoped `ConversionDelivery.response` and payload for a listed delivery ID. General logs intentionally omit provider responses that may echo customer data. Fix the rejected fields indicated by that response; do not assume which field failed or retry the identical rejected payload.
4. **Email relay 503:** inspect the relay/proxy health and acceptance records. A proxy 503 does not prove the relay did not send the email. Reconcile using the relay idempotency key/message records before resending. Current code deliberately marks transport failures as delivery-unknown and avoids blind fallback/retry.
5. **Google audiences:** the generic logged detail does not establish a root cause. Inspect destination/connection and Google-side diagnostics. Verify Data Manager API enablement, OAuth scope and account access. Current code preserves pending async membership plans and provides sanitized diagnostics for recognized provider errors; do not reset those plans as a workaround.
6. **Gold price:** the public endpoint returns 403 and neither authenticated provider is configured. Configure `GOLD_API_KEY` (GoldAPI) or `METALS_API_KEY` (metals.dev) in deployment secrets, or enter a verified manual price. The log shows a cached price almost 465 hours old; review pricing before relying on it.
7. **Account backup:** the account exceeds the deliberate 1 GiB application-export limit. Establish and restore-test a database backup; an application snapshot that failed is not backup coverage. Do not simply remove the limit on this resource-constrained host. Larger application exports would need a separate capacity/restore design.

## Verification

- Targeted Vitest run: 27 tests passed across outbox and targeted review sync suites, including Unicode snapshots over 1 MiB, idempotency/conflicts, missing/corrupt/cross-account chunks, uncertain delivery and specific versus generic 404s.
- Server `tsc --noEmit` did not finish within the 120-second command timeout; full typecheck remains unverified.
- The configured `oc-heavy` executable was missing. Targeted tests were run with `OC_HEAVY_DISABLE=1` and `--maxWorkers=2`; the typecheck used the same wrapper override. No full test suite was run.
