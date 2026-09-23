# Inventory stock write-offs

All routes are under `/api/inventory/write-offs` and require authentication,
tenant membership and **both** `manage_inventory` and `view_cogs`, or wildcard
permission. JSON errors use `{error: string}`. Validation is 400, missing/scoped-out
documents are 404, and stock/configuration/state conflicts are 409.

## API

- `GET /`: `status=DRAFT|FINALIZED`, `reason`, `from`, `to`, `page` (default 1).
  Returns `{items,total,page,pageSize:25,summary:{quantity,totalCost,count}}`.
  Summary is finalized documents only, across every page and all supplied filters.
- `GET /:id`: document and items, including `syncStatus`.
- `POST /`: create a draft (201).
- `PUT /:id`: replace draft reason, notes and the complete item list.
- `DELETE /:id`: delete draft, returns `{deleted:true}`.
- `POST /:id/finalize`: atomically finalize; repeating it returns the existing
  finalized document without another deduction or cost snapshot.
- `GET /products?search=`: `{items:[...]}` eligible picker. Searches name/SKU,
  scans at most 100 Woo products, 100 variations and 100 internal products, then
  removes unsupported stock identities and BOM-derived families. Refine search
  to find items outside these candidate limits. Zero stock remains visible.
- `GET /report?from=&to=&reason=&page=1`: finalized line rows plus
  `{total,page,pageSize:500,asOf,summary}`. `total` counts lines; summary `count`
  counts documents. Each line has document `id` and additionally unique `itemId`.
  **For complete exports:** request page 1, retain its `asOf`, request every
  remaining page with `&asOf=<returned ISO timestamp>` and the same filters,
  until `page * pageSize >= total`. The cutoff prevents newly finalized documents
  shifting page offsets. Summary covers the full filtered export, not just a page.

`from`/`to` are inclusive UTC calendar dates, filtering **finalizedAt**, including
on the list endpoint. Date filters therefore omit drafts. Reasons are `MISSING`,
`DAMAGED`, `ENTRY_ERROR`, `EXPIRED`, `OTHER`.

Draft body:

```ts
{
  reason,
  notes?: string, // up to 5000 characters; omitted on PUT clears notes
  items: [{ // 1..100 unique identities
    productId?: string,
    variationId?: number, // Woo variation ID; requires productId
    internalProductId?: string, // mutually exclusive with Woo identity
    quantity: number, // positive integer, at most 1,000,000
    unitCostOverride?: number // nonnegative, at most 999,999,999
  }]
}
```

Costs are COGS plus every miscellaneous cost amount. Missing COGS requires an
explicit draft override, including an explicit zero if intended. An override
replaces the **entire per-unit valuation**, including extras. Costs are rounded
to four decimal places and persisted as Decimal. Draft values are estimates;
finalization reloads current costs and freezes names, SKUs, unit/line/document
totals and actor/reason/before/after stock audit data. Historical catalogue
deletion cannot remove these snapshots. JSON cost fields are numbers.

Variant valuation follows the existing inventory/order convention: null/zero
variant COGS falls back to parent COGS, retaining nonempty variant extras or
falling back to parent extras. Nonzero variant COGS uses its own extras. An
explicit zero override remains a complete zero valuation.

## Stock transport and recovery

Finalization serializes on the Account row and commits document, guarded local
stock decrements, audit and outbox in one transaction. Unknown/null stock never
becomes zero implicitly. Inherited variations debit their resolved parent owner;
multiple lines sharing an owner cannot overdraw its local quantity.

Woo imports do not acknowledge queued deltas. Finalization bounds the local
decrement by both current stock and the journal baseline plus subsequent deltas,
including earlier queued write-off snapshots. Reconciliation replaces its own
baseline; its delta is not deducted again. Unknown older queue baselines block
finalization until settled. This is intentionally conservative: an imported
increase alone cannot raise a known journal balance. Replenishment must be
accounted for through guarded receiving or explicit stock reconciliation.

Woo stock and internal components used in BOMs require completed **GUARDED**
inventory cutover. Frozen receiving, blocked plugin capability, unverifiable
native owners and variable-parent derived BOM configurations are rejected with
actionable messages. A family with any component-derived BOM is conservatively
excluded, even if the selected sibling itself has no BOM. Independent internal
products can finalize in legacy mode, but receiving freeze still applies.

Woo operations use the existing receipt journal with `sourceType=stock_write_off`
and negative native deltas, retaining owner sequencing and prepare/apply replay
safety. Native owners are never synchronized using absolute stock writes.
Receipt worker/cascade/reconciliation tooling recovers parked/uncertain operations.
Local finalization does not wait for remote ACK. Before applying a write-off,
the worker obtains an uncached observation of the physical stock owner and parks
unknown/insufficient stock without sending apply. Retries first replay prepare:
an already-applied journal ACK completes without another preflight or decrement.
The existing native Woo delta protocol still lacks an atomic conditional
decrement: a Woo sale between observation and apply can produce a negative
balance. The preflight cannot remove that protocol-level race.

Internal line cascade jobs are persisted on the item, processed by the running
GuardedReceiptScheduler, and share the receipt cascade account lease. Failures
retain `cascadeError` and retry indefinitely with backoff capped at one hour;
expired leases recover after crashes. Retries recalculate only current derived
BOM stock and never repeat the write-off decrement. Native receipt work fencing,
strict live-stock reads, and current BOM checks prevent fallback native-owner
absolute writes.

`syncStatus`: `NOT_REQUIRED` for drafts; `PENDING` while transport/cascades are
outstanding; `NEEDS_ATTENTION` for parked/uncertain/blocked Woo work or failed
Woo cascades, or an internal retry carrying an error; `SYNCED` after completion. Additional `syncOperations` and per-item
`operationId`, stock snapshots and internal cascade fields expose recovery state.

Apply migration `20260923120000_stock_write_offs` and generate the Prisma client
before deployment. No database migration is performed by the implementation task.
