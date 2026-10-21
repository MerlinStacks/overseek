# Reviewed analytics, delivery and telemetry behavior

No live emails, advertising changes or operational scripts were executed during this review.

## Delivery callbacks

Each `/delivery-events` entry now requires `emailAccountId` plus `messageId` or `trackingId`. Every supplied message identifier and recipient must match the same log in that sender's account; recipient-only and ambiguous matches are rejected. Producers must include these identifiers before rollout. Credentials are checked once per distinct sender and the whole batch is authenticated before applying any event. Limit: 100 candidate events and 256 KiB per request.

Only explicit hard/permanent bounces and complaints cause permanent suppression. Generic bounce/failure/rejection events are recorded as unclassified delivery failures unless explicit severity establishes hard/soft classification. Temporary failures are recorded without permanently suppressing contacts. Disabled bounce tracking and ignored/unclassified events are not reported as applied suppression. Complaints take precedence over later bounces.

The helper serializes processing per account using a PostgreSQL transaction and row lock. Duplicate checks, tracking-event writes, suppression and log updates commit together, so repeated callbacks do not create duplicate tracking events for a log/type. Existing manual delivery-event controls use the same helper. This requires no new schema migration. Legacy relay-account discovery used by invoice relay remains bounded to 1,000 configured senders and rejects ambiguous shared credentials; delivery webhooks do not use discovery at all.

## Analytics meaning

- SEO digests use two disjoint seven-day UTC date windows ending three days ago. Totals are **returned query samples**, not whole-site totals, even below the 1,000-row limit. Search Console may omit anonymized queries. Changes shown in the UI are absolute counts, not percentages. Position is weighted by observed impressions. Newly observed queries are not proven newly ranked keywords. Top keywords use the digest's own window; attribution revenue is unavailable rather than zero.
- Advertising analysis reports per-section coverage, uses provider currency, refuses mixed-currency aggregation and preserves fractional conversion attribution. Provider date boundaries are inclusive. ROAS review thresholds do not establish profit or breakeven. Product/keyword results are capped samples, not complete campaign inventories. Missing or ambiguous inventory/variant matches do not generate margin/opportunity claims. Price-minus-COGS margin excludes other costs.
- Sales forecasting uses 30 complete UTC days, including zero-sale days, from local revenue-order history. It requires at least five distinct sales days and refuses mixed currencies or more than 50,000 matching orders. It is an unvalidated heuristic, not a statistically validated confidence estimate. Customer segments use complete local revenue-order history (also bounded at 50,000), registered customer identities and actual first/last purchases. At-risk means more than 500 in the reported currency and no qualifying order in 90 days, not merely high lifetime spend. Local history need not include the store's entire lifetime.
- Crawler totals are today's UTC calendar bucket, not rolling 24-hour totals. `totalHitsToday` includes observed hits that match block rules; `totalRuleMatchedHitsToday` is a subset, not proof that the storefront blocked those requests. UA-based identity/owner claims are unverified. Unknown identities are bounded hash sample buckets; they are not exact distinct crawler counts. API clients must replace the misleading old `totalHits24h`/`totalBlockedHits24h` fields with the new calendar-day fields. Existing historical daily data is retained.

## Sentry configuration

Error telemetry defaults to production builds only when a valid HTTPS DSN is present. Set `VITE_SENTRY_ENABLED=false` to disable it; development requires explicit `true`. Tracing and replay default to zero. Valid sample-rate strings are numbers from 0 through 1:

- `VITE_SENTRY_TRACES_SAMPLE_RATE`
- `VITE_SENTRY_REPLAY_SESSION_SAMPLE_RATE`
- `VITE_SENTRY_REPLAY_ERROR_SAMPLE_RATE`

Replay additionally requires explicit runtime consent, indicated by the site's consent manager setting session storage key `telemetry-replay-consent` to `granted` before initialization. Until that integration and its privacy policy are approved, leave replay rates at zero. Text is masked and media blocked; default PII transmission remains disabled. A storage/telemetry initialization failure cannot prevent React startup. The consent manager must stop active replay immediately on revocation (or reload with the flag removed); merely changing the storage key after startup does not reconfigure an initialized SDK.

## Retry behavior

Retry counts are bounded to 0–20, delays are validated and jitter never exceeds the configured maximum. Retry-After accepts strict seconds, HTTP dates and standard Headers objects. A provider window beyond the configured maximum fails rather than retrying early. Abort signals stop pending delays; an operation must also pass the signal to its own network calls to cancel in-flight I/O. Mark potentially ambiguous non-idempotent writes `idempotent: false`; existing generic defaults remain compatible with read callers. Sync error messages describe retry eligibility/status, never promise an unconfirmed scheduled retry.
