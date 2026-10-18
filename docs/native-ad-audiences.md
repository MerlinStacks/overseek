# Website retargeting and Meta lookalikes

Open **Audiences → Advertising → Create audience**. This is separate from a segment's customer-list export/sync panel.

## Website audiences

Choose a connected advertising account, name the audience, configure its rules and confirm advertising consent/permissions and platform terms. Creation is queued immediately. Membership is then maintained by the platform: no visitor emails or hourly membership uploads are needed.

### Meta

- Select a pixel/dataset accessible to the chosen advertising account. Assign pixel access in Meta if no source is listed.
- Choose PageView, ViewContent, AddToCart, InitiateCheckout or Purchase.
- Optionally limit the inclusion event to URLs containing a product/category path.
- Choose a rolling membership window from 1 to 180 days.
- Optionally exclude Purchase events in a separate 1–180 day window. The exclusion uses the same pixel and applies across products, not just the included URL.

Presets cover all visitors, product viewers, cart additions and checkout starters. These use the existing pixel events; they do not install another pixel. An audience definition does not verify that the chosen pixel is firing the required events or receiving valid consent.

### Google

- This workflow creates Google Ads flexible rule-based website user lists using `url__` URL-contains rules.
- Enter the actual website domain/path to include, and a 1–540 day membership window.
- For purchaser exclusions, enter the actual order-confirmation path and exclusion window. `/order-received/` is a WooCommerce example, not an automatically verified store setting.
- Confirm that the correct Google remarketing tag is active for this destination advertising account, with advertising personalisation permitted where consent allows. Overseek's Google enhanced-conversion uploads alone are not enough.

Google's cart preset is explicitly **cart-page visitors**, not proof of an add-to-cart event or an abandoned cart. Checkout/product paths are examples and can differ across stores. The all-visitors preset requires entering the store's domain. Confirmation-page exclusion is a proxy for purchase, so verify that page is only shown after a successful order and is tagged correctly.

Both platforms' exclusions mean **any matching purchase within the chosen exclusion window**, regardless of whether it occurred before or after the inclusion event. These audiences are not the same as Overseek's strict abandoned-cart customer segment. Platforms handle lookback/prepopulation on their own terms; requesting prefill does not guarantee historical membership. Google prepopulation is subject to its network/tag restrictions.

## Meta lookalikes

Choose a Meta account, change the audience type to **Meta lookalike**, and select either:

- A segment customer list successfully uploaded to that same Meta account, or
- A website audience created through this workflow in that same Meta account.

Select a target country and 1%, 3% or 5% size. Current country options are AU, NZ, US, GB, CA, IE, DE, FR, ES, IT, NL, BE, AT, CH, SE, NO, DK, FI, SG and JP. Additional countries can be added as supported options later.

Meta resolves and updates the lookalike from its source. Customer-list sources should remain on hourly sync for fresh seed data; paused uploads are marked in the source selector. Source size, country coverage, permissions and platform policy may prevent creation or serving. A source having an external ID is not a guarantee it meets Meta's minimum eligible/matched population.

Google's retired general Similar Audiences are not equivalent to Meta lookalikes. Google has campaign-specific expansion and Demand Gen lookalike features; this release does not create or configure those.

## Status and failure recovery

- **PENDING / CREATING:** the scheduler is processing creation.
- **CREATED · platform managed:** the definition exists remotely. This is **not** a report of serving readiness, matched population or current platform eligibility. Check those in Ads Manager/Audience Manager.
- **FAILED:** creation was rejected, or preflight failed before a remote create request. Fix permissions, rules or eligibility, then use **Retry creation**, reconfirming consent.
- **NEEDS REVIEW:** creation may have succeeded but the result/acknowledgement was lost. Overseek does not blindly repeat a non-idempotent creation. Use **Check platform result** to find and link an exact match in the same advertising account. If no match is found, inspect the platform manually; this action never creates a replacement.

Remote names include a stable `[OS-<record-id>]` suffix for safe reconciliation. Identical normalized definitions in the same destination are deduplicated even if a different display name is entered. This prevents repeated clicks from creating another identical audience. A distinct event, source, window, country or lookalike size is a separate definition.

The existing scheduler runs `create-native-ad-audience` jobs. Its hourly audience dispatcher also recovers pending dispatches and marks interrupted creations for review after 15 minutes. Created website audiences and lookalikes do not need hourly uploads.

Creating these definitions **does not change campaigns, targeting, exclusions or budgets**. Attach the audience to appropriate campaigns separately, checking platform expansion/Advantage+ settings. Definitions are creation-only in this release: manage subsequent edits, deletion, platform sizes and eligibility in the advertising platform. Deleting an ad connection locally does not delete its remote audiences.

## Deployment and testing

Apply Prisma migrations, regenerate the client and restart the API/scheduler before use. New storage is `NativeAdAudience`; existing customer-list `AudienceSync` records are unchanged.

Unit/API/UI tests cover rule payloads, tenant/destination/pixel/source isolation, consent requirements, windows, deduplication, creation state transitions, retry safety and uncertain-result reconciliation. Live creation still requires an eligible connected account, pixel/tag access and an actual consented website. Verify each platform's created rules and population using a test audience before attaching it to paid campaigns.

References:
- [Meta website custom audiences](https://developers.facebook.com/documentation/ads-commerce/marketing-api/audiences/guides/website-custom-audiences)
- [Meta audience rules](https://developers.facebook.com/documentation/ads-commerce/marketing-api/audiences/guides/audience-rules)
- [Google flexible rule-based list example](https://developers.google.com/google-ads/api/samples/add-flexible-rule-user-list)
- [Google Demand Gen lookalike segments](https://developers.google.com/google-ads/api/docs/remarketing/audience-segments/lookalike-audiences)
