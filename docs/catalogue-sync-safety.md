# Catalogue sync and retained delivery history

## Implemented scope

Woo's `image: null` is valid: raw data retains null and the cached image array is
empty. Product/variation IDs are positive integers. Explicit foreign variation
parent IDs are quarantined alongside malformed payloads.

Full/manual sync and variable product webhooks request fresh, unfiltered variation listings, including when
the parent's variation list is empty. Pagination rejects malformed, repeated,
truncated, changing-total and failed pages; old incomplete cache versions are
discarded. Parent-declared membership must agree when present. Quarantined,
partial, mismatched or missing-type observations defer the **whole parent source**,
including otherwise valid siblings. Independent valid parents continue syncing.

## Durable delivery membership (additive migration required)

`20260924100000_delivery_catalogue_membership` adds:

- `ProductVariation.deliveryActive`, default true for legacy rows. Only a complete
  validated listing or explicit validated simple snapshot authorizes absence.
- `WooProduct.deliveryMembershipObservedAt`, fencing the entire accepted source,
  not just its membership. Equal-or-older observations are rejected before source
  writes, including after transaction retries.
- An indexed delivery membership lookup and a new per-function attestation for
  the variation freshness trigger, preserving supplier, ownership, production,
  raw stock-owner and backorder invalidations and existing trigger bindings.

Reconciliation changes membership, not stock metadata: **no variation deletion**,
no COGS/supplier/stock/raw-data overwrite, no detachment of PO/BOM/receipt/history
identities. Obsolete BOM consumption is deactivated with the existing no-op guards;
restoring membership does not automatically reactivate recipes.

Product settings, manual resync, targeted inbound rebuilds, inbound source reads,
configured-product scans, readiness and cutover mapping use delivery membership.
PO lines for explicitly inactive, retained variations are excluded from inbound
supply without changing the PO. Unknown/orphan PO identities still fail integrity
validation. Existing stock-derived BOM exclusions remain fail-closed, including
inactive/dangling inventory references; membership is not an override for those.

`persistWooProduct` is the sole production boundary for a catalogue observation:
parent fields, variation upserts, membership, recipe retirement, dirty targets and
the source fence all commit in **one** account-locked serializable transaction.
There is no parent-first commit, out-of-transaction variation upsert, or deferred
membership phase. Fetching and validation happen before the transaction opens.
An explicit accepted/rejected result prevents full sync, force sync and webhooks
from continuing writes, scoring/indexing or events after rejection. Force sync
returns 409 for superseded observations. Rejected observations do not even touch
bookkeeping timestamps. Accepted ordinary source imports still update cached Woo
stock/source fields; membership retirement itself does not alter stock metadata.

Each parent with its own complete listing is an atomic unit. A later catalogue
pagination failure stops the checkpoint but does not undo already committed,
complete per-parent observations; no catalogue-wide absence deletion is performed.

Retries repeat the **entire** transaction (maximum four attempts), reacquiring the
lock and rereading sources. They recognize P2034, SQLSTATE 40001/40P01 and Prisma 7
pg-adapter nested SQLSTATE conflicts. HTTP/indexing is outside the retried callback.
Unchanged membership does not create new explicit delivery work. The existing
versioned builder rebuilds both product and inbound inputs, preserving leases,
revisions and account capability/auth blocks.

## Still deferred: missing products and global catalogue retirement

The existing product schema has no safe global lifecycle/tombstone. Full and manual
force sync retain a product even after an account-bound uncached Woo GET returns
`404 / woocommerce_rest_product_invalid_id`. Generic/proxy 404s and authentication
failures never authorize removal. Direct WooService reads have no deletion effects.
The separate explicit product-deleted webhook still uses its existing handler.

Missing-product delivery blockers (for example 60889 if its parent is actually
missing) are therefore not claimed repaired. Nor is `deliveryActive` a global
inventory/search tombstone. A future product retirement design must preserve all
IDs/references, distinguish missing from Woo private/trash status, audit active
catalogue/inventory/search/wholesale consumers, and atomically enqueue appropriate
product/inbound clears. No dangerous deletion is used as a substitute.

## Native validation

A new private PostgreSQL 18.4 cluster was provisioned under
`/tmp/opencode/catalogue-review-pg`, bound only to `127.0.0.1:55439`, with database
`catalogue_review_test`. Tests use `DELIVERY_FRESHNESS_TEST_DATABASE_URL` and the
existing helper's randomly named schemas; they never read the application
`DATABASE_URL`. Native tests apply all 19 delivery migrations plus the isolated
historical fixture baseline.

Native coverage exercises retained stock/COGS/BOM/PO rows, surviving product and
inbound projections, simple conversion, cutover, unknown PO fail-closed behavior,
restoration, stale snapshot fencing, no-op/rollback/supplier trigger semantics, and
a real serializable account-lock conflict. Additional two-Prisma-client tests pause
newer B after its parent write, then overlap older simple/variable A. They prove
that no mixed committed topology is visible, A retries a real P2034 then rejects,
no stale child is created, and newer source/stock survives. Other tests verify
whole-parent quarantine and rollback after a later child failure. Both native
P2034 and Prisma 7 P2010/nested-40001 retries are exercised.

```sh
PATH=/tmp/opencode/node-v22.23.1-linux-x64/bin:$PATH \
DELIVERY_FRESHNESS_TEST_DATABASE_URL=postgresql://catalogue_test@127.0.0.1:55439/catalogue_review_test \
npx vitest run --maxWorkers=1 src/services/deliveryEstimates \
  src/services/__tests__/catalogueMembership.native.test.ts \
  src/services/__tests__/catalogueObservation.native.test.ts \
  src/services/__tests__/persistWooProduct.native.test.ts
```

Run from `server/` against a newly provisioned private test database. No plugin,
startup script, production migration/deployment or remote stock API is involved.

Final combined run: **647 tests passed across 53 files**, including the opt-in
PostgreSQL suites, catalogue/force-sync/schema tests and complete transaction retry
tests; none skipped. Native files run one at a time because concurrent fixture
schema teardown can race PostgreSQL trigger-OID introspection. Explicit connection
and transaction concurrency tests still execute their real overlaps. An earlier
parallel run hit that catalog-inspection race and correctly failed closed.

`tsc --noEmit`, `prisma validate --schema prisma/schema.prisma` and `git diff --check` passed.
The existing Prisma-mock TS2740 in `ProductsService.taxonomy.test.ts:22` was repaired
with the same test-only async mock assertion already used by its adjacent mock.

Teardown verified zero remaining fixture schemas, dropped the private test
database and stopped its PostgreSQL process. Provisioning/SQL logs remain under
`/tmp/opencode`; no live database was accessed. The additive migration remains
unapplied outside the disposable test database.
