# Reviewed service safeguards and recovery

## Deployment

Deploy `server/prisma/migrations/20261021050000_coupon_action_claim/migration.sql` before restarting API/workers. It adds nullable action/node identity (preserving existing coupons), a provider-creation claim, and uniqueness per tenant/enrollment/node. Prisma Client was generated locally; no migration was applied to a live database during this review.

## Coupon reconciliation

Each new coupon action reserves a cryptographically random code before contacting WooCommerce and claims creation once. Confirmed retries return the stored result. An ambiguous timeout, provider response without a matching code/ID, or persistence failure leaves the claim in place and stops the automation action; it must not silently proceed or create a replacement discount.

For a pending action, an operator must inspect that account's reserved `GeneratedCoupon` row and look up its exact code in the same WooCommerce store. If the provider created it, verify its amount, type, expiration, usage limits and restrictions, then record its positive provider ID on the existing row. If creation was conclusively not attempted or did not happen, only then clear `creationClaimed` on that row and retry the same action. Do not clear a claim merely because a request timed out, and never generate a new code to work around it. Historical rows without node identity are retained and are not retroactively inferred to belong to a node.

## Reports

Scheduler jobs carry the immutable scheduled occurrence (`runAt`) and use a deterministic BullMQ job ID. Delivery idempotency is persisted in existing account-bound email logs for each schedule/occurrence/normalized recipient, surviving partial sends and queue cleanup. Deploy scheduler and workers together; old queued jobs missing `runAt` are rejected rather than assigned an invented identity. Regenerate such a job only with its known original occurrence after checking its delivery logs.

`lastRunAt` advances only after confirmed or previously successful deliveries. Skipped, deferred or ambiguous delivery does not count as a completed run. Existing email-log retry/reconciliation controls apply; do not change the occurrence/recipient to bypass a pending delivery claim. A bounced/complained previously sent email is not resent by the scheduled worker.

Dates use the server's configured local reporting timezone. Retries use the original occurrence for their data ranges. Digest customer counts retain their actual meaning, **customer records added locally**, not newly acquired people. Product/source revenue is null when not available. Missing/unsupported currencies and mixed-currency digest totals are rejected rather than labelled USD.

## Backups and analysis limits

Scheduled backups compare-and-swap the exact due row before generating files; at most 100 due accounts are processed per invocation. A claimed occurrence advances by the configured frequency even if creation is ambiguous or fails. Inspect failed backup logs/storage before deciding on an explicit manual backup; an immediate automatic retry could duplicate an already saved file. Settings edits invalidate a stale due-row claim. Storage completion cannot overwrite settings that changed while the backup was being saved.

Cohorts use complete **local** order history, not necessarily all historical store data. Above 50,000 orders or 100,000 attribution sessions they return an explicit coverage error rather than silently truncating. Revenue cohorts reject mixed currencies. Retention is cumulative repeat purchasing in complete calendar months; current/future observation months are omitted. Product-name-derived categories are labelled inferred. Acquisition uses the earliest available linked session on or before first purchase; absent history remains Unknown.

Picklists remain inventory-tracked WooCommerce picklists, not raw-material picklists. Missing/unmanaged/out-of-stock inventory, missing variations, inactive or unresolved/internal/supplier components, malformed quantities, cycles and excessive traversal fail with an explicit incomplete-data error. They no longer silently print an apparently complete list. Component variations and fractional waste are applied before aggregation. Handle raw materials through the appropriate material workflow before retrying.

Keyword groups serialize per-account quota checks, validate edits, and apply bounded bulk assignments transactionally: a missing/foreign keyword rolls the batch back. Unknown aggregate metrics are null with coverage metadata, and average position is explicitly unweighted across known keyword positions. Content briefs validate AI fields and label template fallbacks both in the API and UI. They are drafts requiring fact/link review, not verified publication-ready content.
