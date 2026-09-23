# Pure PHP delivery engine, resolved-input contract v1

Entry point: `OverSeek_Delivery_Engine::calculate($input): array`. Load
`class-overseek-delivery-engine.php`; it loads the calendar class. Like existing
plugin classes, files require `ABSPATH` to be defined. The CLI tests define that
constant themselves; no WordPress functions, Woo objects, dependencies, clock
reads, hooks, output, database, persistence or network services are used.

This is an internal calculation contract, **not the sync/API wire schema**.
An adapter must resolve local configuration, variations, eligible Woo rates,
effective stock owners and authoritative live stock before calling it. Do not
pass unchecked remote stock snapshots. The engine never changes purchasability.

## Complete fixture and invocation

`../tests/delivery-engine-fixture.json` is an executable complete input fixture.
`../tests/delivery-engine.php` supplies named edge-case fixtures by changing that
base. Run from the repository root:

```sh
php overseek-wc-plugin/tests/delivery-engine.php
```

The base fixture produces:

```json
{
  "status": "available",
  "timezone": "Europe/London",
  "effective_date": "2026-09-21",
  "readiness": {"min": "2026-09-21", "max": "2026-09-22"},
  "methods": [
    {"id": "flat_rate:7", "type": "delivery", "min": "2026-09-21", "max": "2026-09-23"},
    {"id": "local_pickup:8", "type": "pickup", "min": "2026-09-21", "max": "2026-09-22"}
  ]
}
```

## Input fields

All fields in the fixture are required except as explicitly described below.
Booleans and integers are strict: strings, floats, nulls and truthy values are
not coerced. Extra fields are ignored, not reflected in output.

| Field | Contract |
| --- | --- |
| `enabled` | Explicit local boolean; false returns `feature_off`. |
| `context_status` | `ready` only when configuration, fulfilment and rate resolution are usable. `pending`, `integrity_error`, `unsupported`, `stale` fail distinctly. Missing/unknown fails as `context_missing`. |
| `timezone` | PHP/IANA timezone identifier including `UTC`. |
| `now` | Caller-supplied instant, strict `YYYY-MM-DDTHH:mm:ssZ` or explicit numeric offset. No implicit host timezone or natural-language dates. |
| `cutoff` | Store-local 24-hour `HH:mm`; at or after rolls once to the next local date. |
| `work_weekdays`, `transit_weekdays` | Separate nonempty arrays of unique integers 0–6, **0 = Sunday**. Weekends are ordinary selectable days. |
| `closures` | Up to 3660 `{date: "YYYY-MM-DD", scope: "work" / "transit" / "both"}` rows. Inclusive closure ranges must be expanded by the caller. |
| `fallback_lead` | Optional `{min,max}` calendar-day range; omitted/null defaults to `{min:30,max:30}`. |
| `items` | Up to 200 resolved cart lines, described below. |
| `stock_owners` | Map of opaque stock-owner IDs to live stock inputs; up to 200 entries. Only referenced managed owners are evaluated. |
| `methods` | 1–100 authoritative eligible methods. No default selection or destination matching is performed here. |

All ranges have integer `0 <= min <= max <= 3650`. Unknown production or transit
ranges are never zero. A missing/half-configured physical item suppresses the
entire order, including pickup. Both calendars must be valid even for pickup.

### Items and resolved variations

Each item requires boolean `virtual` and `needs_shipping`. Virtual or nonshipping
items are skipped before other item validation. At least one applicable item is
required. For each applicable item:

- `supported: true`: caller has excluded unsupported BOM/component, bundle,
  preorder, subscription or other fulfilment semantics.
- `purchasable: true`: authoritative local Woo purchasability; false/unknown fails.
- `stock_status`: normalized `in_stock` or `on_backorder`. `out_of_stock` or
  unknown fails, regardless of backorder settings.
- `quantity`: requested positive integer, at most 1,000,000. Fractional stock
  extensions are unsupported and must not be rounded.
- `production: {min,max}`: effective resolved range. The caller resolves variation
  inheritance first; explicit variation `0–0` stays zero. No parent/product
  lookup happens in this engine.
- `managed_stock`: boolean. If true, `stock_owner` is required and references the
  effective owner in `stock_owners`. Multiple variation/cart lines sharing an
  owner aggregate their requested quantities once and share supply availability.
  They still have independent resolved production ranges. Unmanaged items must
  be `in_stock`; unmanaged backorder supply is unsupported.

### Stock-owner input and shortage policy

Each used owner requires `stock_status` as above, integer `quantity` between
-1,000,000 and 1,000,000, and boolean `backorders_allowed`. IDs are strings of
1–128 ASCII letters/digits/`_.:-` (for example `product:100`). They are opaque;
the engine does not fetch or validate Woo identity mappings.

Optional `prior_demand` is an explicit integer 0–1,000,000, **once per owner**.
It denotes demand beyond this cart that the caller has deliberately chosen to
cover. Default is zero for nonnegative stock. Negative stock requires this field
explicitly, otherwise `unsupported_negative_stock`. The caller must include any
backlog represented by negative stock in this field exactly once; the engine
uses `max(0, quantity)` and does not also add the negative balance. Reservations
already subtracted from supplied stock must not also be included as prior demand.
This is an estimate, not allocation, reservation or a promise that other orders
will not consume supply.

`deficit = aggregate cart quantity + prior_demand - max(0, live stock)`.
If positive, backorders must be allowed and these supply inputs are required:

- `projection_status: ready` explicitly certifies owner mapping, deduplication,
  remaining eligible quantities and freshness were verified by the adapter.
  `pending`, `integrity_error`, `unsupported`, `stale`, missing/unknown suppress
  supply-dependent estimates with distinct reason codes. A receipt/stock-update
  race must be `pending` or `integrity_error`, **not** an empty ready projection.
  No expiry interval or projection revision authority is invented by the engine.
- `inbound`: array of at most 1000 batches per owner. Each batch has `date`,
  positive integer `quantity` <= 1,000,000 and explicit `eligible: true`. The
  caller supplies only eligible outstanding quantities (normally ORDERED POs)
  and deduplicates source rows. No supplier/PO identifiers are needed.
- `supplier_lead`: optional calendar-day `{min,max}`; missing/null uses fallback.

Invalid, undated, ineligible and overdue batches supply no quantity. Overdue
means strictly before the actual store-local **today**, not the cutoff-shifted
effective date: stock due today can still be used after cutoff, starting no
earlier than the effective date. Sort eligible batches by date and accumulate
until they cover the deficit; that date determines both availability endpoints.
Fully covered dated supply takes precedence over supplier lead time.

For insufficient dated supply, each supplier/fallback endpoint is added to the
effective order date in **calendar days**. Conservatively take the later of
that endpoint and the latest eligible partial batch date: known partial supply
must also have arrived before the whole order can start. This models uncovered
quantity replenishment in parallel with known inbound, not a second wait after
the last PO, and not a replacement order that makes late known units irrelevant.
With no eligible batches, use supplier/fallback dates directly. Production starts
**after** each availability endpoint is normalized onto the work calendar.
In-stock items still receive their production range.

## Date arithmetic and methods

Convert `now` to the store timezone once, apply cutoff once, then operate on
validated Gregorian date labels. Calendar arithmetic uses UTC representations
of those labels, not UTC instants or fixed 86400-second local-time increments.
This avoids DST shifts. Date-only values never carry time-of-day or timezone.

Normalize availability to the first eligible work date, then add production
offsets. Zero stays there, one advances one further eligible work date. Closures
and disabled weekdays never introduce a second production surcharge.

Whole-order readiness takes the latest minimum and latest maximum independently.
Each method requires `id`, `eligible: true`, and `type: delivery | pickup`.
IDs must be unique and represent actual resolved rates, not display labels.
Delivery requires `transit: {min,max}`. For each readiness endpoint, normalize
onto the transit calendar, then add its transit offset: zero permits that
eligible dispatch date; one advances one enabled transit day **after** the
normalized date. Pickup uses readiness directly, ignoring any transit fields.
No collection preparation delay is fabricated.

Unmapped/ineligible methods make this call unavailable; callers should pass only
the methods whose identities and eligibility they have resolved. The engine
never silently substitutes another product-page default. Multi-package or
provider fulfilment semantics not represented by this ship-together contract
must use `context_status: unsupported`.

## Failure, bounds and integration limits

Failure is exactly `{"status":"unavailable","reason":"<code>"}`, with no partial
dates. Reasons distinguish missing ranges, invalid values, blocked products,
feature off, no physical items, no methods, unsupported inputs and integrity
states. These codes are internal diagnostics, not shopper-facing copy.

All dates must fit four-digit years. Each request has a 60,000-calendar-day
horizon from its effective date, accommodating two 3650-day weekly calendars
plus supplier lead and bounded closures. Dated eligible supply beyond that
horizon fails. Each of the two calendars also has a cumulative 1,000,000 scanned
date budget and caches repeated date/offset pairs; exhaustion returns
`horizon_exceeded`. Collection sizes are checked before iteration. Large but
valid carts can conservatively exhaust this work budget; this is intentional.

The caller still owns freshness/version checking, duplicate PO detection,
variation/owner resolution, backorder policy, authoritative rate discovery,
partial-receipt support, unsupported fulfilment detection and activation. These
classes do not install storefront output or persist order snapshots. No live
Woo compatibility or performance target is claimed by these pure fixtures.
