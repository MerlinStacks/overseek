# Delivery input sync v1 (implementation contract)

This stage syncs configuration and production inputs only. It does not activate the storefront, publish inbound availability, or advertise complete estimate readiness.

## Transport

- Discover `GET /overseek/v1/delivery-estimates/capabilities`; require schemaVersion 1 and capabilities.configurationSync=true.
- `POST /overseek/v1/delivery-estimates/inputs` uses existing Woo REST authentication and mandatory `X-Overseek-Account-Id`, matching the linked account.
- Request: `{ schemaVersion: 1, scope: 'settings' | 'product', entityId: number, revision: number, payload: object }`.
- All revisions are positive safe integers, monotonically increasing per account/scope/entity. Settings entityId is 0; product entityId is positive Woo parent/product ID (never internal UUID).
- Settings payload: `{ enabled: boolean, settings: DeliverySettings }`, matching the current server validation schema. Enabled means account feature availability, NOT storefront activation.
- Product payload: `{ wooId: number, productionMinDays: number|null, productionMaxDays: number|null, variations: [{ wooId: number, productionMinDays: number|null, productionMaxDays: number|null }] }`. Full replacement of production override inputs for that product. Null means unset/inherit, not zero. No stock writes or Woo product save hooks.
- Success: `{ schemaVersion: 1, scope, entityId, revision, storedRevision: revision, applied: boolean, storefrontActivated: false }`. Exact replay is successful with applied=false; a new revision uses applied=true.
- Reject lower revisions and equal revisions with different validated payloads with HTTP 409; never overwrite newer input. Return no sensitive payload in errors. Authentication/validation failures do not acknowledge writes.
- Capability endpoint advertises configurationSync=true only when this storage protocol is supported; storefront=false remains unchanged.
- Bounded payloads/collections, validated ranges, dates, timezone and stable method IDs; no arbitrary WordPress option/meta writes. Store data privately without autoload or public endpoints. Namespace by linked account to prevent reuse after relinking.
- The 512 KiB bound applies to the full UTF-8 JSON envelope. Settings validation reserves the maximum revision's envelope overhead before a local save succeeds. Overseek canonicalises accepted ICU timezone aliases before persistence; PHP storage and calculation both support the corresponding IANA backward-compatible identifiers.

## Overseek persistence / recovery

- Transactional coalescing outbox keyed by account/scope/entity; store the exact desired payload and revision in Postgres with acknowledged revision, status, attempts, next attempt, lease metadata and sanitised error.
- A durable `DeliverySyncAccount` control row coordinates each account. It stores capability support/expiry, account-wide suppression, a single-flight transport lease, fair scheduling timestamps, and a coalesced resync generation/phase/cursor. Successful capabilities are cached for one hour; unsupported plugins, malformed capabilities and missing/invalid authentication park the account until an explicit retry. Ordinary settings/product saves preserve that suppression while updating durable desired data; they do not cause a probe per product. Account suppression parks outstanding jobs without deleting their payloads or revisions.
- Record intents in the same transaction as settings/product edits and delivery feature enable/disable toggles. Settings auto-defaults are acceptable draft data but never configure missing production times.
- A product-first save seeds a settings intent if none exists, in the same transaction. An existing settings intent is not needlessly revised by subsequent product saves. Aggregate synced status requires the seeded settings acknowledgement as well as all product acknowledgements.
- A bounded scheduler drain claims work with a compare-and-set lease, sends outside transactions and acknowledges only the sent revision. If a new save occurs in flight it must remain pending.
- Transport uses both account and entity token-CAS leases of 120 seconds. An account has at most one active probe/send; each HTTP operation has a 10-second abort deadline, and remaining lease budget is checked before sending. Cache/park writes are conditional on the account lease token and resync generation. Saves/retry never revoke a live lease. Expired leases permit crash recovery, and old workers cannot release a replacement token. Disable settings retain transport priority over product jobs.
- Unsupported plugins park as plugin_update_required, excluded from routine retry scans. Auth/schema/conflict failures park as blocked. Transient failures back off with bounded attempts; an explicit retry wakes parked state.
- A fresh manual resync on a settled account persists a full build request and current settings (including the Woo restore/bootstrap use case). Healthy repeated requests coalesce across product builds, inbound builds/dirty targets, pending transport and live leases: no generations, revisions, cursors, versions or deadlines change. Explicit retries wake blocked/failed/unsupported inputs at their existing desired revision and resume terminal builders at their existing cursor; ACK history and source dirty targets remain intact. No storefront request triggers this action.
- Rebuild failures persist a separate attempt count, next attempt time, terminal flag and sanitised error. Consecutive failed page attempts back off from 30 seconds exponentially, capped at 15 minutes; after eight failures the build is terminal and excluded from routine scans. Successful page progress resets the failure count. Ordinary saves do not clear build failures or backoff. An explicit retry resumes the existing phase/cursor/generation immediately without re-seeding settings or incrementing entity revisions. Build-version CAS prevents a delayed failure from overwriting a subsequent retry or another worker's page progress. `lastBuildAt` continues to provide fair ordering among due builds; logs contain account context only, never exception details or payloads.
- Background resync uses bounded 25-product transactions, fairly selecting at most four account batches per scheduler drain (100 product snapshots maximum). It re-selects oldest-served accounts between rounds, allowing a small installation to use spare batch capacity without starving other accounts. A products phase reads explicit parent/variation overrides with a keyset cursor. A replay phase visits existing product outboxes not yet included in this generation, reconstructing the current local snapshot (including null clears), or replaying the stored payload for a product no longer present locally. Snapshots and cursor advancement commit atomically. A crash resumes at the persisted cursor; a product is rebuilt once per generation, not bulk-woken and then incremented again. Normal saves use the same account lock and generation marker, so their newer snapshots supersede build work. Existing null-clearing intents are retained.
- Configuration resync still gates account transport. Inbound rebuilding does not gate source-current inbound rows: selection excludes dirty products and obsolete account generations before LIMIT. Immediately before transport and when applying an ACK, the account lock protects rechecks of the desired revision, lease owner, account generation and per-product dirty-target absence. Unrelated target updates do not invalidate valid rows. An ACK can advance historical acknowledgement without marking newly dirtied source state synced. HTTP remains outside the lock; edits during flight remain dirty, and Woo receipt finalization still validates epoch/sequence and stock guards. Dispatch is bounded to at most 25 total account/job slots per drain (default ten), with oldest-served ordering and at most five concurrent accounts. No-candidate accounts rotate fairly too.
- An inbound builder transaction processes at most ten dirty targets plus, when a full pass is requested, one ten-row full-pass page. This reserves progress for the full scan during continuous targeted updates. At most four transactions run per inbound drain. Fresh snapshots are stamped with the current account inbound generation, even while an older full-pass cursor finishes; stale rows/tombstones from previous generations cannot dispatch.
- Local saves must succeed without Woo connectivity or Redis availability. Disabled account state must still be sent by the worker; normal feature gating must not prevent disable delivery.
- API `GET /api/delivery-estimates/sync` returns `{ status: { configurationSync: 'not_requested'|'pending'|'synced'|'plugin_update_required'|'blocked'|'failed', storefrontActivated: false, pendingCount: number, syncedCount: number, lastAcknowledgedAt: string|null, lastError: string|null } }`.
- API `POST /api/delivery-estimates/sync` requires manage_shipping_settings and enqueues/retries current inputs; returns the status envelope plus additive top-level `requestDisposition: 'queued' | 'already_running' | 'retrying'`. No network calls, catalogue pagination, or waiting for build/delivery completion on this request. Feature-disabled accounts can read status/retry a disable, subject to normal account permissions.
- While a resync build is requested, `configurationSync` is `pending` (including retry backoff) or `failed` after terminal build failure, even if all currently materialized rows were acknowledged. `lastError` exposes the sanitised build failure during backoff/terminal failure. `pendingCount` includes one outstanding account build in addition to unacknowledged/parked entity rows. No additional response fields are required. Account-wide suppression is reflected in status after the build, and storefrontActivated remains false.
- Existing GET/PUT settings/product responses may retain their existing status shape for backwards compatibility; UI uses the dedicated endpoint for actual sync progress. Do not label all delivery data ready based on settings/production acknowledgement alone.

### Additive progress contract (GET and POST)

`status.progress` is additive; consumers should tolerate its absence on older servers:

```ts
{
    totalInputs: number;
    acknowledgedInputs: number;
    pendingInputs: number;
    blockedInputs: number;
    failedInputs: number;
    pluginUpdateRequiredInputs: number;
    dirtyProducts: number;
    rebuildingProducts: boolean;
    rebuildingInbound: boolean;
    scopes: Array<{
        scope: 'settings' | 'product' | 'inbound';
        total: number;
        synced: number;
        acknowledged: number;
        pending: number;
        blocked: number;
        failed: number;
        pluginUpdateRequired: number;
    }>;
}
```

All three scopes are present, including zero counts. Totals count materialized outbox identities, not estimated catalogue size. `acknowledged` counts identities with `ackRevision > 0`, so rebuilding or retrying an identity retains its historical acknowledgement. It does **not** mean the latest source/revision is ready. `synced` and status buckets retain current outbox semantics. Progress `pending` counts only pending rows, excluding parked statuses and build markers; legacy `pendingCount` still includes all unfinished/parked rows plus product/inbound build markers. `dirtyProducts` counts durable per-product inbound dirty targets, independently of full-scan flags. A full scan may increase total inputs as it discovers identities.

Each response uses one PostgreSQL **read-only, repeatable-read** transaction, with no Account lock. Legacy and per-scope counts (including historical acknowledgements) derive from one grouped aggregate scan. Control/build flags, activation, dirty counts, latest acknowledgement and errors use that same MVCC snapshot. Concurrent builders/ACKs may appear on the next poll but cannot produce mixed-time totals within a response. GET status performs no writes, wakeups or recovery/requeue operations.

### Recovery

After deployment, let the existing queues drain. Pressing Sync while healthy work remains returns `already_running`; it does not restart the catalogue. Resolve a reported authorization/plugin/input failure and press Sync to retry the parked revisions or terminal page. A truly settled account can still start a fresh full resync. Existing generations or historical revisions are not rolled back, and these changes do not diagnose which live source edits caused any previously observed count change. Current-version synced counts can legitimately fall after real edits; historical acknowledgement is the stable progress indicator for existing identities.

Nonterminal transport failures remain `pending` during automatic backoff. Sync also returns `already_running` in this case and **does not expedite the deadline**, even after connectivity is repaired; the worker retries at the already scheduled time. Pending-with-an-error therefore means automatic retry is scheduled, not that transport is currently healthy. Explicit wake/reset applies to parked `blocked`/`failed`/`plugin_update_required` inputs and terminal builders. No targeted pending-error expedite action is exposed by this API.

Generation equality is mandatory even when `inboundFullRequested` is false. Current full invalidation writers set that flag together with the generation; target writers and SQL freshness triggers do not increment the full generation. The target migration backfilled then-pending full requests, but older/manual control state can still strand a pending row with a generation mismatch and no full pass/dirty target. Reconciliation sleeps transport for those rows and durably queues at most ten missing dirty identities under the Account lock. A scheduler sweep also recovers up to four sleeping accounts per tick; explicit Sync can queue the same bounded repair and returns `retrying`. Source builders reconstruct the payload and increment its desired revision normally, retaining ACK history. Recovery never changes the row's generation in place, sends the old payload, restarts the catalogue, resets a cursor, or clears terminal builder failure automatically. Existing dirty targets keep their versions. Full passes remain responsible for their own mismatched rows. Parked, failed and feature-disabled accounts retain their usual explicit recovery/gating.

Reconciliation uses the same generation/dirty-target predicate as selection when calculating transport wakes, including future retry deadlines and expired/live entity leases. Rebuilding work is represented by inbound flags/targets even while `hasWork` is false; source builders restore the transport wake when snapshots are ready. These regression fixtures validate a supported recovery path, not the cause of any observed production backlog.

## Still outside this protocol

Inbound supplier projections, live stock-owner adapters, per-method transit calendar overrides, storefront activation, stale-data expiry and immutable order snapshots are later stages. Never report the feature live or supplier availability ready from configuration sync alone.
