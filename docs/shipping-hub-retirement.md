# Shipping Hub retirement

The Shipping Hub workspace, account feature control, carrier label APIs,
standalone print agent, and carrier tracking poller have been removed.
Old `/shipping` workspace URLs no longer expose the hub, and `/api/shipping`
routes are no longer registered.

## Preserved behavior

- Order details still show tracking numbers, providers, shipped dates, carrier
  links, and copy controls from the order's `tracking_items`.
- WooCommerce tracking metadata extraction and storefront tracking callbacks
  remain supported, independently of the retired hub.
- Delivery Estimates remains available. Its existing `view_shipping` and
  `manage_shipping_settings` permission keys are retained for compatibility;
  role management now labels them as delivery-estimate permissions.
- Historical shipping tables, stored labels, audit records, feature flags,
  and operation receipts are not deleted. There is no destructive database
  migration. Shipment automation compatibility for existing receipts remains.

## Deployment

Deploy the client and server together, and stop/uninstall any standalone
print agents. Scheduler startup removes the old `shipping-tracking-poll` and
`shipping-label-storage-cleanup` repeatable jobs. Already queued jobs with
those names are ignored, without carrier calls or storage deletion.
