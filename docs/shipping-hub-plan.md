# Shipping Hub Feature Plan

## Goal

Add an account-gated Shipping Hub to OverSeek for creating, printing, tracking, and auditing shipping labels from WooCommerce orders. The first carrier target is Australia Post / MyPost Business, with the architecture kept open for additional carriers later.

## Locked Scope For Confirmation

- Add a separate sidebar menu group named `Shipping`.
- Gate the entire feature behind an account feature flag.
- Use feature key: `SHIPPING_HUB`.
- Initial carrier target: Australia Post Shipping and Tracking API for MyPost Business label workflows.
- Operational trigger: WooCommerce orders enter the hub when their order status is `In Dispatch`.
- Staff must be able to create labels one order at a time or in bulk.
- Silent remote printing is required. Browser print dialog is not enough for the target workflow.
- Label creation and printing are one operational action from the hub. Reprints must reuse the same locally stored label from Past Labels / Invoices and must not create a new AusPost label.
- Order details must include shipment monitoring from AusPost so staff can see where the parcel is in AusPost's system.
- The new shipment monitoring UI will replace the existing `Shipment Tracking` panel on the order detail page.
- AusPost scan events must be usable as email flow triggers, for example received by AusPost and out for delivery.
- AusPost does not support webhooks for this workflow, so tracking and scan-event automation must be polling based.
- Do not expose any shipping routes, pages, API endpoints, or worker actions unless the selected account has `SHIPPING_HUB` enabled.

## Sidebar Structure

The new sidebar item should appear as its own group, not inside Commerce.

```text
Shipping
- Hub
- Packages
- Item Overwrites
- Past Labels / Invoices
- Settings
```

Proposed frontend routes:

| Menu item | Route | Purpose |
| --- | --- | --- |
| Hub | `/shipping` | Main shipping workspace for ready-to-ship orders, label creation, and shipment status. |
| Packages | `/shipping/packages` | Manage reusable package presets, satchels, boxes, dimensions, and weights. |
| Item Overwrites | `/shipping/item-overwrites` | Override product-level shipping data such as packed weight, dimensions, dangerous goods flags, package rules, and customs metadata. |
| Past Labels / Invoices | `/shipping/labels` | Search previous labels, reprint labels, view label PDFs, download carrier invoices/manifests where supported, and audit charges. |
| Settings | `/shipping/settings` | Configure Australia Post credentials, sender address, default service rules, printer preferences, and fulfilment behavior. |

## Feature Gating

Current repository patterns already support account-level flags through `AccountFeature` and `useAccountFeature`.

Implementation direction:

- Add sidebar visibility check using `useAccountFeature('SHIPPING_HUB')`.
- Add route protection using existing `FeatureGuard featureKey="SHIPPING_HUB"`.
- Add backend checks using `isAccountFeatureEnabled(accountId, 'SHIPPING_HUB', false)` on all shipping API routes.
- Store carrier config in account-scoped models and/or `AccountFeature.config`, depending on sensitivity and structure.
- Never default-enable this feature for legacy accounts.

## Core Workflows

## Recommended Build Path

The best path is to build this as an operational dispatch system, not as a generic shipping settings area first. The order of work should mirror staff usage:

- Configure sender, AusPost billing/payment method, and package presets.
- Detect `In Dispatch` orders and surface them in the Shipping Hub.
- Auto-select the best package where possible.
- Allow staff to override package, dimensions, weight, service, and print target before label creation.
- Create labels in bulk or one at a time.
- Send labels to a registered print station without a browser print dialog.
- Store every label, tracking number, print event, carrier response, and WooCommerce sync result.
- Monitor AusPost tracking events after label creation and surface them on the order detail page.
- Convert important AusPost scan events into email automation triggers so customer messaging can react to shipment progress.

This means the MVP should not wait for advanced package automation before staff can ship. Manual package override must be first-class from day one.

## Current Staff Workflow To Match

Setup workflow:

- Staff create package records in `Shipping > Packages`.
- Each package stores internal dimensions, outer/carrier dimensions, maximum allowed packed weight, fallback item weight, forced package weight if required, and packaging material weight.
- Staff configure sender details in `Shipping > Settings`.
- Staff configure the AusPost payment method selected/required by MyPost Business.
- Staff configure any additional AusPost-required shipment defaults.

Dispatch workflow:

- WooCommerce order moves into `In Dispatch` status.
- OverSeek detects the status and displays the order in `Shipping > Hub`.
- OverSeek attempts to select a package automatically using order items, item weights, package limits, and item overrides.
- If the package cannot be determined, staff select a package manually.
- Staff can also enter one-off dimensions and weight for the selected order/package.
- Staff select one or more orders.
- Staff bulk print labels or single print a label. This creates the AusPost label and sends it to the selected print station in the same workflow.
- OverSeek stores created labels and tracking details, then syncs tracking/fulfilment information back to WooCommerce according to settings.
- Staff can open the order detail page and see live/last-synced AusPost shipment progress instead of the legacy shipment tracking block.
- Email flows can be triggered from normalized AusPost scan states such as received by carrier, in transit, out for delivery, attempted delivery, delivered, and exception.

## 1) Shipping Hub

Primary operational page for warehouse/admin users.

MVP capabilities:

- List WooCommerce orders currently in `In Dispatch` status.
- Show customer, destination, order items, current shipping method, order status, and existing tracking state.
- Validate whether each order has enough shipping data to create a label.
- Validate addresses before label creation.
- Auto-select a package preset where possible.
- Allow staff to change the selected package.
- Allow staff to enter one-off dimensions and weights for a specific order.
- Compare available AusPost services and prices where API access allows it.
- Create shipment, store label, and print for one order as one action.
- Create shipments, store labels, and print in bulk for selected orders as one action.
- Print labels through a selected print station without showing a print dialog.
- Download label PDF as a fallback.
- Write tracking details back to OverSeek and WooCommerce.
- Mark order as fulfilled or partially fulfilled based on settings.

Later capabilities:

- Batch label generation.
- Pick/pack workflow.
- Scan-to-print.
- Bulk status updates.
- Exception queue for invalid addresses, missing weights, unsupported services, or API failures.
- Manual shipment creation for orders outside `In Dispatch` or for ad hoc shipments.

Bulk behavior:

- Bulk label creation/printing must allow partial success.
- If 10 orders are selected and 2 fail AusPost validation, the other 8 should still create labels and print.
- Failed orders must remain in the hub with clear per-order error states and recovery actions.
- Failed orders must not block successful orders from creating labels.
- Retrying failed orders must not recreate labels for orders that already succeeded.

Address validation:

- Address validation is a first-class readiness step before label creation.
- The hub should show whether the destination address is valid, needs correction, or could not be verified.
- Staff should be able to correct the shipping address for the shipment before label creation.
- Address corrections should be stored with the shipment/label payload and optionally synced back to WooCommerce only if a later explicit setting is enabled.
- Invalid or unverified addresses should block bulk label creation for that order only, not the whole batch.
- AusPost validation failures should be shown in plain language, with the raw carrier error available in diagnostics/audit details.

## 2) Packages

Manage reusable package definitions.

Data to capture:

- Name.
- Package type: custom box, satchel, envelope, tube, carrier product.
- Internal dimensions: length, width, height.
- Outer/carrier dimensions: length, width, height.
- Package weight when item weight is not defined.
- Optional forced package weight that ignores item weights.
- Packaging material weight.
- Maximum weight allowed in this package.
- Default carrier service preference.
- Active/inactive state.
- Optional carrier product code.

Rules:

- All package records must be scoped by `accountId`.
- Package selection should be deterministic so repeated label previews do not unexpectedly change costs.
- Package presets should be reusable by item overwrite rules and manual label creation.
- Outer/carrier dimensions are the dimensions sent to AusPost.
- Internal dimensions are used by OverSeek packing logic to decide what can fit.
- If item weights are missing, use the package fallback weight unless a forced package weight is set.
- Forced package weight overrides calculated item weight for that package.
- Total packed weight should be item/forced/fallback weight plus packaging material weight.
- Maximum weight must prevent package auto-selection and label creation when exceeded.

## 3) Item Overwrites

Product-level shipping overrides for cases where WooCommerce product data is incomplete or not accurate enough for label creation.

Data to capture:

- WooCommerce product ID and optional variation ID.
- Packed weight.
- Packed dimensions.
- Preferred package preset.
- Quantity packing behavior: ship individually, combine quantities, or custom rule.
- Dangerous goods / restricted item flags.
- Fragile flag.
- Customs description, country of origin, HS code, and declared value defaults for international support.
- Notes visible to packers.

Rules:

- Overrides must be account-scoped.
- Variation-specific overrides should win over parent product overrides.
- Overrides should not mutate WooCommerce product data unless a later explicit sync feature is added.

## 4) Past Labels / Invoices

Historical label, reprint, and MyPost Business transaction area.

This page should have two tabs:

- `Past Labels` - locally stored labels from the last 30 days that can be reprinted.
- `Invoices` - MyPost Business transaction records imported or retrieved from AusPost/MyPost Business where supported.

MVP capabilities:

- Search past labels by order number, customer, tracking number, carrier, service, date range, or label status.
- Reprint/download locally stored label PDFs for 30 days.
- View shipment payload summary and carrier response metadata.
- Show label lifecycle status: created, printed, manifested, cancelled, failed.
- Link back to the source order.
- Show tracking number and tracking URL.
- Show latest AusPost tracking status and tracking event timeline.
- Invoices tab should show MyPost Business transaction records, including transaction date, reference, tracking/shipment ID where available, service, charge amount, tax/GST, payment method, and reconciliation status.

Later capabilities:

- Carrier transaction/invoice import or reconciliation if AusPost/MyPost Business API access supports it.
- Manifest/batch close-out workflows if required by the carrier account type.
- Refund/cancel label flow where supported.

Label retention rules:

- Label PDFs must be stored locally for 30 days for operational reprinting.
- Reprinting from Past Labels must use the original stored label and must never create a new AusPost shipment.
- Labels older than 30 days may keep metadata but should not guarantee local PDF availability unless retention is extended later.
- If a stored PDF is missing inside the 30-day window, show a clear `PDF missing` recovery state.

## 5) Shipment Monitoring On Order Details

The order detail page currently has a `Shipment Tracking` sidebar panel based on synced WooCommerce tracking items. This should be replaced by the new Shipping Hub shipment monitoring panel when `SHIPPING_HUB` is enabled.

Target behavior:

- Show the current AusPost shipment state for labels created by OverSeek.
- Show tracking number, carrier, service, label created time, printed time, and latest tracking checkpoint.
- Show a chronological event timeline from AusPost, for example lodged, in transit, onboard for delivery, delivered, attempted delivery, awaiting collection, returned, or exception.
- Show last tracking sync time and a manual `Refresh tracking` action.
- Link to the AusPost public tracking page when available.
- Support multiple shipments/labels on one order if split shipments are enabled later.
- Continue showing legacy WooCommerce tracking items only as a fallback when no OverSeek shipping label exists or `SHIPPING_HUB` is disabled.

Normalized tracking states:

- `pending`
- `received_by_carrier`
- `in_transit`
- `out_for_delivery`
- `delivery_attempted`
- `awaiting_collection`
- `delivered`
- `exception`
- `returned`
- `cancelled`
- `expired`

Implementation direction:

- Replace the existing order detail `Shipment Tracking` panel with a Shipping Hub-aware component.
- Use the new OverSeek `ShippingLabel` and tracking event data as the source of truth for labels created through Shipping Hub.
- Keep the panel account-scoped and order-scoped.
- Do not rely only on WooCommerce tracking meta once OverSeek creates the label.
- Avoid creating duplicate tracking systems: WooCommerce receives tracking for customer/order compatibility, but OverSeek owns operational shipment monitoring.

## 6) Shipping Scan Events In Email Flows

AusPost scan events should become normalized OverSeek automation events. This allows flows such as:

- Send an email when AusPost first receives/lodges the parcel.
- Send an email when the parcel is out for delivery.
- Send an email when delivery is attempted but unsuccessful.
- Send an email when the parcel is delivered.
- Send an internal/customer email when there is a shipment exception.

Existing repository note:

- The flow builder already lists several Shipping trigger labels in `TriggerConfig.tsx`: `SHIPMENT_IN_TRANSIT`, `SHIPMENT_OUT_FOR_DELIVERY`, `SHIPMENT_DELIVERY_ATTEMPTED`, `SHIPMENT_DELIVERED`, and `SHIPMENT_EXCEPTION`.
- The Shipping Hub work should connect real AusPost scan events to these triggers and add the missing received/lodged trigger.

Recommended trigger types:

| Trigger type | Label | When it fires |
| --- | --- | --- |
| `SHIPMENT_RECEIVED_BY_CARRIER` | Shipment Received By AusPost | First AusPost scan confirms the parcel was lodged/received by AusPost. |
| `SHIPMENT_IN_TRANSIT` | Shipment In Transit | AusPost reports the parcel moving through its network. |
| `SHIPMENT_OUT_FOR_DELIVERY` | Shipment Out For Delivery | AusPost reports onboard/out for delivery. |
| `SHIPMENT_DELIVERY_ATTEMPTED` | Shipment Delivery Attempted | AusPost reports attempted delivery or awaiting collection after attempt. |
| `SHIPMENT_DELIVERED` | Shipment Delivered | AusPost reports delivered. |
| `SHIPMENT_EXCEPTION` | Shipment Exception | AusPost reports delay, return, held, failed delivery, address issue, or other exception state. |

Automation payload should include:

- `email`
- `billing.email`
- `orderId`
- `wooOrderId`
- `orderNumber`
- `customerName`
- `trackingNumber`
- `trackingUrl`
- `carrier`
- `serviceName`
- `shipmentStatus`
- `scanEventCode`
- `scanEventDescription`
- `scanEventLocation`
- `scanEventOccurredAt`
- `labelId`
- `shippingLabelId`

Backend behavior:

- `ShippingTrackingService` normalizes AusPost events and stores `ShippingTrackingEvent` rows.
- When a new tracking event maps to an automation trigger, call `automationEngine.processTrigger(accountId, triggerType, payload)`.
- Trigger dispatch must happen only for newly observed scan milestones, not every tracking refresh.
- The same label/event/trigger combination must not enroll the same customer repeatedly.
- For order-scoped dedupe, shipment trigger names should include `SHIPMENT` and AutomationEngine should treat them as order/shipment entity triggers during implementation.
- Trigger payload must include the customer email from the order billing/shipping data; if no email exists, log and skip automation enrollment.

Suggested scan normalization:

- AusPost lodged/accepted/received event -> `SHIPMENT_RECEIVED_BY_CARRIER`.
- AusPost in transit/processed/sorted/transferred event -> `SHIPMENT_IN_TRANSIT`.
- AusPost onboard for delivery/out for delivery event -> `SHIPMENT_OUT_FOR_DELIVERY`.
- AusPost attempted delivery/card left/awaiting collection due to failed delivery event -> `SHIPMENT_DELIVERY_ATTEMPTED`.
- AusPost delivered event -> `SHIPMENT_DELIVERED`.
- AusPost delayed/held/return to sender/address issue/damaged/lost event -> `SHIPMENT_EXCEPTION`.

Flow builder behavior:

- Add `SHIPMENT_RECEIVED_BY_CARRIER` to the Shipping trigger group.
- Keep existing Shipping triggers visible only when the account has email automation access and Shipping Hub is enabled, if feature-based trigger filtering is available.
- Add optional trigger filters for service, destination country/state, order value, product/category, and shipment status.
- Email templates should support shipping merge tags such as tracking number, tracking URL, service name, latest scan description, and estimated delivery if AusPost provides it.

Customer messaging safety:

- Do not send duplicate emails for repeated carrier scans with the same milestone.
- Account-level frequency caps and quiet hours should apply normally.
- Delivered and out-for-delivery flows should not fire for cancelled/refunded orders unless explicitly allowed.
- Exception flows should be able to notify staff only, customers only, or both depending on flow actions.

Scan-event mapping rules:

- An explicit AusPost raw event mapping table is required before shipment flow triggers are enabled for customers.
- Unknown or unmapped AusPost events should be stored and displayed for staff, but must not trigger customer emails.
- The mapping table should include raw AusPost event code, raw description pattern where needed, normalized tracking state, automation trigger type, terminal-state flag, and customer-email-safe flag.
- Customer-facing scan-event flows should remain disabled until the mapping table has been reviewed against real AusPost responses.
- AusPost does not support webhooks for this workflow, so tracking refresh and scan-event triggers must be polling based.

## 7) Settings

Account-level shipping configuration.

Settings to include:

- Enable/disable shipping automation for the account.
- Australia Post API key and secret storage.
- MyPost Business account/customer identifiers required by the API.
- AusPost payment method / charge account selected by or required by MyPost Business.
- Sender/from address and contact details.
- Dispatch order status trigger, default `In Dispatch`.
- Default domestic service.
- Default express service.
- Default international service when supported.
- Default package fallback.
- Label format: PDF for MVP, ZPL later if AusPost and printer workflow support it.
- Default print station and label printer.
- WooCommerce fulfilment behavior after label creation.
- Tracking sync behavior.
- Test connection button.

Permission requirements:

- `view_shipping` - view Shipping menu, hub, labels, shipment monitoring, and package data.
- `manage_shipping_settings` - edit AusPost credentials, sender details, payment method, tracking sync, print stations, and fulfilment behavior.
- `create_shipping_labels` - create single or bulk labels from the hub.
- `print_shipping_labels` - print and reprint labels.
- `cancel_shipping_labels` - cancel/refund labels where supported.
- `manage_shipping_packages` - create/edit packages and item overwrites.

Security rules:

- Secrets must not be returned to the client after save.
- Client should only receive masked credential status, for example `configured: true` and last 4 characters if useful.
- Server logs must never include API secrets, full labels if sensitive, or full customer payloads beyond existing logging policy.

## Proposed Data Model

Exact Prisma names can be adjusted during implementation, but this is the expected shape.

## `ShippingCarrierAccount`

Stores account-level carrier configuration.

Fields:

- `id`
- `accountId`
- `carrier`: initially `AUSPOST`
- `displayName`
- `isEnabled`
- `credentialsEncrypted`
- `config`
- `senderAddress`
- `lastTestedAt`
- `lastTestStatus`
- `createdAt`
- `updatedAt`

Indexes:

- `@@index([accountId])`
- unique account/carrier/display name if multiple carrier accounts are not needed initially.

## `ShippingPackagePreset`

Stores package presets.

Fields:

- `id`
- `accountId`
- `name`
- `type`
- `innerLengthMm`
- `innerWidthMm`
- `innerHeightMm`
- `outerLengthMm`
- `outerWidthMm`
- `outerHeightMm`
- `fallbackItemWeightGrams`
- `forcedPackageWeightGrams`
- `packagingWeightGrams`
- `maxWeightGrams`
- `selectionPriority`
- `carrierProductCode`
- `isDefault`
- `isActive`
- `createdAt`
- `updatedAt`

Indexes:

- `@@index([accountId])`

## `ShippingItemOverride`

Stores product/variation packing rules.

Fields:

- `id`
- `accountId`
- `wooProductId`
- `wooVariationId`
- `packagePresetId`
- `weightGrams`
- `lengthMm`
- `widthMm`
- `heightMm`
- `packingMode`
- `dangerousGoods`
- `fragile`
- `customsDescription`
- `countryOfOrigin`
- `hsCode`
- `notes`
- `createdAt`
- `updatedAt`

Indexes:

- `@@index([accountId])`
- unique account/product/variation constraint.

## `ShippingLabel`

Stores label lifecycle and audit metadata.

Label lifecycle statuses:

- `draft`
- `ready`
- `blocked`
- `creating`
- `created`
- `print_queued`
- `station_offline`
- `printed`
- `print_failed`
- `cancelled`
- `failed`
- `refunded`

Fields:

- `id`
- `accountId`
- `orderId`
- `wooOrderId`
- `carrier`
- `carrierAccountId`
- `carrierShipmentId`
- `carrierLabelId`
- `trackingNumber`
- `trackingUrl`
- `latestTrackingStatus`
- `latestTrackingSummary`
- `trackingSyncedAt`
- `serviceCode`
- `serviceName`
- `status`
- `labelFormat`
- `labelFilePath` or artifact reference
- `labelStoredUntil`
- `costAmount`
- `costCurrency`
- `requestSnapshot`
- `responseSnapshot`
- `errorMessage`
- `createdByUserId`
- `createdAt`
- `printedAt`
- `cancelledAt`
- `updatedAt`

Indexes:

- `@@index([accountId])`
- `@@index([accountId, orderId])`
- `@@index([accountId, trackingNumber])`
- `@@index([accountId, createdAt])`

## `ShippingShipmentDraft`

Stores editable shipment state before label creation/printing. This supports staff package overrides, address validation, rate selection, and bulk retry without creating carrier labels too early.

Fields:

- `id`
- `accountId`
- `orderId`
- `wooOrderId`
- `status`
- `readinessStatus`
- `readinessErrors`
- `selectedPackagePresetId`
- `packageSelectionConfidence`
- `packageSelectionReason`
- `manualOuterLengthMm`
- `manualOuterWidthMm`
- `manualOuterHeightMm`
- `manualWeightGrams`
- `addressValidationStatus`
- `addressValidationErrors`
- `correctedAddress`
- `selectedServiceCode`
- `selectedPrintStationId`
- `lastRateRequest`
- `lastRateResponse`
- `updatedByUserId`
- `createdAt`
- `updatedAt`

Indexes:

- `@@index([accountId])`
- `@@index([accountId, orderId])`

## `ShippingTrackingEvent`

Stores normalized tracking checkpoints from AusPost.

Fields:

- `id`
- `accountId`
- `labelId`
- `carrier`
- `trackingNumber`
- `eventCode`
- `normalizedMilestone`
- `normalizedState`
- `status`
- `description`
- `location`
- `occurredAt`
- `automationDispatchedAt`
- `automationTriggerType`
- `rawEvent`
- `createdAt`

Indexes:

- `@@index([accountId])`
- `@@index([accountId, labelId])`
- `@@index([accountId, trackingNumber])`
- unique event identity if AusPost provides stable event IDs or stable event timestamps/codes.

## `ShippingAutomationDispatch`

Stores scan-event automation dispatch idempotency.

Fields:

- `id`
- `accountId`
- `labelId`
- `trackingEventId`
- `triggerType`
- `email`
- `status`
- `errorMessage`
- `dispatchedAt`
- `createdAt`

Indexes:

- `@@index([accountId])`
- `@@index([accountId, labelId])`
- unique `accountId`, `trackingEventId`, `triggerType`, and `email`.

## `ShippingPrintStation`

Stores registered local print agents that can receive print jobs without browser dialogs.

Fields:

- `id`
- `accountId`
- `name`
- `stationTokenHash`
- `tokenRotatedAt`
- `agentVersion`
- `minimumSupportedVersion`
- `status`
- `lastSeenAt`
- `lastErrorCode`
- `lastErrorMessage`
- `defaultPrinterName`
- `capabilities`
- `createdAt`
- `updatedAt`

Indexes:

- `@@index([accountId])`

## `ShippingPrintJob`

Stores print job state and audit history.

Fields:

- `id`
- `accountId`
- `labelId`
- `printStationId`
- `printerName`
- `status`
- `attempts`
- `errorMessage`
- `reassignedFromStationId`
- `requestedByUserId`
- `requestedAt`
- `pickedUpAt`
- `printedAt`
- `updatedAt`

Indexes:

- `@@index([accountId])`
- `@@index([accountId, printStationId])`
- `@@index([accountId, status])`

## `ShippingAuditEvent`

Stores operational audit history for shipping actions.

Fields:

- `id`
- `accountId`
- `orderId`
- `labelId`
- `draftId`
- `userId`
- `eventType`
- `beforeSnapshot`
- `afterSnapshot`
- `metadata`
- `createdAt`

Events to capture:

- Package changed.
- Dimensions/weight changed.
- Address corrected.
- Address validation run.
- Label created.
- Label printed.
- Label reprinted.
- Print job reassigned.
- Label cancelled/refunded.
- Tracking manually refreshed.
- WooCommerce sync succeeded/failed.
- Carrier API failure.

Indexes:

- `@@index([accountId])`
- `@@index([accountId, orderId])`
- `@@index([accountId, labelId])`

## `ShippingCarrierTransaction`

Stores MyPost Business transaction records for the Invoices tab.

Fields:

- `id`
- `accountId`
- `carrier`
- `carrierAccountId`
- `transactionId`
- `transactionDate`
- `reference`
- `trackingNumber`
- `carrierShipmentId`
- `serviceCode`
- `serviceName`
- `amount`
- `taxAmount`
- `currency`
- `paymentMethod`
- `status`
- `rawTransaction`
- `createdAt`
- `updatedAt`

Indexes:

- `@@index([accountId])`
- `@@index([accountId, transactionDate])`
- `@@index([accountId, trackingNumber])`
- unique `accountId`, `carrier`, and `transactionId`.

## Backend API Shape

All routes should live under `/api/shipping` and require auth plus account context.

Proposed endpoints:

- `GET /api/shipping/orders` - eligible orders and shipping readiness state.
- `POST /api/shipping/orders/:orderId/validate-address` - validate destination address.
- `GET /api/shipping/orders/:orderId/rates` - available services/rates for selected package data.
- `PATCH /api/shipping/orders/:orderId/draft` - update package, address, service, print station, dimensions, or weight before label creation.
- `POST /api/shipping/orders/:orderId/labels` - create the shipment label and queue/send the print job as one action.
- `POST /api/shipping/labels/bulk` - create labels and queue/send print jobs for selected orders with partial success handling.
- `GET /api/shipping/labels` - list/search historical labels.
- `GET /api/shipping/labels/:id` - label details.
- `GET /api/shipping/labels/:id/download` - download label PDF.
- `GET /api/shipping/labels/:id/tracking` - tracking timeline for a label.
- `POST /api/shipping/labels/:id/tracking/refresh` - refresh tracking from AusPost for a label.
- `GET /api/shipping/orders/:orderId/shipments` - order detail shipment monitoring payload.
- `POST /api/shipping/labels/:id/print` - internal/recovery print job creation for an existing stored label, not normal hub label creation.
- `POST /api/shipping/labels/bulk-print` - reprint existing stored labels in bulk, not normal hub label creation.
- `POST /api/shipping/labels/:id/reprint` - reprint the locally stored label without creating a new AusPost label.
- `POST /api/shipping/labels/:id/cancel` - cancel/refund if supported.
- `GET /api/shipping/packages` - package presets.
- `POST /api/shipping/packages` - create package preset.
- `PATCH /api/shipping/packages/:id` - update package preset.
- `DELETE /api/shipping/packages/:id` - deactivate/delete package preset.
- `GET /api/shipping/item-overwrites` - list item overrides.
- `POST /api/shipping/item-overwrites` - create item override.
- `PATCH /api/shipping/item-overwrites/:id` - update item override.
- `DELETE /api/shipping/item-overwrites/:id` - delete item override.
- `GET /api/shipping/settings` - safe settings payload.
- `PATCH /api/shipping/settings` - update settings.
- `POST /api/shipping/settings/test-connection` - validate AusPost credentials.
- `GET /api/shipping/print-stations` - list registered print stations.
- `POST /api/shipping/print-stations` - create/register a print station token.
- `PATCH /api/shipping/print-stations/:id` - rename/default printer/settings.
- `DELETE /api/shipping/print-stations/:id` - disable a print station.
- `GET /api/shipping/print-agent/jobs` - print agent long-poll/SSE endpoint for pending print jobs.
- `POST /api/shipping/print-agent/jobs/:id/result` - print agent reports success/failure.
- `POST /api/shipping/print-stations/:id/rotate-token` - rotate station token.
- `POST /api/shipping/print-jobs/:id/reassign` - reassign queued/failed print job to another station.

API rules:

- Every query must filter by `accountId`.
- Every mutation must verify ownership with `accountId` before updating/deleting.
- Use Zod `.safeParse()` for all body/query validation.
- Use service classes for carrier and label business logic.
- Use `Logger`, never `console.log`.
- Enforce shipping permissions in addition to the account feature flag.

## Services

Proposed service files:

- `server/src/services/shipping/ShippingLabelService.ts`
- `server/src/services/shipping/ShippingPackageService.ts`
- `server/src/services/shipping/ShippingItemOverrideService.ts`
- `server/src/services/shipping/AusPostShippingService.ts`
- `server/src/services/shipping/ShippingCredentialService.ts`
- `server/src/services/shipping/ShippingPackingService.ts`
- `server/src/services/shipping/ShippingPrintService.ts`
- `server/src/services/shipping/ShippingTrackingService.ts`
- `server/src/services/shipping/ShippingAddressValidationService.ts`
- `server/src/services/shipping/ShippingAuditService.ts`

Responsibilities:

- Keep route handlers thin.
- Encapsulate AusPost request signing/auth, request validation, and response normalization.
- Normalize all carrier responses into OverSeek shipping label records.
- Keep label generation idempotency rules in one place.
- Avoid duplicate labels for the same order unless the user explicitly chooses to create another shipment.
- Encapsulate package auto-selection and weight calculation rules in `ShippingPackingService`.
- Encapsulate print station registration, job creation, polling, and result handling in `ShippingPrintService`.
- Encapsulate AusPost tracking refresh, normalization, event deduplication, and order-detail payloads in `ShippingTrackingService`.
- Dispatch normalized shipment scan events into email flows from `ShippingTrackingService` or a small `ShippingAutomationEventService`.
- Validate and normalize addresses before label creation in `ShippingAddressValidationService`.
- Record shipping audit events from all mutation services.

## Package Auto-Selection Rules

Initial deterministic logic:

- Read order line items and product/variation shipping metadata from synced WooCommerce data.
- Apply `ShippingItemOverride` first, with variation override winning over parent product override.
- Calculate packed dimensions if available from item/package rules.
- Calculate item weight from WooCommerce item weights or overrides.
- If item weight is missing, use package `fallbackItemWeightGrams`.
- If package `forcedPackageWeightGrams` is set, use it instead of summed item weight.
- Add package `packagingWeightGrams` to the calculated package weight.
- Exclude packages where total weight exceeds `maxWeightGrams`.
- Exclude packages where item dimensions cannot fit inside internal dimensions.
- Prefer the smallest package that fits, then lowest estimated cost if rates are available.
- If no confident match exists, mark the order as `needs_package` and require staff selection.

Package selection confidence values:

- `exact_override` - item/order override selected a package directly.
- `fits_by_dimensions` - package selected because item dimensions fit and weight is valid.
- `fallback_weight_used` - package selected but one or more item weights were missing and fallback package weight was used.
- `manual_required` - package could not be confidently selected.
- `overweight` - order exceeds all available package max weights or selected package max weight.
- `missing_dimensions` - item/order dimensions are insufficient for automated package selection.

Unit and rounding rules:

- Database and server APIs store dimensions in millimetres and weights in grams.
- UI may display package dimensions in centimetres and weights in kilograms for staff convenience.
- All UI inputs must convert to mm/grams before saving.
- Values sent to AusPost must use the units and rounding expected by the AusPost endpoint.
- Before rating or label creation, package dimensions and weight must be rounded up, never down.
- Rounding rules must be implemented in one shared shipping utility so hub rates, label creation, and audit snapshots match.

Manual override rules:

- Staff can change the package for an order before label creation.
- Staff can enter one-off outer dimensions and packed weight before label creation.
- One-off order-level overrides should be saved with the pending shipment/label draft, not as a product overwrite unless staff explicitly saves it as an item overwrite later.

## Queue And Worker Needs

Single label creation can be synchronous if API response time is acceptable. Bulk label creation and silent printing should be queue-backed from the start so staff can process multiple `In Dispatch` orders without waiting on each carrier or printer response in the browser.

Queue-backed tasks should be planned for:

- Batch label creation.
- Label PDF artifact generation/download retries.
- Tracking refresh.
- WooCommerce fulfilment sync retry.
- Carrier invoice reconciliation if added later.
- Print job dispatch and retry.

Potential queue names:

- `shipping-label-create`
- `shipping-tracking-sync`
- `shipping-woo-fulfillment-sync`
- `shipping-print-job`

Tracking worker behavior:

- Refresh labels more frequently while they are in active states such as lodged, in transit, onboard for delivery, awaiting collection, or exception.
- Stop or slow refresh after terminal states such as delivered, cancelled, returned, or expired.
- Allow manual refresh from order detail and label history pages.
- Deduplicate carrier events so refreshes do not create repeated timeline rows.
- Persist raw AusPost event data for diagnostics while exposing normalized statuses to the UI.
- Dispatch email automation triggers only after storing a new normalized milestone.
- Record automation dispatch attempts so retries do not create duplicate customer emails.
- Polling is required because AusPost does not support webhooks for this workflow.

## Silent Remote Printing

Silent remote printing cannot be done reliably from a normal browser because browsers intentionally require a print dialog for security. The correct architecture is a small local print agent installed on the warehouse/dispatch computer that has access to the label printer.

Recommended approach:

- Build an OverSeek Print Agent as a small desktop/background program.
- The print agent registers to an OverSeek account using a generated station token.
- The print agent runs on the computer connected to the label printer.
- The print agent polls or holds an SSE/WebSocket connection to OverSeek for print jobs.
- OverSeek sends label PDF/ZPL data or a secure one-time download URL to the print agent.
- The print agent prints directly to the configured printer without a browser dialog.
- The print agent reports success/failure back to OverSeek.
- OverSeek shows station status, last seen, default printer, and failed job details in Settings.

MVP print agent options:

- Node.js tray/background app using local OS print commands.
- Electron app if we need a simple UI for login, printer selection, and diagnostics.
- Windows service later if warehouse PCs need no logged-in user.

MVP recommendation:

- Start with an Electron or Node-based desktop print agent for Windows, because warehouse label printers are usually attached to Windows dispatch machines.
- Use PDF labels first because AusPost label PDF output is the most portable.
- Add ZPL support later for thermal-printer-native workflows if AusPost returns ZPL and the printer supports it.

Print safety rules:

- Print station tokens must be scoped to one account.
- A print station can only fetch jobs assigned to it.
- Print station tokens must support rotation from Settings.
- Print station requests must include agent version so OverSeek can warn/block unsupported agents.
- Settings should show agent version, minimum supported version, last seen, last error, and default printer.
- Define an update strategy before production rollout: manual update for MVP, auto-update later if needed.
- Print jobs should use short-lived artifact URLs or server-streamed binary data.
- Every print job needs status: queued, picked_up, printed, failed, cancelled.
- If a print station is offline, jobs remain queued in OverSeek with status `station_offline` or a clear station-offline reason.
- Staff must be able to reassign queued or failed print jobs to another online print station.
- Staff must be able to reprint a label from Past Labels / Invoices.
- Failed print jobs must not create duplicate carrier labels.

Create-and-print rule:

- From the hub, staff action should create the AusPost label and send it to the print station in one workflow.
- If label creation succeeds but printing fails, the order should show label created / print failed with a reprint action.
- Reprint must use the stored local label PDF and must not call AusPost label creation again.
- The system should never hide a successfully created label just because printing failed.

## WooCommerce Integration

After label creation, OverSeek should update WooCommerce with tracking data using the existing account/store integration path.

Order intake behavior:

- Shipping Hub should only include orders matching the configured dispatch status, defaulting to `In Dispatch`.
- The status match should use the WooCommerce status slug stored by sync, not display text only.
- Orders with existing active labels should be shown as labelled/printed rather than recreated by default.
- Orders cancelled, refunded, completed, or moved out of dispatch should leave the active hub list but remain available in history.
- When a label is created, printed, reprinted, cancelled/refunded, tracking exception occurs, or WooCommerce sync fails, OverSeek should add an internal WooCommerce order note where API access allows it.

Required behavior to confirm:

- Which WooCommerce tracking plugin/meta format should be written first.
- Whether order status should change to `completed`, remain `In Dispatch`, move to another configured status, or be configurable after label creation/print.
- Whether partial fulfilment is needed for split shipments.
- Whether Ready To Ship compatibility/import is needed for historical data.
- Whether WooCommerce order notes should be enabled by default or configurable.

The repository already has tracking metadata extraction utilities, so implementation should reuse existing conventions where possible rather than inventing a separate tracking format.

## Australia Post / MyPost Business Integration Notes

Open confirmation with AusPost is required before build:

- Confirm the API key has label creation access, not tracking-only access.
- Confirm whether MyPost Business label creation is supported for the supplied credentials.
- Confirm authentication method, account identifiers, available services, label format support, cancellation/refund support, and rate quote support.
- Confirm whether manifests, invoices, or charge reconciliation are available through the same API.

Expected MVP carrier actions:

- Test credentials.
- Validate destination/service availability if endpoint exists.
- Get rates if endpoint exists.
- Create shipment.
- Retrieve label PDF.
- Retrieve tracking URL/status.
- Retrieve tracking event history where supported by the AusPost API.
- Cancel shipment if supported.
- Use the configured AusPost payment method/charge account when creating labels.

Failure recovery UX:

- AusPost API down: keep orders in hub, show carrier unavailable, allow retry later, do not create duplicate labels.
- Invalid credential: block label creation, show settings/test-connection recovery path.
- Payment method rejected: block affected orders, show payment method recovery path in settings.
- Address invalid: keep order in hub, show address correction action.
- Overweight package: keep order in hub, show package/dimensions/weight correction action.
- Printer offline: create/store label if carrier creation succeeded, queue print job as station offline, allow reassign/reprint.
- PDF missing: show local label missing state and carrier re-download option only if AusPost supports safe label retrieval, otherwise require support/admin recovery.
- WooCommerce sync failed: keep label valid, show sync failed state, allow retry sync, add audit event.
- Tracking refresh failed: keep last known tracking state, show stale tracking warning, allow manual refresh.

## Email Automation Integration

Implementation should use the existing automation entry point:

```ts
automationEngine.processTrigger(accountId, triggerType, payload)
```

Required implementation updates:

- Add `SHIPMENT_RECEIVED_BY_CARRIER` to frontend trigger options.
- Ensure all Shipping trigger types map to the correct icon/label in flow node summaries.
- Ensure AutomationEngine dedupe/entity logic treats shipment triggers as order/shipment scoped, not account-wide customer-only triggers.
- Include order and shipment context in `contextData` so flow emails can render shipment merge tags.
- Add merge tags for tracking number, tracking URL, AusPost status, latest scan location, latest scan time, service name, and order number.
- Add tests proving repeated tracking refreshes do not send duplicate flow emails.

## Frontend Pages

Suggested page files:

- `client/src/pages/shipping/ShippingHubPage.tsx`
- `client/src/pages/shipping/ShippingPackagesPage.tsx`
- `client/src/pages/shipping/ShippingItemOverwritesPage.tsx`
- `client/src/pages/shipping/ShippingLabelsPage.tsx`
- `client/src/pages/shipping/ShippingSettingsPage.tsx`

Suggested shared components:

- `client/src/components/shipping/ShippingOrderTable.tsx`
- `client/src/components/shipping/ShippingReadinessBadge.tsx`
- `client/src/components/shipping/PackageSelector.tsx`
- `client/src/components/shipping/RateSelector.tsx`
- `client/src/components/shipping/LabelPreviewDialog.tsx`
- `client/src/components/shipping/AusPostSettingsForm.tsx`
- `client/src/components/shipping/PrintStationSelector.tsx`
- `client/src/components/shipping/ShippingBulkActionBar.tsx`
- `client/src/components/shipping/ShipmentMonitoringPanel.tsx`
- `client/src/components/shipping/ShipmentTrackingTimeline.tsx`

Design direction:

- Follow existing glass card pattern and dark mode variants.
- Use clear operational states: ready, missing package data, invalid address, label created, printed, failed.
- Keep the hub fast for warehouse usage with dense tables and batch actions.
- Match the Ready To Ship-style operational density: checkbox selection, order details, service, date, item count, packages, completed steps, and action buttons.
- Make package editing inline in the hub so staff do not have to leave the dispatch queue to fix a shipment.
- On `OrderDetailPage`, replace the current `Shipment Tracking` sidebar panel with `ShipmentMonitoringPanel` when `SHIPPING_HUB` is enabled.

## Rollout Phases

## Phase 1 - Planning And API Confirmation

- Confirm AusPost credential capabilities.
- Confirm exact MyPost Business endpoints and limits.
- Confirm WooCommerce fulfilment behavior.
- Confirm exact WooCommerce status slug for `In Dispatch`.
- Confirm AusPost payment method/charge account fields required for label creation.
- Confirm first target OS for the print agent, expected Windows unless corrected.
- Confirm label printer model and preferred label size.
- Confirm AusPost dimension/weight rounding rules for rating and label creation.

## Phase 2 - Foundation

- Add Prisma models.
- Add backend route skeleton under `/api/shipping`.
- Add service skeletons.
- Add account feature checks.
- Add sidebar group and lazy frontend routes behind `SHIPPING_HUB`.

## Phase 3 - Settings And Packages

- Build settings page.
- Store and test AusPost credentials securely.
- Store sender details and AusPost payment method.
- Store dispatch status trigger, default `In Dispatch`.
- Build package preset CRUD.
- Include internal dimensions, outer dimensions, fallback item weight, forced package weight, packaging weight, and max weight.
- Add basic item overwrite CRUD.
- Add print station registration and station status display.
- Add shipping permissions and enforce them on pages/actions.

## Phase 4 - Dispatch Hub And Single Label MVP

- Build shipping hub order list from `In Dispatch` orders.
- Add readiness checks.
- Add package auto-selection and inline package override.
- Add package selection confidence/reason display.
- Add address validation and correction flow.
- Add rate/service selection.
- Create a single label for one order.
- Store label record and PDF artifact.
- Download label PDF fallback.
- Sync tracking to WooCommerce.
- Add WooCommerce internal order notes for label/print/tracking/sync events where configured.
- Add order detail shipment monitoring panel for labels created by Shipping Hub.
- Preserve legacy shipment tracking display only as a fallback when Shipping Hub has no label data.

## Phase 4.5 - Shipping Flow Triggers

- Connect normalized tracking milestones to `automationEngine.processTrigger`.
- Add missing `SHIPMENT_RECEIVED_BY_CARRIER` trigger to the flow builder.
- Add shipping merge tags for flow emails.
- Add dispatch idempotency so repeated scans/refreshes do not send duplicates.
- Add basic trigger filters for shipment status/service where practical.

## Phase 5 - Silent Printing And Bulk Labels

- Build print agent MVP.
- Add print station selection.
- Add print job queue and result reporting.
- Add station token rotation, agent version reporting, last error diagnostics, and offline station handling.
- Add print job reassignment between print stations.
- Add single-label silent print.
- Add bulk label creation for selected orders.
- Add bulk print for selected labels/orders.

## Phase 6 - History And Operational Hardening

- Build Past Labels / Invoices page.
- Add tracking status and event timeline to Past Labels / Invoices.
- Add reprint/download flows.
- Add retry handling.
- Add audit metadata.
- Add `ShippingAuditEvent` views or diagnostic access for support/admin users.
- Add tests around ownership, feature gating, and label lifecycle.

## Phase 7 - Advanced Workflows

- Tracking refresh worker.
- Shipment exception alerts.
- Delivered/late/return monitoring reports.
- Advanced shipment flow filters and estimated-delivery triggers if AusPost provides ETA data.
- Manual shipment creation for orders outside `In Dispatch`.
- Split shipments.
- Cancellation/refunds.
- Carrier invoice reconciliation if supported.

## Testing Strategy

Server tests:

- Feature disabled returns forbidden/not found behavior for shipping routes.
- Account scoping prevents cross-account access to packages, overrides, and labels.
- Settings save masks secrets on read.
- Package CRUD validation.
- Item overwrite precedence rules.
- Package auto-selection, fallback weight, forced weight, packaging weight, and max weight rules.
- Package selection confidence/reason values are correct.
- Unit conversion and rounding rules are applied consistently for rates and label creation.
- Address validation blocks only invalid orders in a bulk batch.
- Label creation idempotency and duplicate prevention.
- Bulk label creation handles partial success/failure.
- Print station can only access its own account jobs.
- Print job success/failure does not create duplicate labels.
- Tracking refresh stores normalized events and deduplicates repeated AusPost events.
- Normalized terminal tracking states are assigned correctly.
- Order shipment monitoring only returns labels/events scoped to the selected account and order.
- New shipment milestones dispatch the correct email flow trigger.
- Repeated tracking refreshes do not dispatch duplicate flow triggers for the same label/milestone/customer.
- Shipment trigger payload includes order, customer, tracking, service, and scan event context.
- AusPost service mocked success/failure cases.
- Audit events are created for package changes, label creation, printing, reprinting, cancellation, tracking refresh, and sync failures.
- Shipping permissions block unauthorized users.

Client tests:

- Sidebar hides Shipping when `SHIPPING_HUB` is disabled.
- Routes redirect when feature disabled.
- Settings form does not reveal saved secrets.
- Package and item overwrite validation states.
- Label creation flow handles loading, success, and failure states.
- Hub lists only dispatch-status orders.
- Inline package override changes readiness/rate state.
- Address validation errors are visible and recoverable in the hub.
- Package selection confidence/reason is visible to staff.
- Bulk action bar enables/disables correctly based on selected order readiness.
- Print station selector shows offline/online status.
- Order detail replaces legacy shipment tracking with Shipping Hub shipment monitoring when enabled.
- Shipment timeline handles empty, active, delivered, and exception states.
- Flow builder includes `Shipment Received By AusPost` and the existing shipment scan triggers.
- Shipment flow trigger labels/icons render correctly in flow summaries.

Manual verification:

- Create label from a real test order in AusPost sandbox or approved test mode.
- Confirm an `In Dispatch` order appears in the hub.
- Download label PDF fallback.
- Print through the local print agent without a browser print dialog.
- Bulk create and print labels for selected orders.
- Confirm tracking metadata appears on the WooCommerce order.
- Confirm AusPost tracking events appear on the order detail shipment monitoring panel.
- Confirm the legacy shipment tracking panel is not shown for Shipping Hub labels.
- Confirm a received/lodged scan can trigger an email flow.
- Confirm an out-for-delivery scan can trigger an email flow.
- Confirm repeated tracking refreshes do not send duplicate scan-event emails.
- Confirm feature disabled account cannot access pages or API routes.
- Confirm unauthorized staff cannot create labels, reprint labels, cancel labels, or edit settings/packages without the correct permissions.

## Open Questions

- Does the supplied AusPost API credential include MyPost Business label creation, or only tracking/rates?
- Which AusPost account identifiers are required for billing/label creation?
- What AusPost payment methods/charge accounts are available and how are they represented in the API?
- What is the exact WooCommerce status slug for `In Dispatch`?
- Should MVP support domestic only, or domestic plus international?
- After label creation or successful print, should WooCommerce orders move to `completed`, remain `In Dispatch`, or move to another status?
- Should users be allowed to create multiple labels for the same order in MVP?
- What operating system will run the print agent first?
- What printer model and label format are used in dispatch?
- Should the print agent be manual-update only for MVP, or do we need auto-update from day one?
- Does the AusPost API credential expose full tracking event history or only current status?
- How often should active shipments be refreshed from AusPost?
- Should shipment exceptions trigger notifications or only appear on the order detail page initially?
- Which AusPost raw event codes should map to received by carrier, in transit, out for delivery, attempted delivery, delivered, and exception?
- Should shipment email flows be available only when both `EMAIL` and `SHIPPING_HUB` feature flags are enabled?
- Should shipment flow emails use account quiet hours/frequency caps by default?
- Should WooCommerce order notes be created by default for shipping events?
- Should manual shipment creation be MVP or post-MVP?
- Should Past Labels include only carrier labels, or also existing OverSeek invoice PDFs?
- Do we need Ready To Ship import/compatibility, or just feature parity going forward?
