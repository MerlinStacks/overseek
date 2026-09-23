# Delivery estimates replacement — feature plan

Status: **IMPLEMENTATION READY FOR CONTROLLED ROLLOUT — NOT PRODUCTION DEPLOYED.**
This section is the authoritative progress record for the frozen 2.23.0 release.
Earlier staging notes and design questions below are preserved as superseded history;
they do not describe current activation, checkout wiring or provider support.

## Authoritative implementation progress

- Product-editor UX update: product production ranges are in **General Details**;
  variation overrides are in each expanded row of **Variations**. Both use the
  page's **Save Changes** action (including keyboard/mobile saves). The separate
  Delivery Production tab/button were removed. Production validation precedes
  writes, drafts survive failed saves and scope changes, and production fields
  remain on the local delivery-input API rather than ordinary Woo product payloads.
  Verified with 502 client tests, 62 relevant API/service tests and a client build;
  no new backend migration or companion-plugin change is required for this UI update.

- Complete: account/product/variation configuration, calendars, production inheritance,
  explicit rate mapping, permission-aware settings/product UI, feature controls,
  durable coalesced settings/product/inbound sync and freshness renewal/invalidation.
- The production gate is **readiness-controlled, not hard false**. Explicit activation
  checks synced settings, environment fingerprint, supported presentation, eligible
  products, SQL prerequisites and fresh verified inventory proofs. Explicit disable
  works independently of settings validity/feature availability. Input ACKs do not activate.
- Private baseline/guarded preparation and certification are supported while Pi still
  serves dates. Keep Pi active until verified inputs are ready; then manually deactivate
  Pi, refresh readiness and explicitly activate OverSeek. Active Pi still blocks
  activation; no automatic third-party deactivation or merchant activation occurs.
- Guarded receiving/reversal, parent-owned variations, native components, observation/
  reconciliation, legacy-job review and durable BOM cascades are implemented. Stock
  ACK and cascade completion are separate. Guarded inventory cannot silently revert
  to legacy transport when delivery display is disabled.
- **WBS/WBSNG 6.18.0 is natively tested and supported through explicit mappings**:
  observed `exact_rate` or confirmed `all_provider_rates`; core methods also support
  instance mappings. Unmapped options stay blank, exact exclusions win, and renamed
  titles can change opaque rate identities. Discovery alone never certifies transit.
- Classic and Store API/Blocks checkout capture is **wired into production bootstrap**,
  including native managed reservations and immutable selected-rate order snapshots.
  Shared snapshot parsing drives order-scoped email blocks/tags; missing/legacy
  promises stay blank rather than being recalculated or taken from an unrelated order.
- Product block/shortcode and classic/Blocks rate display passed real native rendering
  and browser checks without gate bypass. Native versions: WP **7.1.1**, Woo **11.1.1**,
  WBS **6.18.0**, PHP **8.4.23**, MySQL **8.4.8**. The final launch ZIP passed
  **40 checkout runs and 80 saved snapshots**, with all 95 installed files matching
  the archive. Its byte-equivalent runtime passed **99 browser checks** before the
  comment-only compatibility-header correction.
- Final native PostgreSQL **18.4**: **396 tests / 36 files / zero skips**, all **13**
  actual delivery migrations, real Prisma/concurrency helpers and production server
  build passed. Client: **469 tests / 72 files and build passed**. These are local
  isolated results; the updated remote CI workflows have not been executed here.
- Frozen launch ZIP: `/tmp/opencode/overseek-release/launch-2.23.0/overseek-wc-plugin.zip`;
  SHA-256 `b193d955ff0920a266b93d35df0678fddf98b58c2eeac1bced1d87045cfa9070`.
  Runtime, packaged README and version metadata remain frozen; tests/docs/CI are excluded.
- The application's tracked download ZIP and sidecar now contain the exact tested
  launch archive. Docker embeds that immutable package outside the uploads volume;
  a checksum-pinned Node startup installer refreshes only the two plugin-download
  files after migrations. Packaging/installer tests pass; an actual image build
  remains a release-environment check because this workspace has no Docker daemon.
- The required client lint job is no longer blocked: a scoped `ts-api-utils`
  TypeScript peer override preserves application compiler 7.0.2 while using the
  supported 5.9.3 tooling API. Clean `npm ci` and the exact CI lint command passed
  with zero errors (337 warnings); no lint rules were disabled.

### Rollout prerequisites and actual exclusions

Follow [the release runbook](docs/delivery-release-runbook.md): OverSeek first with
all 13 migrations and shared-core/server/client builds; inventory pause, legacy drain
and all pre-upgrade workers restarted; account/product/calendar/method configuration;
companion update; private cutover/certification and verified-input readiness with Pi
still active; manual Pi deactivation, fresh readiness, explicit activation/control ACK.
Recovery must preserve owner sequences, journals, pending receipts and cascades.

Cost-only SupplierItem/labour BOMs retain ordinary delivery eligibility; only
stock-derived finished BOMs remain excluded from date promises.
Documented exclusions: **stock-derived finished-BOM delivery promises**, **new/separate Blocks
pickup-location selector**, **custom inventory datastores**, unknown providers/cache
versions, and **provider multi-shipment/partial-shipment promises**. Native BOM
component inventory remains supported; this does not add finished-BOM date availability.
Core `local_pickup` shipping-rate wording does not certify the separate pickup flow.

Before merchant activation verify actual installed versions and Pi identity, theme/
template placement, classic/Blocks pages, real WBS weight/destination/rate mappings,
inventory integrations, reservations, checkout/payment/order lifecycle, caches,
mobile/desktop display, real SMTP/email-client output and disable/rollback ACKs.
Measure comparable merchant query/latency/error/backlog baselines. Native measurements
are local evidence, not a production performance guarantee or merchant certification.

Evidence: [native ZIP results](overseek-wc-plugin/tests/delivery-native-integration.md),
[final native PostgreSQL result](docs/delivery-native-validation-13-migrations.md),
[client validation](docs/delivery-client-validation-2026-09-22.md),
[compatibility](docs/delivery-estimates-compatibility.md),
[current launch API contract](docs/delivery-launch-api.md).

## Superseded implementation history — dormant foundation stage

<details>
<summary>Historical staging notes (not current blockers or support claims)</summary>

The following record predates guarded launch, WBS mapping, checkout capture and final
native validation. Its hard-inactive, unsupported-WBS, unwired-checkout, seven-migration
and pending-validation statements are explicitly superseded by the record above.

- Implemented: additive product/variation production-range columns and account settings migration; account-scoped validated GET/PUT APIs; default-on feature flag and super-admin toggle; delivery settings UI with cutoffs, timezone, separate weekdays, date closures, draft transit grid/default method and compact branding previews; individual product/variation editor with inheritance and separate local save.
- Existing wholesale turnaround values remain unchanged; no automatic production backfill. Local saves transactionally queue desired settings/production inputs without waiting for Woo or Redis. Background sync may probe plugin capabilities, but unsupported accounts are parked until explicit retry; no live storefront output is activated.
- Implemented next phase: authenticated plugin capability and shipping discovery endpoints plus an on-demand Overseek bridge and Refresh from WooCommerce UI. Discovery includes zone zero and disabled methods, requires linked-account identity, uses allowlisted metadata and performs no rate calculation. Import matches stable method/instance identity, preserves drafts, never auto-saves and starts new rows disabled pending transit confirmation. Older plugins return an update-required state without retry loops.
- Weight Based Shipping and unknown third-party providers are explicitly flagged for rate-level verification: discovery does not certify vendor rule/service identity or compatibility. Holiday entry currently uses date selection/list, not a full month-grid calendar. Per-method transit calendar overrides are not implemented yet.
- Implemented pure local PHP engine/calendar with a documented resolved-input contract and fixture. Includes cutoff/timezone handling, production/transit calendars, closures, whole-order aggregation, shared stock-owner demand, cumulative dated supply, calendar-day fallback and collection readiness. A local Woo adapter resolves cart products, production inheritance, live stock owners and caller-provided eligible rates without remote calls, rate calculation or stock writes. Dormant presentation hooks now call it only after the hard-inactive gate; unresolved third-party methods remain unsupported.
- Implemented versioned settings/production sync: PostgreSQL coalescing outbox, per-account capability cache/suppression and leases, bounded background resync building with cursor recovery, capped transport/build retries, revision-specific acknowledgements and transactional super-admin disable intents. Product-first saves seed settings; explicit clearing inputs survive resync. Full resync requests return after queueing, without scanning the catalogue in the browser request.
- Plugin accepts validated, account-bound settings, product and inbound inputs into a private InnoDB table, enforces monotonic revisions atomically, acknowledges exact replay, and rejects conflicting/stale writes. Inputs never trigger Woo stock/product save hooks or activate storefront output. Capabilities now include configurationSync=true, inboundInputs=true, inboundReceiptSafety=false and storefront=false.
- Added sync health/manual retry UI, read-only permission handling, and status invalidation after settings saves. “Synced” means requested settings/production inputs acknowledged, not supplier data ready or estimates live. UTC/IANA alias normalisation and full-envelope byte-size validation prevent known cross-runtime sync failures.
- Implemented staged inbound projections: tenant-owned ORDERED PO lines, UTC due-date labels, direct variation mapping, assigned-supplier calendar lead ranges, explicit empty replacements/tombstones, and bounded source/output sizes. Malformed inputs become integrity_error and unsupported BOM/owner arrangements remain unsupported. Receipt safety is always unverified; syncing a due date does not certify inventory availability.
- PO create/edit/delete/receipt/reversal, supplier edits/deletion, product supplier/stock-owner changes and production edits record durable rebuild intents. Routine changes coalesce per affected Woo parent; only manual/supplier fanout uses a bounded configured-product scan plus existing-row replay. Generic name/price/SEO edits enqueue no inbound work. Explicit parent/variation ownership edits are now preserved in local source fields and Woo updates. Actual PO stock arithmetic and asynchronous receipt transport remain unchanged.
- **Receipt safety blocker:** the local adapter still withholds ALL managed-stock physical-item estimates, even if stock currently covers demand. Prepare/apply guard infrastructure now exists, but tested cutover, uncertain-operation reconciliation and final version-bound projection release do not. Unmanaged production-only paths are also not approved for shopper activation while BOM invalidation and provider verification remain incomplete. Equivalent same-product cart objects aggregate correctly rather than failing solely due to different object instances.
- Inbound snapshots expire after 24 hours; retrying transport never renews their timestamps. There is no automatic freshness renewal yet. BOM changes, external catalogue reconciliation/webhooks and some stock-specific paths still need targeted invalidation; deletion tombstones follow the next covered trigger/manual rebuild. See `server/src/services/deliveryEstimates/inbound-implementation.md` for exact coverage and costs.
- Implemented existing-order email integration: ten discoverable merge tags and a draggable Delivery Estimate block, compact theme colours/font, configurable heading/dispatch line, automatic delivery/collection wording and fully hidden output for missing/invalid snapshots. Shared core validation/rendering is used by preview and send paths; saved designs are backward compatible and existing templates are not modified automatically.
- Added immutable `WooOrder.deliveryEstimateSnapshot` and account-scoped first-valid CAS import from `_overseek_delivery_estimate_v1` during normal sync/webhooks. Actual sends hydrate only the positively identified order; generic customer IDs/billing fields cannot select an unrelated order. Existing line-item links and customer history enrichment are preserved separately. Designer previews are account/mode scoped; test sends pin the displayed internal order ID or explicitly request no order.
- Added an HPOS-compatible callable snapshot factory/first-write helper using Woo order metadata CRUD and an order-specific lock. It is NOT wired into checkout yet. Existing orders without snapshots remain blank; neither previews nor campaigns invent delivery dates. PHP and TypeScript consume shared acceptance fixtures for the wire contract.
- Implemented dormant guarded receipt transport: immutable per-owner operations and sequences, transactional local receipt ledger, reversal from actually recorded quantities (not edited PO lines), bounded leased workers, account-level capability backoff, strict prepare/apply acknowledgements and uncertainty parking. Account mode defaults to LEGACY; no UI/API can enable guarded mode or automatically cut over. Legacy receipt payloads/background flow remain in place. Guarded mode supports only validated direct managed targets, not BOM products/components or inherited stock ownership.
- Plugin prepare persists an active local guard without touching stock. Apply durably records its attempt before invoking native Woo stock APIs, uses scoped query observation to reject silent SQL failures or ambiguous writes, and never re-invokes the native API on an applying/uncertain replay. Busy locks back off instead of permanently blocking. Guards stay active; receiptFinalization=false, inboundReceiptSafety=false and storefront=false. This is one endpoint-controlled invocation with ambiguity handling, not an exactly-once guarantee for arbitrary driver/hook effects.
- Disposable native integration now **passed 62 assertions** on WordPress 7.1.1 / WooCommerce 11.1.1 / PHP 8.4.23 / MySQL 8.4.8, including deltas, replay/reversal, caller-transaction preservation and a real trigger-injected silent SQL failure. A separate 11-assertion bootstrap check confirmed dormant block/shortcode/cart registration with no output/assets. Used fresh local binaries and a private database/server because Docker was unavailable; fixtures and processes were cleaned up. Fixed the strict-types WP-CLI invocation to use `--use-include`, including CI. This does not prove arbitrary third-party hooks, reconnect/crash concurrency or final release safety.
- Implemented `overseek/delivery-estimate` product block and `[overseek_delivery_estimate]` shortcode, editor-only inactive placeholder, compact shared renderer with theme-inherited fonts/validated colours and optional local SVG icon. No automatic price/Add-to-Cart positions. The production gate is hard false; no shortcode attribute, request or filter activates it, and inactive placements load no frontend assets.
- Built cache-safe product placeholders and a small batched/debounced WC AJAX client for the future active path. Public product/variation validation, no-store responses, stale-response aborts and product-specific form binding prevent private/stale content leaks. Default/geolocated country is not treated as an entered address. Known-address quote reuse verifies supported native package hashes against the full current cart/destination/cache version, without shipping recalculation; mismatches stay blank.
- Added additive classic per-rate markup below the label and native Blocks delivery-time text, preserving provider descriptions/text and prices. Native field coverage requires Woo 9.7+, with checkout's primary under-label position on 9.9+. Separate Blocks pickup-location selection and ambiguous multiple packages are not yet supported. WBS source audit found both `wbs` and `wbsng` with title-derived opaque rate IDs, including global instance discrepancies; these remain blocked pending explicit mapping rather than guessed from labels/prefixes. See `docs/delivery-estimates-compatibility.md`.
- Latest presentation checks: 65 storefront assertions, 324 classic/Blocks assertions across eight modes, quote checks across 18 Woo version cases, JS batching/variation/race tests, PHP lint, actionlint and diff checks pass. Visually inspected the actual shared renderer in isolated sample fixtures at 390px and 1280px: theme font inheritance, compact wrapping and no horizontal overflow. Prior suites remain 392 backend, 368 client and 60 core tests, plus all existing PHP harnesses (including 8,899 receipt assertions). Merchant-theme live checkout, SMTP/email-client checks, real PostgreSQL concurrency/migrations and remote CI remain unverified.
- Pending: inventory baseline/cutover and legacy-task drain, uncertain-operation reconciliation, final version-bound inbound release; remaining invalidation/freshness coverage; actual WBS/WBSNG transit mapping and store verification; separate Blocks pickup flow if used; actual checkout snapshot capture; automatic upgrade signalling/reconciliation, end-to-end merchant-theme/cache and performance checks. Registered presentation is not activation-ready.
- Deployment prerequisite: apply all seven additive delivery migrations through the normal deployment process before running the new backend, and rebuild the shared core package. No Overseek/PostgreSQL migrations or production deployment have been performed; the native test used only a disposable WordPress database. After a store's plugin update, use explicit sync to wake parked accounts and bootstrap saved inputs; automatic activation and guarded cutover are still unavailable.

</details>

## Historical design and approved starting defaults

The remaining original requirements/proposals explain design history. Open questions
and phase statuses here are superseded where resolved by the authoritative progress,
current launch API contract and release runbook above; they are not a rollout checklist.

### Approved starting calculation defaults

The user approved starting implementation after the recommended defaults were presented. Treat these as the initial contract, to be tested before storefront rollout:

- Supply precedence: reliable dated outstanding PO, supplier/item lead time, then configurable fallback; undated lead time starts at the effective order date in calendar days.
- Overdue/insufficient inbound supply uses supplier/fallback timing for uncovered quantities. Prior-backorder allocation remains a technical rule to resolve before publishing supply-dependent estimates.
- In-stock items still receive production time; newly received stock can enter production today before cutoff on an enabled production day.
- At or after cutoff rolls the effective order date once. Store timezone is authoritative; transit zero permits the eligible dispatch date and transit one advances one enabled transit day. Collection uses readiness without carrier transit.
- Non-shipped/virtual items do not suppress delivery timing. Capture the selected-method estimate when checkout creates the order, preserving it for order emails. Unpaid-order handling remains an explicit lifecycle follow-up.

## 1. Goal and confirmed requirements

Replace the existing Estimate Delivery Date for WooCommerce Pro plugin with an Overseek-managed feature in the existing WooCommerce companion plugin.

- Enabled by default for accounts; super admins can disable it per account.
- All merchant configuration lives in Overseek; WooCommerce consumes local synced configuration, not a second editable settings source.
- Products and individual variations support a production-time range in days. Zero is valid, including `0–0`.
- A product without production times must not show an estimate. No automatic store-wide production default.
- Variations with no production range inherit their parent's range. If neither is configured, no estimate is shown. A cart containing any applicable product without a resolved production range shows no cart/checkout estimate for now.
- Production `0` means same-day dispatch eligibility before cutoff on an enabled production day, subject to stock availability. Production `1` means one production business day later. Provide a configurable cutoff time.
- Confirmed clarification superseding earlier next-day-only wording: production `0–1` means dispatch today–tomorrow before cutoff, or tomorrow–the following day after cutoff, provided those dates are enabled production days with no closures. These are dispatch dates; delivery additionally depends on transit rules.
- Orders after the cutoff are treated as placed the next day, then normal production/calendar rules apply. Apply this rollover once, not as an additional production surcharge.
- When stock is managed and zero, account for an outstanding supplier purchase order's due date before adding normal production time.
- If stock is zero and supplier lead time is unset, use a configurable fallback of 30 calendar days. Supplier lead times are always calendar days, not production/transit business days.
- All items ship together, never partially. Backordered quantities delay the whole order's estimate.
- Show estimates on product pages, on the Block Cart page, and underneath each delivery method on checkout. Click and Collect uses collection-specific wording.
- Product pages use the default shipping method unless a customer destination is known from their logged-in address or previously entered checkout address; then use destination-aware method resolution, preferring their valid previous selection. If neither the previous selection nor configured default is eligible, leave the product-page estimate blank; do not select another service automatically.
- Select the default product-page shipping method in Overseek. Prefer the customer's previously selected shipping method when still applicable; do not use a method invalid for their current destination.
- Correction: the existing plugin uses selectable placements (below price, above Add to Cart, below Add to Cart), not a shortcode. The replacement provides a placeable product estimate block and a shortcode only; no automatic product-page hook placements.
- Support both classic and Blocks cart/checkout integrations, including estimates under each checkout delivery method.
- Estimated delivery dates must be available in Overseek's email designer.
- Email designer support includes both merge tags and a dedicated Delivery Estimate block, for existing orders only. Live product estimates in promotional/non-order emails are out of scope.
- Product-page block/shortcode styling must fit each business's brand and stay compact and unobtrusive on desktop and mobile.
- Compatibility target includes **Weight Based Shipping for WooCommerce**, by **weightbasedshipping.com**. Audit its actual method/instance/rate identities; do not assume method labels uniquely identify its configured rates.
- No bulk product editor is required; production details will be entered on individual products/variations in Overseek. CSV tooling is not part of the initial scope.
- Confirmed deployment sequence: update Overseek first, enter product/configuration details, then update the companion plugin on WooCommerce stores. The existing delivery plugin continues serving estimates until deliberate switchover.
- Configure transit-time ranges in a grid for WooCommerce delivery methods.
- Configure normal production/work weekdays and transit weekdays separately.
- Never assume Saturday/Sunday are closed: each business selects its production and transit days independently, including weekends where applicable. In production rules, “business day” means an enabled production day not excluded by a production closure.
- Select public holidays/closure dates on a calendar, independently excluding production days, transit days, or both.
- Prioritise no material server/page-load regression and compatibility with existing plugins.

All defaults and policies below are proposals unless explicitly listed above as confirmed. Literal zero additional CPU/storage cost is not possible; the implementation must instead avoid network dependencies on the storefront path and meet agreed measured overhead budgets.

## 2. Existing foundations and gaps

| Area | Existing foundation | Planned treatment |
| --- | --- | --- |
| Feature control | `AccountFeature`; `server/src/utils/accountFeatures.ts`; `client/src/hooks/useAccountFeature.ts`; `server/src/routes/admin.ts`; `client/src/pages/admin/AdminAccountsPage.tsx` | Add `DELIVERY_ESTIMATES`, default **on** for missing records on both server and client. Explicit false wins. Do not change defaults for unrelated features. |
| Product production time | `WooProduct.baseTurnaroundDays` in `server/prisma/schema.prisma`, currently used by wholesale | Decide whether to evolve or explicitly bridge this field into a range; preserve existing wholesale meaning and avoid competing sources of truth. |
| Variation production time | `ProductVariation` has no turnaround override | Add nullable range override with parent inheritance; zero must not mean inherit. |
| Product editor | `ProductEditPage.tsx`, `useProductEdit.ts`, `VariationsPanel.tsx`; product routes/services | Extend normal product/variation editing, validation and save flows. |
| Supplier orders | `PurchaseOrder.expectedDate`, `ORDERED` status, line quantities, `variationWooId`; `PurchaseOrderService.ts` | Derive eligible inbound batches. Current model has no partial receipt quantities or per-line due dates. |
| Local configuration push | `StorefrontConfigSync.ts`, `woo.ts`, companion plugin `class-overseek-api.php` | Extend versioned local configuration, with reliable background delivery. Existing push failure handling is not a durable retry queue. |
| Shipping methods | Shipping Hub candidates come from historical order labels | Discover actual Woo zones/method instances; do not reuse display-label matching as identity. |
| Calendars | Account timezone helpers exist; delivery calendars do not | Introduce dedicated production/transit calendars. |

Confirmed replacement: PI Websolution's **Estimate Delivery Date for WooCommerce Pro**, https://www.piwebsolution.com/product/pro-estimate-delivery-date-for-woocommerce/ . The vendor page confirms product/cart/checkout display and links to documentation at https://www.piwebsolution.com/user-documentation-estimate-delivery-date-plugin/ . The installed version, selected placement and store configuration still need inspection before designing migration. There is no existing shortcode to migrate in this store. Existing `pi_item_` metadata compatibility code is not sufficient to identify all rules.

## 3. Feature availability, activation and permissions

- Existing and new accounts get default-on feature availability. Explicit super-admin disable is enforced by APIs, UI, sync jobs and the Woo plugin's local configuration.
- Proposed distinction: account availability is on by default, but customer-facing output starts only after valid store configuration and migration readiness. Confirm this activation policy.
- Product-level visibility additionally requires configured production times; default-on account availability must never populate missing production times automatically.
- A super-admin toggle must enqueue a high-priority configuration update, including an explicit disable payload; simply hiding Overseek UI is insufficient.
- Disabled local configuration short-circuits rendering and avoids loading feature-specific storefront assets. Retain configuration for later re-enablement.
- Show last acknowledged version, pending/failed changes and last successful sync. An unreachable Woo store cannot be disabled instantaneously; document this limitation and choose an expiry/fail-safe policy.
- Account-scoped permissions control editing; only super admins can override account feature availability. Validate account/store ownership on every endpoint and job.

## 4. Configuration and data model proposal

### Production ranges

- Store integer `productionMinDays` and `productionMaxDays`, with `0 <= min <= max` and a practical upper bound.
- Product unset values suppress that product's estimate; there is no implicit store production default. Unset variation values inherit a configured parent range, otherwise suppress the estimate. Override both endpoints together; reject half-configured ranges.
- `0–0` explicitly permits dispatch on the effective production start date; it is not equivalent to unset. Count each range endpoint as an offset from that date using the production calendar: zero adds no production days, one adds one eligible production day.
- Existing single-day turnaround values can migrate to matching endpoints, e.g. `3 -> 3–3`, subject to the wholesale compatibility decision.
- Show effective inherited values clearly; support resetting an override without confusing it with `0–0`.
- Use individual product/variation editing only for this release. Do not add a bulk editor or make bulk/CSV tooling a prerequisite for rollout.

### Transit grid

Proposed columns: zone, method title, method ID, instance ID, enabled for estimates, minimum days, maximum days, transit calendar, optional cutoff/notes.

Provide an Overseek selector for the default product-page method, referencing the same stable method identity as the grid. Warn when it is removed, disabled or lacks transit configuration; do not silently substitute the fastest method.

- Read authoritative WooCommerce shipping-zone/method configuration outside the storefront request path; cache and refresh on relevant changes or explicit refresh.
- Key mappings by stable method/instance identity and match actual selected package rates, not translated or editable labels. Include the rest-of-world zone.
- Third-party dynamic rates may need provider-specific rate/service keys under one instance; define a supported identity contract and an unmapped-rate policy.
- Specifically verify Weight Based Shipping for WooCommerce using the installed version and representative configured rules. Discover which rule/rate identities it exposes, how weight/destination/cart changes affect those rates, and map transit settings to stable supported identities. Do not run or alter shipping calculations just to render a product estimate, and do not infer per-rule transit support until those identities are verified.
- Highlight newly added, removed and unmapped methods. Do not silently invent transit days.
- Proposed calendar default: one account transit calendar, optional per-method override. Production has a separate calendar.
- Click and Collect is in scope and uses collection-specific wording. Proposed calculation uses whole-order production/stock readiness without carrier transit; confirm any additional collection preparation delay.

### Calendars and time

- Choose one authoritative store timezone; surface mismatches with Overseek's account timezone. Store closures as local date-only values to avoid UTC/DST shifts.
- Separate weekly working-day masks for production and transit; reject a calendar with no usable days and bound date-search loops.
- Weekend operation is supported by these normal weekday settings, not a special-case exception. Production may run on days when transit does not, and vice versa. All weekday examples are conditional on the configured calendars, not fixed Monday–Friday rules.
- Calendar UI supports named single-day and multi-day closures, with production/transit/both selection and per-transit-calendar scope where applicable.
- Manual holiday entry is confirmed scope. Regional imports, recurring holidays and exceptional working weekends are optional decisions, not assumptions.
- Provide an Overseek setting for the daily cutoff. After cutoff, treat the order as placed on the next local calendar date, then apply normal production/workday rules. Resolve the production start to an enabled, non-closure production date and add the configured offsets. With all relevant days enabled, `0–1` ordered Monday before cutoff dispatches Monday–Tuesday; after cutoff dispatches Tuesday–Wednesday. Do not apply both an effective-order-date rollover and a second cutoff penalty. Confirm timezone, exact-cutoff boundary, dispatch cutoff and receipt-day eligibility. Transit counting is defined separately.
- Supplier lead times and the fallback use calendar-day addition, including weekends and holidays. After deriving supply availability, apply the agreed production start/receipt policy; never count the supplier wait using the production or transit calendar.

### Inbound inventory projection

- Publish only storefront-safe input: Woo product/variation or stock-owner ID, due date, eligible quantity, projection version and freshness metadata. Never expose supplier names, costs or purchase-order identifiers to shoppers.
- Include only eligible `ORDERED` purchase orders with due dates; exclude draft/cancelled/received orders.
- Resolve Woo's effective stock owner, including variations whose stock is managed by their parent. Do not aggregate unrelated variation purchase-order lines.
- Initial release may use current whole-order receipt semantics only. Do not label full ordered quantities as accurate remaining quantities if partial receipt support is added later.
- Account for PO creation/edit/status/date changes, receipt/reversal and deletion, as well as product/variation stock-owner changes.
- BOM/component-backed products need an explicit policy; do not imply component availability is already supported by direct-product PO lookups.
- Sync resolved supplier lead-time ranges/overrides and the configurable 30-day fallback for local shortage calculations. Changes to supplier/item lead times must invalidate affected projections. No request-time supplier lookup.

## 5. Calculation contract — proposed, subject to answers

Calculate a range of **estimated dates**, not a guarantee. Use one canonical calculation engine in WooCommerce and shared test fixtures for any Overseek preview to prevent divergent date rules.

1. Resolve enabled/configured state, timezone, effective product/variation production range, calendars and actual eligible shipping rate.
2. Derive the effective order date in the store timezone: before cutoff use today's date; after cutoff treat the order as placed the next day. Roll a disabled/closure date forward to the next enabled production date, with no extra production-day penalty. Zero permits dispatch on that resolved date if stock is available. Exact-cutoff equality remains to be confirmed.
3. Read live local Woo stock and backorder/purchasability state, not a periodically pushed stock snapshot.
4. For managed stock at zero or a backordered quantity, find the relevant eligible inbound due date. Proposed precedence: reliable dated inbound supply, otherwise configured supplier/item lead time in calendar days, otherwise the account fallback (default 30 calendar days). Production follows stock availability rather than replacing its normal production range. Confirm the handling of overdue/insufficient supply and the base date for undated supplier lead-time calculations.
5. From the eligible production start date (after any stock wait), add minimum and maximum production-day offsets: `0` stays on the start date and `1` advances one enabled production day. These form the dispatch-readiness range. Then add transit endpoints using the selected method's transit calendar and dispatch policy.
6. All items ship together. Whole-order readiness is the latest item readiness at each endpoint, including the backordered portion; never show an earlier partial-shipment estimate for available units. Add each offered method's transit range to the same whole-order readiness to display its checkout estimate. If another plugin splits Woo packages, retain whole-order readiness and do not change shipping rates or promise separate dispatches; flag unsupported arrangements rather than silently inventing fulfilment behaviour.
7. Recalculate when variation, quantity, address, shipping method or cart contents change through existing Woo lifecycle events where possible.

Important: a PO due next week delays the **start date**; do not add the absolute wait again after production. Production and transit closures are independent. Define whether transit counting begins on dispatch day or the next eligible transit day.

Unresolved stock policies:

- Quantity shortages/backordered units delay the whole order, not just those units. Confirm negative-stock accounting and whether existing backorders are represented by negative stock, reservations, or separate demand to avoid double counting.
- Multiple inbound batches: proposed quantity-aware choice is the earliest batch date whose cumulative eligible quantity covers the shortage. This requires a decision about existing backorder demand/reservations; without allocation, estimates are not inventory promises.
- Missing dated inbound supply: proposed supplier lead time, then configurable 30-day fallback when supplier lead time is unset. Confirm whether overdue, insufficient or stale inbound data follows the same fallback. Label dates as estimates rather than confirmed replenishment promises.
- Mixed carts containing any applicable product with no resolved production settings show no whole-order estimate in cart or under checkout methods, including collection. Resolve variation inheritance before this check. Do not silently ignore the product or treat unknown production time as zero. Define applicability for non-physical items separately.
- Non-managed stock normally uses production only, but an explicitly unavailable/unpurchasable product must not receive a misleading promise.
- Whether stocked finished goods still require the configured production time (proposed yes), or have an in-stock override.

## 6. Low-overhead architecture

**Overseek owns settings and inbound projections; WooCommerce calculates locally.**

- No synchronous Overseek, supplier or carrier calls during product/cart/checkout rendering or estimate calculation, including cold cache and outages.
- Background, change-driven, coalesced sync for settings, per-product/variation production data and inbound projections. Keep catalogue-wide data out of a single autoloaded WordPress option or frontend payload.
- Extend existing authenticated companion-plugin transport. Use schema versions, capability checks, monotonic revisions, idempotent application and explicit acknowledgements; older jobs cannot overwrite newer data.
- Backend-first rollout must support older Woo companion plugins: save and edit all estimate inputs in Overseek without requiring delivery-estimate endpoints. Mark unsupported stores as “plugin update required”, retaining pending configuration without repeatedly attempting unsupported sync or treating existing product saves as failures.
- On plugin upgrade, negotiate capabilities and perform a bounded initial sync of accumulated settings, production ranges and inbound data, followed by normal incremental updates. An older plugin's generic successful response is not proof it accepted the new scope. Require explicit version/scope acknowledgement and show readiness before activation.
- Use durable bounded retries/backoff and low-frequency reconciliation, plus a manual resync action. Expose sync health in Overseek.
- Store configuration locally and load only relevant product/package inputs. Batch/cache reads within a request to prevent item/variation N+1 queries.
- Version caches by relevant input changes and local date/cutoff boundaries. Cart/address-specific results must never leak through shared page caches.
- Prefer local PHP rendering and existing Woo updates. For heavily cached product pages, decide between a small cache-safe local calculation payload or a narrowly batched local endpoint; measure the chosen approach. No unconditional polling or heavy calendar library on storefront pages.
- Missing config means no estimate, not a synchronous remote fallback. Define acceptable stale-config and stale-inbound windows separately, with conservative expiry for supply-dependent estimates.
- Handle the receive-stock race: a received PO may disappear before Woo stock updates arrive. Fail conservatively during this interval; never extend an obsolete inbound promise.
- Set measurable query-count, execution-time, asset-size and p95 render-overhead budgets after collecting a baseline. Do not claim no impact without measurements.

## 7. Display and compatibility

- Confirmed surfaces: product pages (including selected-variation updates), Block Cart, and underneath **each offered delivery method** at checkout, not only the selected method. Click and Collect changes wording to collection readiness.
- Confirmed product placement: a server-rendered `Overseek Delivery Estimate` WooCommerce product-context block for block templates, plus a namespaced shortcode for legacy templates/page builders. Both use the same calculation/rendering service, return no customer-facing content when ineligible, and respond to variation/quantity changes. The editor can show a non-customer-facing placeholder when no estimate is configured.
- Block/shortcode placement is theme/template composition, not a second WordPress business-settings UI. Production, calendars, transit, cutoffs and wording remain managed in Overseek.
- No automatic product-page hook placements or legacy shortcode alias. Migration requires placing the new block or shortcode in the product template before switching off the old output. Cart/checkout integrations remain independent of manual product-page placement.
- Both classic and Blocks cart/checkout are required. Validate supported extension points for per-method placement in both checkout types; do not rely on fragile DOM rewriting. Verify available APIs against supported Woo versions during the compatibility audit.
- Email designer availability is required; automatic insertion into all emails is not implied. Order-confirmation-page and customer-account order display remain optional scope.
- On product pages without a known destination, use the default shipping method explicitly selected in Overseek. With a usable current Woo session address (including a guest returning from checkout) or logged-in customer's shipping address, prefer the customer's previously selected method when still valid. Logged-in status alone is not an address. When the previous selection is absent or invalid, use the Overseek default only if eligible for the known destination; otherwise leave the estimate blank. Do not silently choose another eligible service or present an unavailable method as an actual delivery option.
- Never share address-dependent product estimates through a public page cache or embed private address data in cached markup. Use cache-safe local updates only when required; no external rate-provider requests triggered solely to render an estimate. Define a conservative fallback for dynamic rates unavailable locally.
- Provide configurable, translatable estimate wording and date formatting; accessible UI; reserved display space to avoid layout shift.
- Integrate using namespaced hooks and supported Woo APIs. Do not alter shipping prices, stock, backorder rules, availability, selected rates or other plugins' metadata.
- Support classic templates and Cart/Checkout Blocks explicitly, with lightweight feature-scoped assets and HPOS-compatible order APIs.
- To support reliable order emails, the proposed persistence model saves the checkout estimate and relevant context as an immutable whole-order snapshot. Do not recalculate historical promises from today's settings.
- Decide when checkout snapshots are captured and what happens to unpaid/preorder/scheduled orders.
- Detect coexistence with the exact old plugin and warn/block duplicate output until a store deliberately switches. Do not automatically deactivate third-party plugins.
- Preserve existing orders/metadata, and provide rollback to the old display without deleting configuration or historical estimates.

### Email designer integration — required scope

- Make order delivery estimates available through discoverable merge tags in the email designer, not just as WooCommerce order metadata. Proposed tags: `{{order.estimatedDelivery}}`, `{{order.estimatedDeliveryStart}}`, `{{order.estimatedDeliveryEnd}}`, `{{order.estimatedDispatch}}` and `{{order.estimatedCollection}}`. Final names should follow the existing registry conventions.
- Recommended source: persist the actual selected method's checkout estimate as a versioned order snapshot and sync it into Overseek. Include dispatch/delivery or collection endpoints, method identity, fulfilment type, timezone and calculation timestamp. Emails must not recalculate the order's promise from current product settings or today's date.
- An order has one ship-together estimate, not separate earlier promises for available lines. Click and Collect uses collection wording and no fabricated delivery dates.
- Provide a compact, drag-and-drop Delivery Estimate designer block built on the same resolved order data. Merge tags also remain available in ordinary text blocks; both are required scope.
- Missing snapshots (including legacy orders), unconfigured-product carts and non-order campaign contexts must resolve to blank or an explicitly configured fallback. Hide the block when estimate data is absent; never leak raw unresolved tokens or use an unrelated customer's latest order in a real send. Existing-order scope does not mean inventing estimates for historical orders that have no saved estimate.
- Preview, test email, subject/preheader resolution and actual automated sends must agree. Label sample preview values as sample data, provide delivery/collection/missing-data examples, and retain account scoping and HTML escaping.
- Reuse existing integration points: client `emailDesignerV2/mergeTags.ts`, `EmailDesignEditorV2.tsx`, `client/src/lib/emailDesignerV2.ts`; server `MergeTagResolver.ts`, automation `NodeExecutor.ts`, marketing test-email routes and `MarketingService.ts`; order ingestion in `sync/OrderSync.ts`.
- Existing preview, standalone test, campaign test and automation paths build different contexts. Update each deliberately; registering a merge tag alone does not hydrate order data. The current generic product tag context can resolve to the first item, so do not use it to represent whole-order readiness.
- Preserve old saved email designs. The required block needs palette/factory/settings, live preview, compilation and email-client-safe responsive output using the email document's brand theme, not storefront CSS.
- Confirmed scope: existing orders only. Resolve the associated order's saved estimate; do not calculate live product estimates for promotional emails or contexts without an order. Importing validated legacy order estimates, if wanted, is a separate migration decision.

### Branded, restrained product presentation — required scope

- Use the same presentation component for block and shortcode. Default to a compact inline or small stacked label/date range, not a prominent banner, large card or modal. No animation, countdown, external font or decorative image by default.
- Inherit the storefront theme's font and surrounding typography by default. Offer account-level presentation controls in Overseek for accent/text colour, text size within accessible limits, spacing and optional small icon/subtle background. Prefer existing brand appearance defaults where appropriate; do not force Overseek's own visual identity onto stores.
- Keep style controls separate from calculation settings and allow a theme-inherit/reset option. Use scoped classes/CSS custom properties, sanitised style values and no global resets or changes to other plugin elements.
- Match the local template context on desktop; wrap naturally on narrow mobile screens without clipping, horizontal scrolling, oversized padding or covering purchase controls. Dates and wording must remain readable at zoom and with long translations.
- Reserve only necessary space during variation/address updates, avoid flicker/layout shift, and keep absent estimates genuinely blank. Use accessible contrast and unobtrusive announcements for meaningful updated dates.
- Load small feature-scoped styles/assets only where needed. No new UI framework or heavy design dependencies on the storefront.
- Provide an Overseek preview with desktop/mobile widths and representative brand settings. Before rollout, visually verify the real block and shortcode in supported classic/block themes, long date ranges, collection wording, missing estimates and variation changes.
- Treat the email theme separately: email estimates inherit the email design's typography/colours rather than assuming the website's CSS exists in email clients.

## 8. Delivery phases

1. **Decisions and audit:** answer the questions below; inspect old-plugin settings, active shipping providers, page cache, checkout type and representative supplier-order data; measure baseline performance.
2. **Data and controls:** default-on account flag, super-admin control, production ranges/inheritance/migration, transit grid, calendars, validation and permissions.
3. **Reliable local sync:** capability negotiation, versioned settings/product/inbound payloads, durable retries, reconciliation, disable propagation and health reporting.
4. **Calculation engine:** deterministic date/stock/package rules, extensive fixtures and a preview/debug explanation showing why dates were selected.
5. **Storefront, orders and email designer:** branded compact block/shortcode, variation and Woo updates, Blocks/classic support, synced order snapshots, both merge tags and the dedicated email block with consistent preview/test/send behaviour, and coexistence safeguards.
6. **Validation and rollout:** compare estimates without customer-facing output on a pilot store; performance/compatibility checks; deliberate old-plugin switchover; staged rollout with rollback.

### Confirmed deployment order

1. **Deploy Overseek first:** backward-compatible database/API/UI changes, product/variation editing, calendars, transit settings and email designer support. Existing Woo plugin versions and the old delivery display continue working unchanged. Email estimates without snapshots remain blank.
2. **Populate data in Overseek:** enter product ranges and account settings individually, review inherited values and readiness validation. Allow settings to be saved before Woo supports this feature. Determine whether authoritative shipping-method discovery works with the current integration; if it needs the upgraded plugin, retain draft mappings/default selection and finish verification after upgrade rather than guessing method identities.
3. **Update each Woo companion plugin:** capability handshake and initial configuration/product/inbound synchronization, with acknowledged readiness and preview checks. Updating the plugin alone must not produce duplicate output alongside the old delivery plugin.
4. **Deliberate storefront switchover:** place the block/shortcode in the product template, verify classic/Blocks cart and checkout plus Weight Based Shipping behaviour, disable the old estimate plugin's output and activate the replacement. Keep rollback available without discarding Overseek settings.

Feature availability remains default-on throughout. Per-store storefront activation is gated by configuration/sync readiness and coexistence checks, supporting the confirmed Overseek-first deployment sequence.

## 9. Acceptance tests

- Default enabled for existing/new accounts; explicit super-admin false enforced; disabling queues and acknowledges removal of live output.
- `0–0`, `0–N`, inherited/unset ranges, invalid/negative/reversed ranges and wholesale migration compatibility.
- Unconfigured product renders no estimate; zero explicitly permits dispatch on the eligible production start date; mixed configured/unconfigured carts follow the agreed policy.
- With Monday–Wednesday enabled and stock available: `0–1` ordered Monday before cutoff dispatches Monday–Tuesday, and after cutoff Tuesday–Wednesday. `0–0` dispatches Monday before cutoff or Tuesday after cutoff; `1–1` dispatches Tuesday before cutoff or Wednesday after cutoff. Closures/disabled production days advance eligible dates. Supplier/fallback calendar-day waits include weekends/holidays.
- Unset variation inherits parent; explicit zero overrides parent; unresolved cart item suppresses all whole-order method estimates.
- Block and legacy shortcode produce equivalent results, with no automatic product-page hook output; Overseek-selected default-method display switches to the customer's valid previous method for saved/session addresses and never leaks customer-specific results through page caching.
- Classic and Blocks cart/checkout show equivalent whole-order ranges under each offered checkout method; after-cutoff rollover is applied once, including supplier-dependent estimates.
- Supplier lead-time range, missing lead time uses 30 days, changed fallback is respected, valid PO due-date precedence, and no duplicate supplier wait added to an existing PO date.
- Available stock plus a backordered quantity produces one whole-order readiness range, never a partial-shipment promise; all offered delivery methods use that readiness and Click and Collect has distinct wording.
- Work/transit weekends, separate holidays, multi-day closures, year boundaries, leap days, DST, before/after cutoff, same-day receipt and zero-day rules.
- Test seven-day operation, Saturday-only/Sunday-only operation, and different production/transit weekday selections; no hard-coded weekend exclusions. Invalid previous/default shipping methods leave product estimates blank even when another service exists.
- Managed/unmanaged/parent-managed stock; zero/negative/insufficient quantity; backorders disabled; multiple/undated/overdue/cancelled/received POs; receipt reversals and delayed stock sync.
- Duplicate shipping labels across zones, instance changes, dynamic carrier rates, unmapped methods, pickup, mixed carts and multi-package shipments.
- Tenant isolation, permissions, malformed/oversized sync inputs, replay/out-of-order sync, failed retries, older companion plugin, missing/stale cache and remote outages.
- Deploy and populate Overseek while stores still run the older plugin: product saves succeed, unsupported-scope retries do not loop, and existing estimates are unaffected. After upgrade, initial sync is complete/version-acknowledged before activation, with no lost pre-entered settings or duplicate display.
- Weight Based Shipping integration: stable method/rate mapping, multiple configured rules where supported, weight/quantity/destination changes, selected-method persistence, default-method fallback and no shipping-price/rule changes caused by estimates.
- Assert zero external HTTP calls during rendering/calculation, no catalogue-wide scans and bounded queries with large carts/variable catalogues.
- Cached pages across midnight/cutoffs, quantity/variation/address changes, classic/Blocks checkout, HPOS, supported shipping/theme plugins and no duplicate legacy output.
- Immutable historical estimates, no checkout blocking on estimate failure, no sensitive supplier data in public responses, and performance within agreed budgets.
- Email designer tags resolve from the correct account/order snapshot in preview, tests and real sends; product/calendar changes do not change historical email promises. Missing snapshots and non-order contexts have safe blank/fallback output; delivery and collection wording are correct and escaped.
- Dedicated email block and merge tags show equivalent existing-order estimates; the block is available in the palette, persists through save/reopen, compiles correctly and hides without estimate data. No live promotional product estimation or unrelated-order fallback occurs.
- Block/shortcode visual checks at narrow mobile and desktop sizes, long/localised dates, theme typography, brand colours, zoom, accessible contrast, minimal layout shift, no overflow and no interference with purchase controls. Email output is checked separately in representative email clients.

## 10. Questions to resolve

### Next decisions

1. Production offset meaning is resolved: `0–1` permits dispatch today–tomorrow before cutoff, shifted by the effective order date after cutoff, using configured production days. Remaining stock detail: can stock received today begin production and be dispatched today if before cutoff?
2. Resolved: if the previous shipping method and Overseek default are unavailable for the destination, leave the product estimate blank.
3. At exactly the cutoff, should the order roll to the next day? Weekends are configurable, not automatically excluded; a disabled production date rolls to the next enabled, non-closure production day without an extra day just for normalisation.
4. Confirm precedence: valid dated PO, then supplier/item lead time, then fallback (supplier/fallback days are now confirmed calendar days). From which date should an undated supplier lead time start?
5. What is the installed old-plugin version? Should existing settings be imported or configured afresh in Overseek? Both classic and Blocks support is confirmed, regardless of the current store setup.
6. For virtual/non-shipped products without production settings, should they suppress the cart estimate too, or be excluded from delivery timing?

### Additional scope decisions

7. Should in-stock items always receive the normal production time? Does Click and Collect have any extra preparation delay beyond order readiness?
8. Must inbound quantities cover prior backorders as well as this order, and how should overdue/missing/insufficient PO dates and negative stock be handled?
9. Do PO due dates apply uniformly to every line? Are partial supplier receipts or component/BOM availability needed at launch? Partial supplier receipts are distinct from the confirmed prohibition on partial customer shipments.
10. Confirmed plugin: Weight Based Shipping for WooCommerce by weightbasedshipping.com. Obtain its installed version and representative rules; determine whether transit needs to differ between rules/services within an instance or only between Woo method instances.
11. Are production calendars store-wide, or do products/suppliers need different schedules? Do methods need separate transit calendars?
12. Are manually selected holidays enough, or should we import regional holidays and allow exceptional working weekends?
13. What store timezone and default cutoff should apply? When does transit counting begin? Are virtual products, bundles, preorders and subscriptions in scope?
14. Email designer scope is resolved: both merge tags and a dedicated block, existing orders only. Remaining lifecycle decisions: when exactly to capture the order snapshot, whether to import valid legacy order estimates, and whether production is measured from order placement, successful payment or another status.
15. No bulk editor is wanted; initial setup uses individual product/variation editing. Remaining permissions decision: which existing account roles can edit delivery settings versus product production ranges?
16. How long can cached supplier information remain usable during sync failures, and what disable-propagation delay is acceptable if a store is unreachable?
17. What catalogue/cart sizes, cache/CDN setup, themes and Woo versions should define the performance and compatibility test matrix?
18. Deployment order is confirmed: Overseek update, enter product details, then Woo companion-plugin update. Verify initial-sync readiness and deliberate old-plugin switchover without requiring simultaneous upgrades; products without production settings remain hidden.

Next implementation step: add explicit uncertain-operation reconciliation and version-bound final inbound release with cutover controls, finish WBS/WBSNG rate mapping and mutation/freshness coverage, then wire checkout snapshot capture and validate the active path on a staging store before replacing the hard-inactive gate. The native receipt test and dormant storefront foundation are now in place. The approved starting defaults above supersede earlier questions where answered; remaining lifecycle details must be resolved before rollout.
