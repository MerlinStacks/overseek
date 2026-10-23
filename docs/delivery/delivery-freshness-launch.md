# Delivery launch freshness and calendar

This supersedes the freshness/BOM/external-catalogue gaps in the earlier
`server/src/services/deliveryEstimates/inbound-implementation.md` stage report.

## Durable invalidation

Apply the additive migration `20260922123000_delivery_freshness_targets` as part of
the normal reviewed deployment. Prisma schema push alone does **not** install its
mutation triggers. No production migration was executed during implementation.

PostgreSQL source hooks enqueue `(accountId, parentWooId)` in the same transaction
as these mutations, including bulk writes and external catalogue reconciliation:

| Source | Meaningful changes |
| --- | --- |
| WooProduct | Creation/deletion, stock management, raw type/manage_stock/backorders, supplier assignment, production range |
| ProductVariation | Creation/deletion, parent/identity, stock management, raw manage_stock/backorders, production range |
| BOM/BOMItem | Creation/update/deletion, component reassignment, soft disable/re-enable, quantities |
| Supplier | Lead min/max/default changes and deletion, only its directly assigned eligible products |
| PurchaseOrder/Item | Status/expected date (including backward changes), old/new direct parent, variation, quantity, deletion |

This covers BOM route/service writes, ProductSync upserts/full reconciliation/trash
deletion, webhook/local product writes, delayed variation 404 deletion, and direct
PO maintenance writes. Name/price/SEO/image changes, supplier contact/name changes,
PO notes, and ordinary stock quantity/status changes do not enqueue work. Existing
transactional service invalidations remain compatible; duplicate identities coalesce.

Eligibility is explicit parent/variation production configuration (zero included) or
an existing product/inbound outbox. Default null production does not enrol a fresh
catalogue. Existing outboxes survive range clears and deletions as tombstones. The
builder reconciles the current complete product topology too, avoiding product
revision churn when that payload is unchanged.

Hooks do not acquire Account after source-row locks. They write only durable dirty
identities. The worker wakes at most four accounts and builds at most four pages of
ten targets per drain, using the existing Account lock and dirty-target version CAS.
A racing re-dirty survives; source rollback rolls back its queue entry. Account
teardown does not enqueue new work. Source hooks require no network work.

## Expiry renewal

`DeliveryInputSync.inboundRenewAt` has a `(scope, status, inboundRenewAt, id)` index.
It is derived from the saved payload expiry minus four hours: a normal 24-hour input
is eligible at age 20 hours. A drain selects at most 40 ACKed due inputs, claims them
under the Account lock with revision/deadline CAS, and queues asynchronous rebuilds.
Past-expiry backlogs obey the same bound. Cleared configuration/deleted products and
empty tombstones stop renewing. Pending/failed transports retain their exact payload,
revision and generation timestamps; transport retries never manufacture freshness.

Capability/failure/feature decisions park indexed deadlines once at account scope.
Unsupported or disabled accounts are not polled product by product. Support or
re-enable restores the original deadlines, never a new timestamp; eligible overdue
rows then enter the bounded worker. This does not renew activation leases.

## Source and receipt boundary

`projectInbound` remains purely unverified. The receipt owner's decorator is the only
proof attachment point in `buildInbound`; this work does not define or alter proofs.
Only direct ORDERED PO quantities and the assigned supplier's lead range/default
participate. Expected-date writes preserve the source's leading calendar date at UTC
midnight, including timestamp inputs with offsets; missing dates clear the value.

Parent-managed variations reference `stockOwnerWooId = parentWooId` and carry identical
pooled batches and supplier lead. The variable parent itself remains an unsupported
non-purchasable target. Parent PO lines plus all inherited variation PO lines enter
that pool once; independent siblings keep separate owners. Consumers must allocate
once per unique owner, not sum repeated target copies. Batch bounds count unique
owner pools; source line and target overflow fail closed, never truncate. ProductSync
preserves Woo's `'parent'` marker in raw data and only `true` sets the local independent
management Boolean. Stock-derived finished-product BOM sourcing remains explicitly unsupported.

### Cost-only BOMs versus stock-derived finished stock

Inbound's nested `boms` read and cutover's `hasBom` metadata use the same definition
from `stockDerivedBom.ts`: a BOM is stock-derived if any item has a non-null
`childProductId`, `childVariationId`, or `internalProductId`. Reads retain the existing
bounded `{ id }[]` source structure. They do not resolve dependency rows or filter
inactive items: dangling/empty child references, orphan/zero variation references,
mixed cost/stock rows and inactive stock dependencies all conservatively exclude the
finished product. No component-date promises are introduced.

SupplierItem/labour-only cost BOMs have no such inventory references. The native
simple/variable product therefore retains its normal production range, assigned
supplier lead, direct ORDERED PO dates and effective-owner baseline certification.
Receipt arithmetic/protocol and inventory compatibility logic are unchanged. Readiness
already classifies the derived target states; it has no separate ANY-BOM exclusion.
Adding/removing stock references uses the existing BOMItem invalidation triggers and
changes cutover's source hash. This eligibility correction needs no migration.

`stockDerivedBom.test.ts` executes the actual bounded cutover SQL and the inbound
builder's requested filtered nested reads on isolated PostgreSQL/PGlite. It covers
cost-only native owner certification/direct PO dates, inventory/internal dependencies,
ambiguous references, inactive links, dirty-target invalidation and cutover fencing.

## Calendar

The lightweight month calendar uses native date buttons with full accessible date,
closure scope and label names; previous/next month, arrows, Home/End and Page Up/Down
are supported. Selecting a date loads its existing closure. Add/update replaces that
date, and remove deletes it. Work, transit and both scopes remain separate; weekend
weekday settings are unchanged. Responsive seven-column layout and inherited disabled
fieldset permissions preserve mobile/read-only use. Existing date-list editing stays
available for direct date entry and invalid saved drafts.

## Verification and remaining boundaries

### Launch-review fixes: deletion ACKs and installed SQL prerequisites

The PHP product validator accepts exactly `{wooId, productionMinDays: null,
productionMaxDays: null, variations: []}` after strict shape/range/identity checks,
without `wc_get_product`. This full replacement is safe for live, absent or trashed
products; nonempty configuration still requires the normal local product checks.
API authentication/account binding and monotonic revision/replay rules still apply.
PHP harnesses run the real validator/API/storage to ACK both deletion scopes, and
`deletionReadiness.test.ts` runs the real readiness aggregate on isolated PostgreSQL:
both tombstones must be acknowledged, then an eligible remaining product can be ready.

Readiness now calls exported `checkFreshnessPrerequisite()` and returns blocking
`freshness_sql_prerequisite_missing` plus an actionable diagnostic. Its fixed
`pg_catalog` query checks 15 exact enabled table/trigger/function bindings, timing,
events, trigger predicates/column restrictions, and 14 version-marked function
signatures. It does not trust Prisma-managed columns or `_prisma_migrations` rows.
Queries are coalesced/cached for 15 seconds for admin/control diagnostics, not invoked
by storefront rendering. Catalog failures fail closed. The receipt owner wired the
minimal call into readiness, which guards activation requests and control dispatch.
Global startup/schema-push fallback is unchanged.

Two additional additive migrations are required:
- `20260922133000_delivery_freshness_prerequisite`: SQL implementation/version markers.
- `20260922134000_delivery_inbound_scope_constraints`: repairs the original two-scope
  outbox constraints to allow inbound. The isolated full new-delivery-chain test found
  this defect: tables created by all prior SQL migrations rejected inbound writes,
  whereas schema push omitted those checks. Revision/ACK checks remain enforced.

Exact executed embedded PostgreSQL command (working directory `server/`):

```sh
PATH=/tmp/opencode/node-v22.23.1-linux-x64/bin:$PATH DELIVERY_FRESHNESS_PGLITE=/tmp/opencode/node_modules/@electric-sql/pglite/dist/index.js npx vitest run src/services/deliveryEstimates/freshnessMigration.test.ts src/services/deliveryEstimates/freshnessPrerequisite.test.ts src/services/deliveryEstimates/deliveryMigrationChain.test.ts src/services/deliveryEstimates/deletionReadiness.test.ts src/services/deliveryEstimates/launch.test.ts --maxWorkers=2
```

The original nine source-hook cases plus catalog-integrity regression run in
`freshnessMigration.test.ts`. `deliveryMigrationChain.test.ts` applies all 12 new
delivery/order/receipt migrations, in order, over minimal pre-delivery source tables,
then exercises real inbound insertion, renewal parking, scope/identity/revision
constraints and legacy-by-default behavior. This is not the complete historical
whole-application migration chain.

Native Node/Postgres target: use those same integration test paths with
`DELIVERY_FRESHNESS_TEST_DATABASE_URL=postgresql://USER:PASSWORD@127.0.0.1:PORT/overseek_test`.
The helper requires an explicitly named test database, uses a random isolated schema,
and drops that schema afterward. It never falls back to application `DATABASE_URL`.
Native PostgreSQL was not run here; the executed engine was PGlite 0.5.8. No production
database changes were made.

- Tests cover source hook rollback, targeted supplier/BOM/PO/catalogue invalidation,
  no price/name/sale fanout, deletion/null-range tombstones, account teardown,
  durable deadline parking/restoration, bounded expired renewal, exact transport retry,
  parent-owner pooled counts, source date labels, calendar selection/edit/removal,
  keyboard month navigation and read-only controls.
- SQL migration/trigger tests run on isolated in-memory PostgreSQL via PGlite 0.5.8,
  with Node 22.23.1, Vitest 4.1.10 and Prisma 7.8.0. Set
  `DELIVERY_FRESHNESS_PGLITE` to an installed PGlite module entry to run
  `freshnessMigration.test.ts`; they never connect to the configured application DB.
- Remote Woo changes that have **not yet been ingested** remain subject to normal
  webhook/catalogue-sync latency. Direct SQL `TRUNCATE`, disabled triggers, and schema
  push without this migration are not supported mutation paths.
- Internal/supplier component stock/price changes do not fan out: stock-derived BOM
  parents are excluded regardless of those values, and cost-only item values do not
  supply native product inventory or dates. There is no component-sourced delivery support.
- Multi-connection PostgreSQL deadlock/load testing and live merchant/storefront
  verification remain release checks; PGlite is not that concurrency test. Receipt
  proof/live adapter/control, shipping option mapping and checkout are separate owners.
