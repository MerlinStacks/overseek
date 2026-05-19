# Shipping Hub Changelog

This changelog tracks implementation progress for the account-gated Shipping Hub feature set.

## 2026-05-19

### Added

- Created the initial Shipping Hub implementation changelog.
- Confirmed the build starts from the documented foundation in `docs/shipping-hub-plan.md`.
- Added account-scoped Prisma models for shipping carrier accounts, package presets, item overrides, shipment drafts, labels, tracking events, automation dispatches, print stations, print jobs, audit events, and MyPost Business transactions.
- Added initial `/api/shipping` route skeleton behind `SHIPPING_HUB` with safe read endpoints for hub summary, packages, labels, print stations, and settings.
- Registered `/api/shipping` as a strict account-scoped API route.
- Added Shipping sidebar navigation and route stubs for Hub, Packages, Item Overwrites, Past Labels / Invoices, and Settings behind `SHIPPING_HUB`.
- Added package preset CRUD API and UI with cm/kg input conversion to mm/grams storage.
- Added shipping settings API and UI for AusPost credentials, sender details, MyPost payment method, dispatch status, services, label format, fulfilment behavior, and tracking polling.
- Added item overwrite CRUD API and UI for WooCommerce product/variation shipping overrides.
- Wired the hub summary and label history pages to `/api/shipping` read endpoints.
- Added dispatch-order draft generation from the configured dispatch status.
- Added first-pass address validation and shipment draft update endpoints.
- Added print station registration and token rotation endpoints and UI.
- Updated the Shipping Hub page to list dispatch orders with readiness, address validation, and package confidence states.
- Added print-agent polling and print-result endpoints using print station token headers.
- Added safe label creation and reprint API contracts. Live label creation returns a clear not-connected response until the AusPost adapter is implemented.
- Added saved-credential test endpoint and UI feedback.
- Added a minimal standalone `print-agent/agent.js` that polls OverSeek, downloads label PDFs, prints with local OS commands, and reports print results.
- Added Windows MVP install, manage, and uninstall scripts for the print agent using Scheduled Tasks.
- Added a local print-agent setup UI for OverSeek login, account selection, station registration, printer selection, status checks, and disconnect.
- Added Electron Windows app packaging for the print agent with tray monitoring, auto-start, login/setup UI, local printer selection, and NSIS installer/uninstaller config.
- Added Electron print-agent test label printing, diagnostics, recent logs, and encrypted station token storage via Electron safeStorage where available.
- Added order shipment monitoring API and `ShipmentMonitoringPanel`.
- Replaced the order detail shipment tracking panel with Shipping Hub shipment monitoring when `SHIPPING_HUB` is enabled, while preserving legacy tracking as fallback.
- Added shipment tracking event normalization and dispatch into existing email automation triggers.
- Added `SHIPMENT_RECEIVED_BY_CARRIER` to the flow builder and flow node summaries.
- Updated automation dedupe/entity scoping so shipment triggers are shipment-scoped.
- Added shipment merge tags for tracking number, tracking URL, carrier, service, latest scan description/location/time, and shipment status.
- Added first-pass package auto-selection for shipment drafts using item overrides, product dimensions/weights, package max weights, fallback weights, forced weights, and package confidence reasons.
- Preserved package-blocked readiness during address validation and clear stale package blockers when staff manually provide package details.
- Completed shipment trigger labels across the flow trigger config, event selector modal, flow node display, and automations list.
- Added bulk create-and-print request endpoint with per-order partial-success results.
- Added Shipping Hub ready-order selection UI and bulk result feedback.
- Added initial shipping audit events for draft updates, address validation, label creation requests, and stored-label reprint queueing.
- Added inline shipment draft editing in the Shipping Hub for corrected address, package preset/manual dimensions, manual weight, service code, and print station.
- Added per-draft address validation action from the hub.
- Updated hub summary to report the configured dispatch status instead of a fixed fallback.
- Added draft rate request API contract that stores the AusPost rate request snapshot and a placeholder adapter response.
- Added Shipping Hub rate preview action and response display for each dispatch draft.
- Added shipping carrier transaction listing API for the Invoices tab.
- Reworked Past Labels / Invoices into tabs with stored-label reprint controls and MyPost transaction table.
- Added Shipping Operations page for print queue monitoring and audit log review.
- Added print job listing, audit event listing, and safe retry API for failed/offline print jobs.
- Added print job reassignment to another print station with `PRINT_JOB_REASSIGNED` audit events.
- Tightened print job reassignment so picked-up/printed jobs cannot be moved and retry/reassign responses return the enriched operations job shape.
- Added a safe label cancellation request API/UI with `LABEL_CANCEL_REQUESTED` audit events. The endpoint returns an AusPost adapter-not-connected response until real cancellation/refund integration is implemented.
- Added print-success fulfillment sync contract that completes the local order, stores tracking and label cost metadata, attempts WooCommerce completion/tracking metadata sync, creates an internal WooCommerce order note, and audits sync success/failure.
- Added repeatable shipping tracking polling scheduler scaffold for active labels on `SHIPPING_HUB` accounts with tracking sync enabled.
- Added Shipping Hub dispatch queue search, readiness filters, sort controls, and visible-ready bulk selection behavior.
- Added Operations audit log search, event-type filtering, and expandable metadata/before/after snapshot diagnostics.
- Updated Shipping Settings to explicitly capture AusPost Shipping and Tracking API product, environment, optional base URL override, API key/password, and account/charge account while keeping saved secrets masked from the browser.
- Added AusPost Shipping and Tracking adapter boundary for decrypting saved credentials, building carrier auth headers, testing saved settings, and routing rates, label creation, and tracking refresh through one integration point.
- Added advanced AusPost endpoint path mapping in Settings and wired live credential-test/tracking calls through configured paths, with flexible tracking event extraction into normalized Shipping Hub events.
- Added focused Vitest coverage for the AusPost adapter credential/test/tracking boundary and Shipping Hub tracking normalization/import behavior.
- Extracted documented AusPost Shipping and Tracking reference defaults from the developer portal bundle: base URL `https://digitalapi.auspost.com.au/shipping/v1`, Basic API key username/password auth, `account-number` header, account check `/accounts/{account_number}`, tracking `/track?tracking_ids={tracking_ids}`, rates `/prices/shipments`, shipments `/shipments`, labels `/labels`, label lookup `/labels/{request_id}`, suburb validation `/address`, and cancellation via `DELETE /shipments/{shipment_id}`.
- Mapped live AusPost `/prices/shipments` rate preview requests using the documented shipment payload shape, centimetre/kilogram unit conversion, sender details from Shipping Settings, destination order address, selected/default service code when available, and flexible shipment/item price extraction.
- Added focused Vitest coverage for AusPost rate request payload generation and response parsing.
- Mapped live AusPost `/address?suburb={suburb}&state={state}&postcode={postcode}` validation and wired configured accounts to validate AU destination suburb/state/postcode combinations during Shipping Hub address validation.
- Added focused Vitest coverage for AusPost suburb validation requests and response parsing.
- Refactored AusPost shipment payload generation so rates and shipment validation share the same documented field mapping.
- Added live AusPost `/shipments/validation` support and wired the label creation path to run shipment validation before returning the still-intentional label creation mapping-required blocker.
- Added focused Vitest coverage for shipment validation payloads and service-code guardrails.
- Added AusPost `/shipments` creation support in the adapter using the shared shipment payload builder, plus response parsing for shipment ID, item ID, tracking identifiers, cost, GST, and carrier status. This is mapped and tested but not yet wired to the staff label button until order/label/PDF mapping is complete.
- Added focused Vitest coverage for shipment creation response parsing.
- Added an explicit AusPost `/labels` request boundary that requires known print group/layout inputs, builds the documented print preferences payload, supports synchronous `wait_for_label_url`, and parses request ID/status/URL metadata. This remains un-wired to the staff label button until product-group/layout selection and local PDF storage are completed.
- Added focused Vitest coverage for label request payload generation and response parsing.
- Added Shipping Settings fields for AusPost label print group, label layout, and branding preference so live label creation does not infer product-specific print preferences.
- Added AusPost label request status lookup and PDF URL download support in the adapter.
- Wired the staff create-and-print action end to end when required settings are configured: validate shipment, create shipment, request label, resolve/download PDF, store the PDF under server uploads for 30-day reprints, create `ShippingLabel`, and queue `ShippingPrintJob`.
- Added `LABEL_CREATED_AND_PRINT_QUEUED` audit event metadata for the live label flow.
- Added focused Vitest coverage for label status lookup and PDF byte download.

### Verified

- `npx prisma validate --schema server/prisma/schema.prisma` passes.
- `npx vitest run "server/src/services/shipping/__tests__/AusPostShippingTrackingAdapter.test.ts" "server/src/services/shipping/__tests__/ShippingTrackingService.test.ts"` passes with 12 tests.
- `git diff --check` passes.

### Blocked Verification

- Full server typecheck is blocked by existing TypeScript 6 deprecation handling in `@overseek/core` before server code is checked.
- Direct server typecheck also reports existing missing dependency/type issues in this worktree.
- Client build is blocked by existing missing React/router/lucide type/module resolution errors in this worktree.

### Next

- Generate/apply Prisma schema changes in the Docker dev environment.
- Add the remaining AusPost shipment validation, label creation/PDF storage, cancellation, and transaction adapters.
- Replace or wrap the minimal print agent with a production installer/service when ready.
- Replace development tracking event ingestion with the real AusPost polling adapter once raw event mappings are confirmed.

### Decisions

- Hub action creates the AusPost label and sends it to print in one workflow.
- Reprints use the locally stored label and must not create a new AusPost label.
- Bulk create/print supports partial success.
- AusPost tracking is polling-based because webhooks are not supported for this workflow.
