# Purchase-triggered order sync

Both tracking ingestion endpoints (`POST /events` and `POST /e`) use authenticated
`purchase` events as a signal to fetch the referenced WooCommerce order.

- The request must carry the account's valid tracking bearer token. Legacy unsigned
  tracking remains supported, but cannot enqueue order fetches.
- Only a valid `payload.orderId` (or `payload.order_id`) is admitted. Order totals,
  status, customer details and metadata always come from that account's Woo API.
- Admission is awaited before returning success. If Redis is unavailable or the
  order queue is backpressured, ingestion returns an error so the plugin can retry.
- The existing order queue processes these jobs at priority 1. BullMQ deduplicates
  by account and order for five minutes, including repeats after job completion.
  Fetch failures retry up to five attempts with exponential backoff starting at
  two seconds, covering orders not yet visible through the Woo API.
- The existing order import transaction maintains customer totals, contacts,
  delivery snapshots and lifecycle records; its usual tagging/indexing and event
  handling also run. A targeted import never reconciles/deletes unrelated orders,
  scans the whole store, or advances the account-wide order sync checkpoint.

Woo webhooks and periodic sync remain unchanged as fallbacks and to pick up later
order changes. The purchase signal queues work immediately; it does not wait for
the Woo fetch to finish before acknowledging tracking. An already-running order
sync can delay execution until the existing worker becomes available.

## Live store updates (companion 2.25.13)

- After a targeted order import, enqueue one refresh per unique line-item parent
  product. Fetch the parent and its variations uncached through the existing
  product importer, preserving local COGS and other Overseek-owned fields. Never
  subtract ordered quantities locally. Each order/change occurrence has its own
  deduplication key, so consecutive purchases cannot suppress one another's work.
- Dedicated `order_changed` signals cover payment completion, status changes,
  refunds and stock reductions/restorations. `customer_changed` covers registration,
  login and Woo customer updates; `review_changed` covers submission, editing and
  moderation. Server admission requires an account token, valid entity ID and
  occurrence ID. All use targeted imports without advancing sweep checkpoints or
  reconciling unrelated records. Pending/spam/trashed reviews retain their remote
  status and cannot trigger approved-review actions.
- These operational signals contain only account/entity/occurrence identifiers,
  an occurrence timestamp and a constant `store-sync` visitor placeholder. They do
  not create analytics sessions or conversion events, and are not gated on visitor
  analytics consent. Analytics consent rules themselves remain unchanged.
- Older signed `identify` and `review` events also trigger targeted customer/review
  imports; unsigned legacy analytics cannot trigger Woo API work.

## Freshness monitoring

Settings → Sync includes a **Live order sync freshness** panel for users with
`manage_sync_settings`. The authenticated `GET /api/sync/freshness` endpoint reports
the latest 1,000 unique purchase-order signals received in the past 24 hours,
explicitly flagging truncated samples. It distinguishes outstanding, terminally
failed, overdue (>2 min), and locally missing orders; p95 latency is measured from
first server receipt to local order persistence, not checkout time or completion
of the separate stock refresh. Retry receipts never reset this clock.

Purchase observations use `SyncState` keys prefixed `purchase-signal:` (not sweep
checkpoints), expire after seven days, and are excluded from normal sync-state and
admin health summaries. A periodic monitor logs bounded `PURCHASE_SYNC_OVERDUE`
diagnostics every minute. Order imports from periodic sync also close matching
observations. Failed BullMQ jobs remain retained under the existing policy.

No database migration is needed. Deploy the server first, then install the updated
companion plugin to enable the new operational hooks. Source/package validation
does not publish a release or alter the pinned public plugin download.
