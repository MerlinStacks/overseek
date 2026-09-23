# Existing-order email snapshot v1

Email support is for existing orders only. Never calculate dates at send time or select a different/latest order for a real transactional send. Missing/invalid legacy snapshots resolve to blank; the block hides completely.

## Persisted snapshot

Woo metadata key: `_overseek_delivery_estimate_v1`.
Overseek `WooOrder.deliveryEstimateSnapshot`: nullable JSON, immutable first valid snapshot.

```ts
type DeliveryDateRange = { min: string; max: string }; // strict local YYYY-MM-DD labels, ordered
type DeliveryEstimateSnapshot = {
  version: 1;
  capturedAt: string; // valid UTC ISO instant, not refreshed during sync/send
  timezone: string; // validated IANA identifier
  fulfilmentType: 'delivery' | 'collection';
  method: { methodId: string; instanceId: number; rateId: string; title: string };
  dispatch: DeliveryDateRange;
  delivery: DeliveryDateRange | null; // required for delivery, null for collection
  collection: DeliveryDateRange | null; // required for collection, null for delivery
};
```

Reject extra/missing keys, impossible/reversed dates, invalid identities, overlarge strings/payloads, mixed fulfilment branches and arrival endpoints before dispatch endpoints. No suppliers, prices, stock, customer addresses or current settings in this snapshot. Max encoded size 8 KiB. Labels are date-only; format them without timezone-shifting the day.

## Shared core API (`@overseek/core`)

Add dependency-free shared parsing/rendering utilities exported from the root:

- `DeliveryEstimateSnapshot`, `DeliveryDateRange`, `DeliveryEstimateEmailOptions` types.
- `parseDeliveryEstimateSnapshot(value: unknown): DeliveryEstimateSnapshot | null`.
- `getOrderDeliveryEstimateSnapshot(order: unknown): DeliveryEstimateSnapshot | null`: prefer an explicitly present persisted `deliveryEstimateSnapshot`, otherwise inspect Woo `meta_data` or nested `rawData` metadata. Never choose an unrelated order. A present-but-invalid persisted field is not permission to trust other raw metadata. Conflicting duplicate metadata is invalid.
- `getDeliveryEstimateTagValues(order: unknown): Record<string, string>`: return all supported tag names below mapped to formatted strings or blank, even when order is absent. Dates use consistent `en-AU` day/month/year formatting; equal ranges render one date.
- `renderDeliveryEstimateEmailBlock(order: unknown, options?: DeliveryEstimateEmailOptions): string`: compact email-safe inline-styled table, escaped text, completely empty when no valid snapshot. Auto heading is Estimated delivery / Estimated collection. Optional dispatch line.
- `resolveDeliveryEstimateEmailTokens(template: string, order: unknown): string`: resolve scalar tags (including fallback syntax consistent with existing designer) and `{{delivery_estimate ...}}` block tokens; missing context never leaves these tokens unresolved. Share this function between server and designer preview.

Scalar names: `order.estimatedDelivery`, `order.estimatedDeliveryStart`, `order.estimatedDeliveryEnd`, `order.estimatedDispatch`, `order.estimatedDispatchStart`, `order.estimatedDispatchEnd`, `order.estimatedCollection`, `order.estimatedCollectionStart`, `order.estimatedCollectionEnd`, `order.estimatedFulfilment` (delivery or collection range).

Block token: `{{delivery_estimate heading:<URI-encoded-text> showDispatch:true|false textColor:<URI-encoded-hex> mutedColor:<URI-encoded-hex> backgroundColor:<URI-encoded-hex> accentColor:<URI-encoded-hex> fontFamily:<URI-encoded-font-stack>}}`. All parameters optional; parser must limit/validate decoded strings and styles, never accept arbitrary CSS. `heading` empty means automatic fulfilment-specific label. `DeliveryEstimateEmailOptions` properties match these names; defaults should remain restrained. Compiler emits theme colours and a validated font stack explicitly so server output matches preview. Block is content only; do not leave an empty heading/card when snapshot is missing.

## Integration requirements

- Order sync sets snapshot once from valid Woo metadata, never overwrites an existing valid snapshot on later imports or metadata deletion. CAS for concurrent initial ingestion. Preserve original capturedAt and date labels.
- Automation email context must hydrate the exact persisted account/order where needed; never infer an arbitrary first product or newest order. Use account-scoped queries, preserve existing raw order fields and attach persisted snapshot explicitly.
- Standalone test email may intentionally use its existing latest-order sample behaviour, but show/use the same persisted snapshot in designer preview and test send. Campaign test without order stays blank. Explicit sample previews, if offered, must be labeled; do not fabricate dates in normal latest-order preview.
- Email designer block type: `deliveryEstimate`, props `{ heading: string; showDispatch: boolean }` plus normal BaseBlock layout fields. Add factory, palette, settings, live rendering, labels, compiler, saved-design compatibility and merge-tag registry entries.
- No automatic insertion into templates or existing emails. Existing designs remain unchanged unless merchants add the block/tags.
- Plugin snapshot factory/storage is callable only in this stage, not wired to checkout/display yet. Use WC_Order CRUD/HPOS-compatible metadata, first-write-only, with robust validation and no network calls. Do not save synthetic or unavailable calculations as order promises. Actual checkout capture requires the final verified storefront integration.
