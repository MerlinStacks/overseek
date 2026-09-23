# Callable-only order snapshot v1

Load `class-overseek-delivery-order-snapshot.php` explicitly after Woo is available.
Loading it registers nothing. This stage does not capture or insert snapshots.

## Exact API for future checkout integration

```php
OverSeek_Delivery_Order_Snapshot::parse($value): ?array;
OverSeek_Delivery_Order_Snapshot::build(
    $canonical_result, $selected_method, $fulfilment_type, $captured_at
): ?array;
OverSeek_Delivery_Order_Snapshot::write_first(
    $order, $canonical_result, $selected_method, $fulfilment_type,
    $captured_at, 'final_verified_checkout'
): string;
```

- `$canonical_result`: complete `OverSeek_Delivery_Engine::calculate()` available
  result, normally obtained via the local live adapter. Missing/unavailable results
  yield null from the factory and `invalid` from the writer, without writes.
- `$selected_method`: exact `{methodId: string, instanceId: int, rateId: string,
  title: string}` from the **actual selected eligible Woo rate**, not the configured
  default or a label lookup. Rate ID is opaque and must appear exactly once in the
  calculation. Discrete method and instance metadata are authoritative; no prefix
  or numeric second-segment assumption is made, including global WBS/WBSNG.
  Identity acceptance is structural only, not provider compatibility certification.
- `$fulfilment_type`: `delivery` or `collection`; must match the selected engine
  method's `delivery` or `pickup` type respectively.
- `$captured_at`: caller-supplied UTC `YYYY-MM-DDTHH:mm:ssZ`, optionally with one
  through three fractional digits before `Z`.
  Capture once; retries must retain the same instant and metadata.
- `$order`: persisted `WC_Order` of type `shop_order`; no carts, products, refunds,
  previews or unsaved orders. The writer uses a fresh CRUD object, so unrelated
  pending changes on the supplied object are not saved. Reload caller metadata
  when needed after success.

`build()` is pure and never writes. `parse()` accepts an associative array or JSON
string and returns null on invalid data. Exact keys, strict types, valid Gregorian
date-only ordered endpoints, valid IANA timezone (including UTC), UTC capture time,
branch exclusivity, and arrival endpoints no earlier than dispatch are required.
Encoded JSON is limited to 8192 UTF-8 bytes, with Unicode, slashes and Unicode line
terminators unescaped to match JavaScript `JSON.stringify`; raw JSON input has the
same limit. Method IDs match `[A-Za-z0-9_-]` and are at most 100 characters. Rate
IDs use printable non-space ASCII (`[\x21-\x7e]`), 1–200 characters, without token
parsing. The factory and engine share this rate-identity bound. Titles must already be trimmed by
ECMAScript whitespace rules, nonempty, at most 300 UTF-16 code units (astral
characters count twice), and contain no C0 or DEL controls. Timezone is at most
100 ASCII characters in IANA identifier syntax; arbitrary UTC offsets are rejected.
PHP timezone data and JavaScript ICU can differ on obscure aliases or casing;
standard shared aliases are covered, but exhaustive runtime alias equivalence
is not claimed.
Instance IDs are nonnegative JavaScript-safe integers. No unknown fields survive.

Dispatch is canonical whole-order readiness. Collection uses that same readiness
without transit delay, sets `delivery: null`, and uses `fulfilmentType: collection`.
Downstream automatic wording is **Estimated collection**, not Estimated delivery.
The actual Woo title is preserved; this class renders no HTML or shopper copy.

## First-write behavior and concurrency

The metadata key is `_overseek_delivery_estimate_v1`. Return values:

| Result | Meaning |
| --- | --- |
| `written` | Added and reread through Woo CRUD. |
| `existing` | Existing valid snapshot equals candidate; no write. |
| `conflict` | Existing invalid data, conflicting duplicates, or a different valid snapshot; no write. |
| `invalid` | Calculation, selection, or snapshot failed validation; no write. |
| `invalid_context` | Not the explicit final-checkout context or not a persisted order. |
| `lock_unavailable` | Advisory lock unavailable or five-second timeout; no write. |
| `storage_error` | Local CRUD/DB failure; inspect/retry with the original candidate. |

Every existing row is inspected, including empty/invalid values. Identical valid
duplicates are retained; nothing is repaired, deleted, or overwritten silently.
A different capture instant, title, selection or date is a conflict even when the
old snapshot is valid. Resolve bad legacy metadata explicitly outside this API.

Woo's `add_meta_data(..., true)` alone is **not** database-wide uniqueness. This
helper acquires MySQL/MariaDB `GET_LOCK` with a site-prefix/order-scoped name and
five-second timeout, constructs a fresh order, calls `read_meta_data(true)` under
the lock, then uses `add_meta_data(..., true)` and `save_meta_data()`. It releases
the advisory lock in `finally`. No order-table or post-meta SQL is used; metadata
storage remains HPOS-compatible via Woo CRUD. The only direct SQL is advisory
locking. Requires a stable DB connection with working named locks and consistent
primary reads. All writers of this key must cooperate using this helper/lock;
external metadata editors and noncooperating writers can still create conflicts.
This is not a database unique constraint or a receipt/stock transaction fence.

## Mandatory future caller boundary

**Only call `write_first()` from final verified checkout.** The context string is
an assertion of caller intent, not proof of safety. The caller must establish the
complete order/cart identity, final destination and chosen rate, supported single
ship-together fulfilment, current linked configuration, freshness and stock/receipt
safety before calling. This class cannot certify receipt safety or distinguish an
unmarked fabricated array from a real canonical result. Never pass synthetic
fixtures, preview results, stale calculations or unavailable results as promises.
The current adapter's receipt-safety suppression remains authoritative; an
`available` engine array alone is not permission to activate checkout capture.

There are no checkout hooks, public endpoints, network calls, account selectors,
frontend capture, activation changes or automatic fixture persistence here.

## Local verification

```sh
php -l overseek-wc-plugin/includes/class-overseek-delivery-order-snapshot.php
php -l overseek-wc-plugin/tests/delivery-order-snapshot.php
php overseek-wc-plugin/tests/delivery-order-snapshot.php
```

The harness consumes the same `{base,cases}` fixture as core at
`packages/overseek-core/test-fixtures/delivery-estimate-snapshot-v1.json`, testing
every case as both an array and JSON string. It also uses canonical engine
fixtures and HPOS-shaped CRUD/lock stubs.
It checks invalid contracts, selected-method mismatches, collection semantics,
first-write conflicts, non-order contexts, no-write failures, lock timeouts and a
competing writer appearing before the locked reread. It does not certify live Woo
extension compatibility or multi-process database locking in production.
