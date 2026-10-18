# Ecommerce advertising audiences

In **Audiences → Segments**, create/edit a segment and choose an ecommerce preset or combine rules with AND/OR:

- **Purchased in the last N days:** processing/completed orders, matched by WooCommerce customer ID or normalized billing email.
- **No purchase in the last N days:** excludes recent purchasers. Combine with `Orders Count ≥ 1` for a win-back audience; on its own it also includes non-buyers.
- **Abandoned cart in the last N days:** tracked carts with a positive value, inactive for at least 30 minutes, with no later successful order or tracked purchase.
- Spend, order-count and name/email rules remain available. Presets also cover repeat and high-value buyers.
- **Email opened/clicked in the last N days**, and their negative counterparts, use tracked event timestamps, optionally restricted to an email campaign/automation source ID. Negative rules also include profiles with no email history. Opens may include privacy-proxy activity and clicks may include scanners; these are not guaranteed human engagement.

Rules are evaluated against current local data whenever previewed, exported or synced. Windows move forward automatically. Store/tracking sync latency affects freshness. Only contacts materialized in Overseek can match; anonymous visitors and identified sessions without a customer/contact record cannot be uploaded.

Customer segment cards show the number of matching customers prominently, using the same evaluation as **View Members**. Counts refresh every minute while the page is active, on page refresh and after rule changes. Failed counts are shown as unavailable rather than zero. These are local customer counts, not subscriber-expanded exports or platform-matched advertising audience sizes. Platform-managed website/lookalike segments do not expose individual customer counts.

## Meta and Google

Open a segment's **Advertising** button (exports & sync), select a connected Meta/Google Ads account, confirm the required advertising consent and platform customer-data terms, then enable sync. The first upload is queued immediately; subsequent dispatches run every five minutes. Additional destinations can be enabled independently. Refresh status to see progress; failed jobs retry automatically and active destinations are retried at the next scheduled run. Platform processing and queue backlog can delay membership beyond five minutes.

The consent confirmation covers **all current and future members**. It is a business attestation, not a per-contact consent collection system. Do not enable a segment unless its membership rules/data sources guarantee the required advertising data-sharing and personalisation permissions. Purchase history and email-marketing subscription alone do not establish advertising consent.

Email-only customer matching remains the default. Two optional settings require a fresh consent attestation when enabling/updating a destination:

- **Subscriber expansion:** also evaluates the same segment rules against subscribed members of active email lists without a matching customer record. Global email suppressions are excluded. Guest purchase totals and recent purchases match by billing email. These contacts have no name/phone/address unless a customer profile exists. This advertising-only expansion does not change customer previews, segment counts or email broadcast recipients. Anonymous sessions and email addresses not in customer/eligible list data are not exported.
- **Enhanced matching:** also sends normalized, hashed phone identifiers and, when complete, name/country/postcode matching data. Phone numbers must be valid E.164 or have a known country. Google receives hashed names with unhashed country/postcode as required; Meta receives hashes for these fields. Neither option treats email subscription or purchase history as advertising consent. Existing destinations do not silently opt in. To update options, select the same destination and reconfirm consent.

Google Gmail audience normalization removes dots from the local part. Updates remove old matching rows when membership or identifiers change, including when a segment becomes empty or options are disabled. Five-minute runs upload only changes; existing members are fully refreshed daily to avoid platform membership expiry. Meta batches contain at most 1,000 rows. Google batches contain at most 10 operations and 20 identifiers (six operations for enhanced matching). Acknowledged matching rows are persisted after each batch so retries can converge after partial failure; old email-only snapshots migrate on the next sync. Raw email/phone/name values are not placed in queue payloads or membership snapshots. Hashed data and required country/postcodes remain sensitive personal data.

These are customer-list audiences, usable for targeting or exclusions subject to platform policy and campaign configuration. Enabling a customer-list sync does not create website audiences or lookalikes automatically. From the same **Audiences → Segments → Create segment** entry point, choose a website or lookalike segment for [website audiences and Meta lookalikes](native-ad-audiences.md). Neither workflow changes campaign targeting or budgets. Account permissions, accepted customer-data terms, Google Customer Match eligibility and platform minimum audience sizes still apply. Upload completion is not a guarantee of identity matches or audience availability; counts represent submitted identifiers rather than reachable users.

**Pause sync** stops further updates but retains the platform audience and saved sync configuration. **Resume sync** queues another refresh. Deleting a segment stops its syncs but does not delete its external audiences: remove those in the platform if no longer needed. Previously-created audiences are not auto-enabled by this release.

The platform-specific CSV buttons download a customer-only hashed-email snapshot for manual upload. They do not include subscriber expansion or enhanced identifiers. A CSV is not automatically refreshed. Treat even hashed exports as sensitive personal data.

## Deployment and verification

Apply Prisma migrations (including `20261018160000_advertising_matching`) and regenerate the client before deploying. Restart the API and scheduler/Redis workers. Registration removes the old hourly audience repeat and installs the five-minute repeat, dispatching deduplicated `sync-ad-audience` jobs. The migration adds opt-in flags, matching snapshots and email-engagement lookup indexes.

Use a small, consented test segment and eligible connected accounts to verify creation, membership updates and removals in each platform. API access and platform matching cannot be verified by unit tests. Test an empty segment too, to confirm removal of previously uploaded members. Larger Google audiences require many API calls and are subject to account quotas.
