# Independent Google Ads purchase uploads

Google website enhancements and server-created conversion imports are different APIs and conversion action types. An `ENHANCEMENT` cannot create a missing browser purchase.

## Setup

1. In Google Ads, create an enabled **Import from clicks** purchase conversion action (`UPLOAD_CLICKS`). Accept customer-data terms and configure enhanced conversions for leads if matching by hashed email/phone. Use the conversion-owning customer account for cross-account tracking.
2. Start this new action as **Secondary**. In Overseek **Settings → Tracking Pixels & CAPI → Google Ads**, enter its numeric resource ID in **Independent Purchase Import Action ID**, alongside the connected customer ID. This is not a conversion label or `AW-` ID.
3. Save, then use **Check Google Configuration** for a read-only check of account access, action type/status and customer-data terms. No synthetic purchase is uploaded. This check does not establish click matching, upload eligibility, reporting or bidding readiness.
4. Verify real consented orders in Overseek delivery logs and Google's upload diagnostics. Check the original conversion time, WooCommerce order ID, currency/value and customer match identifiers. Include a controlled order where the browser purchase tag is not fired, without bypassing consent. API acceptance does not guarantee attribution to an ad click or immediate reporting.
5. After validation, choose exactly **one** purchase action as Primary/used for bidding and review campaign-specific goals. Typically the new import becomes Primary and the browser purchase action becomes Secondary. **Order IDs deduplicate only within an action, not between browser and import actions.** Do not sum both as unique purchases in reporting.

## Behaviour and compatibility

- When the independent import action is configured, purchase uploads use `uploadClickConversions` instead of enhancements. They contain the original occurrence time, order ID, value/currency, available Google click ID and hashed email/phone. Address identifiers are not supported by that endpoint and are omitted.
- With no import action, existing configurations retain their website enhancement behaviour. Browser Google Ads/GA4 tags are unchanged; an independent import does not require their purchase event to have fired.
- Replay retains the original imported order/time. Quota cooldowns preserve a failed delivery for later retry. Empty/malformed success responses remain unconfirmed failures rather than falsely marked SENT.
- Explicitly denied advertising events are not uploaded. Normal account/event consent gating still applies. Do not collect or upload customer identifiers without the required permissions.
- Google's June 2026 access restriction means `UploadClickConversions` requires an eligible developer token with prior upload usage. New integrations must use Google Data Manager instead; this change does **not** implement that separate transport or bypass Google eligibility. If Google rejects the token/action, resolve that before making the import action Primary.
- Google click identifiers retain their original type through collection and ingestion: `gclid`, `gbraid` and `wbraid` are uploaded in their own fields, never relabelled as each other. Older untyped Google clicks retain legacy `gclid` behaviour.
- GA4 server events use the configured measurement stream's actual session cookie (`GS1` or `GS2`). An Overseek visit timestamp or another stream's cookie is never substituted. Missing cookies mean session attribution cannot be reconstructed; this does not bypass consent or ad blockers.
- The read-only configuration check warns about Secondary purchase actions, multiple Primary purchase sources, and actions that always use a fixed default value. Overseek ROAS continues to use Google's `conversions_value`, not `all_conversions_value`: summing secondary browser/import/GA4 actions can double-count the same orders. Campaign-specific/custom goals still require review in Google Ads.
- GA4 debug mode validates events but does not record them in production reports. Disable it for live revenue tracking.
- The check is available through the existing authenticated `POST /api/capi/test/google` endpoint. No campaigns, goals, budgets or remote conversion actions are created or modified automatically.

## Delayed WooCommerce payments

The companion captures consented shopper context on classic order creation and the pre-payment Blocks checkout hook. Payment-completed and paid-status hooks can then send a purchase without a thank-you-page revisit. Pending, failed and on-hold orders still do not emit purchases.

- Saved context contains the original visitor, IP/user agent, consent and platform/click/session identifiers. Gateway/admin cookies and IP addresses are never substituted. Paid order values are rebuilt at delivery; the occurrence time uses WooCommerce's paid timestamp when available.
- Browser pixels, payment/status hooks and transport retries reuse the order's `_overseek_event_id`. Acknowledged orders are skipped. Context is removed on acknowledgement (including transport retry); abandoned context expires after seven days via WP-Cron. Service WP-Cron for cleanup/retries. Recovery also refuses expired context even if cron was delayed.
- Missing, denied, expired or differently linked account context is not reconstructed. An observed consent denial on a later checkout/thank-you request removes saved context. A gateway callback cannot discover a consent change that was never communicated to WordPress.
- This fixes event capture for Meta CAPI and Google's server transport, not browser execution after the customer leaves. **Google still needs the independent import action above to create a purchase when no browser purchase exists.** Website enhancements alone cannot recover it. No Google goals or Primary/Secondary settings are changed automatically.
- This is forward-looking: orders created before the companion update without saved context are not automatically backfilled. Stage-test classic/Blocks delayed payment without returning to confirmation, repeated payment/status callbacks, denied consent and failed HTTP acknowledgement before rollout.

References: [Offline conversion imports](https://developers.google.com/google-ads/api/docs/conversions/upload-offline), [Website enhancements](https://developers.google.com/google-ads/api/docs/conversions/upload-online).
