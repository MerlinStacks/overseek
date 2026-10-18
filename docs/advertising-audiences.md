# Ecommerce advertising audiences

In **Audiences → Segments**, create/edit a segment and choose an ecommerce preset or combine rules with AND/OR:

- **Purchased in the last N days:** processing/completed orders, matched by WooCommerce customer ID or normalized billing email.
- **No purchase in the last N days:** excludes recent purchasers. Combine with `Orders Count ≥ 1` for a win-back audience; on its own it also includes non-buyers.
- **Abandoned cart in the last N days:** tracked carts with a positive value, inactive for at least 30 minutes, with no later successful order or tracked purchase.
- Spend, order-count and name/email rules remain available. Presets also cover repeat and high-value buyers.

Rules are evaluated against current local data whenever previewed, exported or synced. Windows move forward automatically. Store/tracking sync latency affects freshness. Only contacts materialized in Overseek can match; anonymous visitors and identified sessions without a customer/contact record cannot be uploaded.

## Meta and Google

Open a segment's **Advertising exports & sync**, select a connected Meta/Google Ads account, confirm the required advertising consent and platform customer-data terms, then enable hourly sync. The first upload is queued immediately. Additional destinations can be enabled independently. Refresh status to see progress; failed jobs retry automatically and active destinations are retried at the next hourly run.

The consent confirmation covers **all current and future members**. It is a business attestation, not a per-contact consent collection system. Do not enable a segment unless its membership rules/data sources guarantee the required advertising data-sharing and personalisation permissions. Purchase history and email-marketing subscription alone do not establish advertising consent.

Only normalized, deduplicated SHA-256 email identifiers are uploaded. Google Gmail normalization removes dots from the local part. Updates remove identifiers that no longer qualify, including when a segment becomes empty. Existing members are also refreshed to avoid platform membership expiry. Meta uploads are batched at 1,000 identifiers; Google's UserData mutations at 10 operations. Acknowledged membership is persisted after each batch so retries can converge after partial failure. Raw email addresses are not placed in queue payloads.

These are customer-list audiences, usable for targeting or exclusions subject to platform policy and campaign configuration. Enabling a customer-list sync does not create website audiences or lookalikes automatically. Use the separate **Audiences → Advertising** workflow for [website audiences and Meta lookalikes](native-ad-audiences.md). Neither workflow changes campaign targeting or budgets. Account permissions, accepted customer-data terms, Google Customer Match eligibility and platform minimum audience sizes still apply. Upload completion is not a guarantee of identity matches or audience availability; counts represent submitted identifiers rather than reachable users.

**Pause sync** stops further updates but retains the platform audience and saved sync configuration. **Resume sync** queues another refresh. Deleting a segment stops its syncs but does not delete its external audiences: remove those in the platform if no longer needed. Previously-created audiences are not auto-enabled by this release.

The platform-specific CSV buttons download a hashed-email snapshot for manual customer-list upload. A CSV is not automatically refreshed. Treat even hashed exports as sensitive personal data.

## Deployment and verification

Apply Prisma migrations and regenerate the client before deploying. The existing scheduler/Redis workers must be running; `refresh-ad-audiences` runs hourly and dispatches deduplicated `sync-ad-audience` jobs.

Use a small, consented test segment and eligible connected accounts to verify creation, membership updates and removals in each platform. API access and platform matching cannot be verified by unit tests. Test an empty segment too, to confirm removal of previously uploaded members. Larger Google audiences require many API calls and are subject to account quotas.
