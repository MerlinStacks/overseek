# Delivery launch control and receipt API

This supersedes the **staged/dormant** receipt, finalization and managed-stock sections of the earlier implementation notes. It is an implementation contract, **not production launch certification**. No migration has been applied to a live database and no store is automatically activated.

## Authentication and permissions

All Overseek paths below use the existing bearer authentication and `X-Account-Id` membership context, return `Cache-Control: no-store`, and are account-scoped. Readiness requires `view_shipping`. Cutover/certification require **both** `manage_shipping_settings` and `manage_inventory`. Activation requires `manage_shipping_settings`. Receipt listing, observation and reconciliation require `manage_inventory`; OWNER/ADMIN wildcard permissions still apply. The parent UI must expose/grant this permission to custom inventory-manager roles.

Readiness, receipt recovery, sync and explicit disable remain reachable with `DELIVERY_ESTIMATES` off. Activation `true` still fails readiness when the feature is off. No environment switch or manual database activation edit is needed.

## UI endpoints (exact names)

### Estimate modes (companion plugin 2.24.0+)

The settings document accepts optional `estimateMode: 'production' | 'inventory'`. Omission retains historical inventory-aware behaviour and is not rewritten on read. New unsaved account defaults use `production`. Mode changes preserve all existing settings and product/variation records. Entering production mode automatically queues a bounded background publication of saved product timings and restarts a failed publication; routine settings saves do not restart that catalogue build. In production mode, malformed product inputs are skipped with their source records retained, allowing healthy products to publish. Database failures still roll back the batch and retry normally.

Production-mode readiness requires current acknowledged settings, an enabled supported shipping mapping, at least one synced configured native product, and explicit plugin `productionEstimates: true` capability. It does not require inventory SQL certification, catalogue-wide inventory compatibility, inbound freshness, or settled receipt/legacy work. Individual unsynced products become `production_products_not_synced` notices. Already-frozen inventory work remains recoverable and must be resolved before activation.

The production activation command includes `estimateMode: 'production'` and the exact settings revision. Plugin control keeps its existing receipt `mode` and `epoch`; the new estimate mode is independent of receipt transport. Mode agreement is checked against synchronized settings and at the storefront gate. The adapter reads live Woo stock, aggregates shared-owner demand and subtracts held stock; backorders/shortages get no date. No incoming-stock or receipt proofs are read in this mode. Inventory mode keeps its existing calculation and activation prerequisites. Explicit disable and automatic settings revalidation work in either mode.

### `GET /api/delivery-estimates/readiness`

Returns HTTP 200 for a diagnostic, **not a readiness assertion**:

```ts
type Readiness = {
  ready: boolean;
  estimateMode: 'production' | 'inventory';
  mode: 'LEGACY' | 'GUARDED';
  active: boolean;                 // verified plugin/settings/environment activation, not a promise for every SKU
  acknowledgedActive: boolean;     // last server control ACK; may differ during revalidation/outages
  desiredActive: boolean;
  cutoverState: 'legacy' | 'legacy_review' | 'baseline' | 'guarded';
  revalidationRequested: boolean;
  actions: { legacyReview: string | null; resumeCutover: string | null; revalidateActivation: string | null };
  receivingFrozen: boolean;
  epoch: string | null;
  revision: string;                // decimal monotonic control revision
  acknowledgedRevision: string;
  work: {
    action: 'cutover' | 'activate' | 'disable' | null;
    attempts: number; lastError: string | null; nextAttemptAt: string | null;
    progress: {
      productsProcessed: number; ownerCertifications: number; pagesAcknowledged: number;
      lastPageProducts: number; lastPageOwners: number; sourceRebuilds: number; pageRebuilds: number;
      baselineEstablished: boolean; countsFromStart: boolean;
      cursor: string | null; pendingCursor: string | null; pendingProducts: number; pendingOwners: number;
    };
  };
  blockers: string[];
  warnings: string[];
  unresolvedReceipts: number;
  unresolvedLegacyJobs: number;
  pendingInputs: number;
  configuredCount: number;
  eligibleConfiguredCount: number;
  excludedConfiguredCount: number;
  excludedProductWooIds: number[]; // first 100 sorted parent Woo IDs with excluded configured targets
  freshnessPrerequisite: { ready: boolean; version: string; missing: string[]; diagnostic: string | null } | null; // production mode only evaluates these for frozen-inventory recovery
  inventoryCompatibility: {
    ready: boolean; blockedCount: number;
    targets: {productWooId: number; variationWooId: number|null; reason: string}[];
  } | null;
  freshness: { stale: number; unverified: number };
  providerSupport: { supportedMethodIds: string[]; configuredSupported: number };
  sync: { capability: string; inboundCapability: string; resyncRequested: boolean;
          inboundRequested: boolean; lastError: string | null };
  plugin: null | {
    schemaVersion: 1; protocolVersion: 1; productionEstimates?: boolean; wooVersion: string | null;
    blockers: string[];
    environmentFingerprint: string;
    presentation: 'classic' | 'blocks' | 'unknown';
    state: { revision: number; mode: string; epoch: string | null; active: boolean;
             settingsRevision?: number; identity?: string; environmentFingerprint?: string;
             presentation?: 'classic' | 'blocks' | 'unknown' };
  };
};
```

Blockers include `freshness_sql_prerequisite_missing`, `plugin_control_unavailable_or_upgrade_required`, `woocommerce_8_required`, `deactivate_old_delivery_plugin:<plugin-file>`, `blocks_pickup_requires_verified_presentation`, `feature_disabled`, `cutover_required`, `receiving_frozen`, `unresolved_receipts`, `legacy_jobs_not_drained`, `inputs_pending`, `settings_not_synced_or_invalid`, `no_supported_enabled_shipping_mapping`, `no_configured_products`, `no_eligible_configured_products`, `inbound_missing`, `inbound_stale`, `inbound_unverified`, and `plugin_epoch_mismatch`. Warnings include unsupported product/BOM exclusions, unsupported shipping mapping exclusions and an absent product-page default. `inbound_unverified` replaces the old conflated `inbound_unverified_or_unsupported` diagnostic.

The configured provider allowlist is core flat rate/free shipping/local pickup plus WBS/WBSNG. All known providers support exact-rate or explicitly confirmed all-provider-rates mappings; core methods additionally support legacy `core_instance` mappings. Unknown providers remain unsupported. Unmapped offered rates remain blank; this endpoint is not a live carrier-rate calculator or proof of merchant-specific WBS compatibility.

Explicit `unsupported`/BOM targets are exclusions, reported through `configured_products_excluded_unsupported_or_BOM` and `excludedProductWooIds`, rather than global proof failures. At least one configured product must have an eligible supported target (`no_eligible_configured_products` otherwise). Supported targets still require current verified epoch proofs (`inbound_unverified`), and stale or integrity-error inputs remain blockers. Eligible/excluded counts are parent-product counts and may overlap when a variable product has both eligible and excluded configured siblings. A variable parent's container-only unsupported row is not itself an exclusion; unconfigured sibling targets do not create exclusion warnings.

`freshness_sql_prerequisite_missing` blocks readiness and activation until `checkFreshnessPrerequisite()` verifies the exact enabled PostgreSQL trigger bindings, function signatures and version markers. It also guards **cutover and certification before any control/review work or receiving freeze is written**, including an already-guarded idempotent request. These critical checks bypass the diagnostic cache. Pending cutover workers check again, and the final transition rechecks on its own transaction connection after the plugin ACK, before changing inventory mode or unfreezing receiving. Missing SQL returns a diagnostic 409 for requests or a visible retry error for pending work; it never grants a new GUARDED transition. Explicit disable and operator recovery remain available. The diagnostic is exposed as `freshnessPrerequisite`; table columns, schema push or migration history alone are not proof that these SQL prerequisites exist.

### `POST /api/delivery-estimates/cutover`

```json
{"receivingPaused":true,"legacyJobsDrained":true,"preupgradeWorkersRestarted":true}
```

All three confirmations are mandatory. The operator must actually pause inventory receiving, drain old process-local receipt work, and restart **all pre-upgrade API/worker processes**. A user/time audit of this confirmation is retained. Tracked unfinished legacy work returns 409 **after durably freezing receiving**, with `cutoverState: legacy_review`; use the legacy review endpoints below, then re-submit cutover. Unsettled guarded operations also refuse cutover with 409.

**Keep the old Pi/estimate plugin displaying dates during private preparation.** Only `deactivate_old_delivery_plugin:*` is waived for the plugin's inactive `baseline` and `guarded` commands and the server's cutover worker. Those commands still persist `active:false`; all native inventory, Woo version, settings/presentation compatibility and receipt prerequisites remain enforced. This does not permit simultaneous old/new storefront output and never deactivates another plugin automatically.

Recommended rollout: synchronize configuration, complete guarded cutover and publish verified inputs while the old display remains active. Readiness continues to report the old-plugin **activation** blocker. Once private preparation is complete and no other blockers remain, manually deactivate the old plugin, refresh readiness, then explicitly activate Overseek. Activation records the post-deactivation environment fingerprint. Both activation checks and the plugin activation endpoint still reject an active old plugin; re-enabling it invalidates the storefront gate. This keeps the customer date-display outage to the final handover rather than the catalogue/input publishing phase.

An activation ACK replay also rechecks current activation blockers; it cannot report success while the old plugin has been re-enabled. Inactive preparation and disable ACKs retain their existing idempotent replay behavior.

Returns **202** `{ accepted: true, revision: string, epoch: string }`. It persists work and freezes receive/unreceive under the Account lock. The request does not enumerate the catalogue or call Woo. The worker batches up to **50 complete products** per baseline command, with **1001 unique owners and 64 KiB UTF-8** hard envelope limits. A 1000-variation product is kept whole; products that do not fit the remaining page are deferred without moving the cursor past them. More than 1000 variations on one product is an actionable protocol-limit error, never a truncated baseline. Empty catalogues receive an explicit empty baseline handshake; excluded/tombstoned products can advance scan progress without fabricated owners.

Baseline reads use the existing account/product and product/variation indexes, selecting only ownership metadata and BOM-exclusion presence. They do not call `buildInbound`, fetch PO batches, or join suppliers. A read examines at most 50 parent headers, 1001 indexed variation IDs per header for bounded counts, and materializes at most 1000 complete variation rows. Account-locked source/ACK transactions have a 5-second transaction limit, 3-second statement timeout and 1-second lock timeout. Owner certification uses bulk insert/update, not one database round trip per owner.

Each drain uses at most **8 fair rounds / 40 command attempts / an 8-second start-and-transport budget**, with one normal page per account per round and explicit disables checked before every slot. HTTP timeouts use remaining budget (never more than the existing 10-second transport cap); no new command starts near the deadline. A transaction/ACK already in progress may use its bounded database completion time. At normal latency, one account can acknowledge eight pages in a tick: **500 simple products need 10 baseline commands plus finalization; 1000 need 20 plus finalization**, rather than a tick per product. Settings/product outbox build limits are unchanged.

The immutable reserved command includes its exact keyset prefix, source fingerprint, owner list and cursor. Lost ACKs resend that body unchanged. Before advancing a cursor, the worker rechecks the same bounded prefix under the Account lock, including inserted/deleted rows and ownership/BOM changes. A mismatch certifies nothing, retains the last acknowledged cursor and queues a new revision; three repeated conflicts park visibly for explicit retry. Stock/price-only edits do not alter the ownership fingerprint. Commands reserved by older workers without page metadata still replay unchanged, then safely rebuild from the old checkpoint. Ordinary catalogue changes after an acknowledged certification remain subject to the existing proof/readiness and explicit re-certification rules.

`work.progress` is additive and optional for older UI clients. Counts advance only on a source-verified ACK; pending cursor/counts are not completion. `countsFromStart:false` means an older checkpoint lacked historical counters. Progress is stored in existing control JSON, so this optimization adds **no migration** and retains the native-tested 13-migration chain.

`Account.receiptTransportMode` remains LEGACY until the final guarded handshake ACK. Then receiving resumes and inbound proofs are rebuilt. Cutover never creates merchant activation intent: initial/default accounts stay inactive. A previously explicit `desiredActive:true` survives review/certification and queues fresh automatic readiness revalidation after the handshake.

Re-submit the same confirmations to recover a failed/parked cutover after correcting its reported cause. The existing epoch and completed cursor are retained. A disable during cutover stops activation but does **not** silently unfreeze receiving; resume cutover explicitly.

### `POST /api/delivery-estimates/certification`

Same body and response as cutover. For an already guarded account this explicitly pauses receiving and re-enumerates owners using the current epoch, allowing newly configured products/ownership to be certified. Existing settled owner sequences are retained, never reset to zero. Missing guards never auto-baseline during ordinary ingestion or storefront reads. Re-certification suppresses activation during the handshake and preserves merchant `desiredActive`; previously desired activation is automatically revalidated only after new proofs/inputs are ready. Previously inactive/disabled accounts remain inactive.

### `POST /api/delivery-estimates/activation`

Body `{ active: boolean }`; **202** `{ accepted: true, revision: string, desiredActive: boolean }`.

`false` always queues disable, even with account feature off, old plugin coexistence, or missing settings. `true` requires readiness both when requested and before dispatch, with **no old-plugin exemption**. Plugin control verifies epoch, monotonic revision, account binding, local settings revision, Woo version, old-plugin headers/vendor metadata and unsupported Blocks pickup. It never deactivates another plugin. Eight bounded exponential-backoff attempts leave a visible `work.lastError`; re-request after fixing it. New revisions fence stale ACKs; the immutable command is persisted before transport and replayed after lost ACKs.

SUPERADMIN `POST /api/admin/accounts/:accountId/toggle-feature` with `{featureKey:"DELIVERY_ESTIMATES",isEnabled:false}` also clears `desiredActive` and queues this independent monotonic disable in the same Account-locked transaction as the feature flag. It preserves active leases and fences older activation ACKs. Parked capability discovery, failed/pending configuration builds, and invalid historical settings drafts cannot veto the control disable. The compatibility settings-disable intent is retained when valid. The admin response acknowledges the durable request; readiness/control ACKs establish delivery to the plugin.

The `/inputs` wire ACK retains legacy `storefrontActivated:false`: **this input write does not activate the storefront**. It is not a live activation flag, even when output is already active. Input ACK handling must never copy this value onto launch/control state. Use readiness `active`/`acknowledgedActive` and the explicit control ACK instead.

Local storefront activation additionally requires the **same settings revision** as activation. A routine settings save atomically queues automatic revalidation **only if merchant `desiredActive` is already true**. The gate suppresses output briefly while new settings sync; the durable control worker waits without burning retry budget for pending synchronization, checks full fresh readiness, then acknowledges a new activation revision. No manual activate click is needed for a valid routine save. A prior explicit disable remains authoritative and is never reversed by a save. UI: show `revalidationRequested`/`work.lastError` as “Publishing settings / revalidating” and surface actual blockers, not a silent permanent off state. Transport failures retain the bounded retry/error path; `POST /activation {active:true}` can explicitly retry after the reported cause is fixed. Per-product proof/freshness/stock gates still apply on every estimate.

Automatic revalidation also waits for actionable readiness blockers without consuming transport attempts: first retry after 30 seconds, repeated unchanged blockers after five minutes. It resumes when the blocker is resolved, even if the fix was an inventory/product or store-page change rather than another settings save. Actual transport failures retain the eight-attempt budget and visible retry action.

Activation records an account-bound environment fingerprint of the active/network-active plugin lists, plugin-change generation, Woo/Overseek versions and checkout-page/pickup options. Frontend gates perform **only option fingerprint + local control/settings checks**; they never call `get_plugins()` or parse page/plugin headers. Plugin activation/deactivation, upgrades and relevant checkout-page changes invalidate the fingerprint until readiness-checked reactivation. Header detection runs in authenticated readiness/control, matches names/basenames/text domains with word boundaries and known Pi delivery slugs, and deliberately ignores unrelated PluginURI/AuthorURI strings.

Actual cart/checkout pages are inspected during validation. Woo **9.9+ is required when either page uses Woo Blocks** (`blocks_woocommerce_9_9_required`). Classic requires **9.7+** (`classic_woocommerce_9_7_required`) and both pages must explicitly contain their Woo classic shortcodes. Readiness shares the live quote reader's supported-version predicate (currently 9.7–9.9, 10.0–10.9, 11.0–11.1); future unverified cache formats return `woocommerce_quote_cache_version_unsupported`. Woo 8 is not falsely certified when the live reader would return no dates. Missing/unrecognized pages return `declare_classic_or_supported_blocks_checkout_pages`; this is not silently certified as classic. Unsupported Blocks pickup remains a separate actionable blocker.

### `GET /api/delivery-estimates/receipts?cursor=<operationId>`

Returns `{ receipts: Receipt[], nextCursor: string | null, legacyJobs: LegacyJob[] }`. Up to 50 operations ordered by `operationId`; `nextCursor` is exclusive. `legacyJobs` contains up to 50 oldest undrained tracked legacy jobs, including their persisted target/reconciliation/retry/error fields documented below. Derived `originalTargetsAvailable`, `observationPath` and `reconciliationPath` are added by the dedicated `/receipts/legacy` list endpoint.

Receipt fields: `operationId`, `accountId`, `cycleId`, `purchaseOrderId`, `productId`, `variationId: string|null`, `productWooId`, `variationWooId: number|null`, `stockOwnerWooId`, `sequence: string`, `delta`, `state`, `attempts`, `nextAttemptAt`, `lastError: string|null`, `stockQuantity: number|null`, `appliedAt: string|null`, `createdAt`, `reconciliation: object|null`. Dates serialize as ISO strings. Relevant states: `pending`, `prepared`, `applied`, `uncertain`, `parked`, `reconciling`, `reconciliation_failed`, `reconciled`.

### `POST /api/delivery-estimates/receipts/:operationId/observation`

No body fields. Allowed only for parked/uncertain/failed-reconciliation receipts. Under the physical owner lock the plugin observes the current journal identity, guard and native `_stock` row. For an operation parked before prepare, it establishes prepare only; it never applies a delta.

Returns `{ schemaVersion: 1, operationId: string, stockQuantity: number, observationToken: string, expiresAt: string }`. Tokens are HMAC-bound to account, exact immutable operation, guard, phase, stock row/value, nonce and a 120-second expiry. This is **not** an inference that the receipt succeeded.

### `POST /api/delivery-estimates/receipts/:operationId/reconcile`

The UI must tell the operator to establish the correct stock count **including this operation's effect and excluding later queued operations**, then obtain a fresh observation. Never offer “retry the delta”.

```ts
type ReconcileRequest = {
  actionId: string;                       // client-generated UUID retained across lost ACKs
  observationToken: string;
  observedStockQuantity: number;          // exact observed corrected count, integer
  reason: string;                         // trimmed 5..1000 characters
  correctedCountIncludesOperation: true;
};
```

**202** `{ accepted: true, operationId: string, actionId: string }`. Actor ID is taken from authenticated membership, never from the body. The durable worker replays the **same attestation**, never the original delta. Under the owner lock and a stock-row transaction, stale quantity/row/guard/phase/expiry rejects. Journal phase 5 and operator audit commit together. Lost reconciliation ACKs return the historical result for the identical action even after expiry or later owner operations. Server state advances only the original next sequence, records audit authority, un-parks the owner and refreshes account capability so later queued operations continue.

`reconciliation_failed` after a stale observation requires a new observation and new action UUID. After an ambiguous/lost ACK, re-submit the **identical prior request/action** first: it can recover the historical plugin ACK without stock mutation. This remains safe even when stock has subsequently changed. Another authorized inventory manager can retry the identical saved action; the original attestor is preserved, and the retry requester is separately audited. Receipt identities/sequences and stock operations are unchanged.

Invalid bodies return 400, missing membership/permissions 401/403, conflicts 409, transient service errors 5xx. Do not display `accepted` as applied; poll receipt/readiness state.

## Legacy job review API (frontend handoff)

These endpoints use the same `manage_inventory` permission and remain accessible with the feature off. They **never replay a legacy stock/BOM job or force a stock count**. The operator pauses receiving, drains/restarts legacy workers, establishes correct inventory including any legacy job effects and dependent BOM work, then attests. Current workers also stop further legacy work when receiving is frozen.

### `GET /api/delivery-estimates/receipts/legacy?cursor=<jobId>`

Returns `{ jobs: LegacyJob[], nextCursor: string|null }`, 50 jobs per page, ordered by ID. Each job exposes `id`, `accountId`, `purchaseOrderId`, `state`, `targets: {productWooId:number, variationWooId?:number|null, stock?:number}[]|null`, `originalTargetsAvailable:boolean`, `reconciliation:object|null`, `attempts:number`, `nextAttemptAt:string`, `lastError:string|null`, `resolvedAt:string|null`, `createdAt:string`, `observationPath:string`, `reconciliationPath:string`. States are `pending`, `reconciling`, `reconciliation_failed`, `drained`. Stored `stock` is historical intent, **not** proof of current or correct inventory.

### `POST /api/delivery-estimates/receipts/legacy/:jobId/observation`

Body exactly `{ receivingPaused: true, workersRestarted: true }`. This commits the receiving freeze/restart authority, supersedes any pending cutover/activation revision and queues local disable before contacting Woo. Merchant `desiredActive` is retained, but review never activates output. Returns:

```ts
type LegacyObservation = {
  schemaVersion: 1; jobId: string; sourceIncomplete: boolean;
  owners: { stockOwnerWooId: number; stockQuantity: number }[];
  unobservable: ({ target: {productWooId:number, variationWooId:number|null}; reason:string }
                | { stockOwnerWooId:number; reason:string })[];
  observationToken: string; expiresAt: string;
};
```

The plugin resolves actual effective owners (including parent-managed variations), deduplicates them and signs a fresh **five-minute** account/job/target/stock-row/guard observation. Missing/deleted/unmanaged/custom-store targets are explicitly unobservable. For older jobs without persisted original targets, current PO links are only advisory and `sourceIncomplete` is true. Automatic observation is bounded to 1000 targets; over-limit, empty or corrupt historical target data is explicitly incomplete and retains the valid bounded subset for observation. Manual scope-review acknowledgment supplies a normal API recovery path for the remainder, rather than a permanent schema/data blocker. Do not present successful observation as proof that an old write ran.

### `POST /api/delivery-estimates/receipts/legacy/:jobId/reconcile`

```ts
type LegacyResolutionRequest = {
  receivingPaused: true;
  workersRestarted: true;
  actionId: string; // UUID, retained with the exact request for lost-ACK recovery
  observationToken: string;
  reason: string; // 5..1000 trimmed characters
  correctedInventoryIncludesLegacyWork: true;
  acknowledgeUnobservableTargets: boolean;
  legacyReceiptReversalConfirmed?: true; // mandatory for purchase_order_reversal review jobs
};
```

Show the corrected counts and unavailable targets before confirmation. Require explicit `acknowledgeUnobservableTargets: true` when any owner cannot be observed, no owners are available, **or** `sourceIncomplete` is true; the label must acknowledge manual review of unobservable inventory and dependent work, not claim automatic proof. All observed rows must still match under sorted owner locks and an InnoDB row-lock transaction. Authority is the authenticated user, never a client actor ID. Plugin audit and historical ACK are atomic. Lost ACKs replay the identical action, including after token expiry or product deletion; a stale uncommitted observation requires a fresh observation/new UUID. Owner/control-lock contention retries the identical action automatically; it is not mistaken for a stale observation. Reconciliation envelopes allow up to 1 MiB (observation tokens up to 750,000 characters).

Returns **202** `{ accepted:true, jobId:string, actionId:string, state:string }`. Durable retries update the job; only the exact `operator_attested_drained` plugin ACK marks it drained and creates the server audit. `reconciliation_failed` exposes an actionable error. Re-submit an identical prior action first for an uncertain/lost ACK. Authorized replacement managers may retry the saved action without replacing its original attestor; the retry requester is separately audited. Plugin audit also records the authenticating Woo user ID. Receiving stays frozen after review; once all jobs are drained, explicitly re-submit `/cutover` to continue the safe baseline handshake. **No SQL edits or force-stock/replay endpoint are needed.**

Frontend should poll readiness after review: `actions.legacyReview` links to unresolved work; `actions.resumeCutover` becomes `/api/delivery-estimates/cutover` when review is complete (or a baseline exhausted its transport budget) and it is safe to offer the existing three-confirmation resume action. `actions.revalidateActivation` supplies the explicit retry/revalidation route for exhausted activation transport or an invalidated environment fingerprint.

## Wire proof and freshness-agent contract

`attachReceiptProof(tx, accountId, payload)` is exported by `server/src/services/deliveryEstimates/receiptProof.ts`. The caller holds `lockDeliveryAccount` across source projection **and decoration**. `buildInbound` contains exactly one decorator call around `projectInbound`. Source projection stays `receiptSafety: 'unverified'`. Only explicitly certified owners in the active guarded epoch whose `lastSequence === appliedSequence` and whose latest operation is `applied`/`reconciled` are decorated:

```json
{"receiptSafety":"verified","receiptProof":{"version":1,"epoch":"opaque-cutover-uuid","owners":[{"stockOwnerWooId":10,"sequence":0,"operationId":"baseline_opaque-cutover-uuid"}]}}
```

Owners are deduplicated/sorted. A variable parent's unsupported/null container target is not a proof owner; supported variation targets may point to that parent owner. Repeated sibling references must carry **identical pooled batches and lead**; adapters/validation count each pool once and sum cart demand once per owner. Other unsupported/BOM targets remain explicit exclusions. Missing owner certification or unsettled work leaves the entire payload unverified, without inventing generation timestamps.

Plugin inbound storage locks physical owners in sorted order (plus the control fence), verifies epoch and exact current sequence/operation/journal, then publishes the input revision and releases matching guards in **one InnoDB transaction**. Old proofs cannot clear newer guards. `409 overseek_delivery_stale_proof` schedules at most three automatic source rebuilds; persistent conflicts become visible sync errors. Success resets this budget. Old unverified envelopes and existing account aliases remain supported; they do not release guards.

## Inventory receiving and BOM cascade preservation

Being referenced by `usedInBOMItems` or `bomItemsAsChild` does **not** exclude a native component from guarded receiving. It uses the same immutable owner delta and journal as other direct stock. Finished BOM products with inventory-linked BOM items retain legacy receiving behavior: skip their direct stock mutation, report the existing warning, and still complete the PO status transition. Unlinked/SupplierItem-only and missing-product lines remain skipped; missing variations retain their warning. Mixed POs process valid direct targets. Supplier-only costing rows inside a BOM do not themselves make a product a computed-stock receipt target.

Every successful guarded receive creates a `ReceiptCycle`, including empty/skipped-only receipts. `skippedLines` records original decisions and is protected as immutable provenance. No zero-quantity/fake stock operations are created. Reversal uses only that cycle's original **applied/reconciled** targets, never today's edited PO items or reconstructed skip decisions. A pending/failed derived cascade does not prevent an otherwise proven stock reversal; its follow-up work remains durable. Parent-owned reversals address the real parent even if the representative sibling was removed; cache-row rebuilds are resolved through the original Woo identities. A changed/missing physical owner refuses reversal rather than retargeting the delta.

### Durable post-stock work

Receipt rows now expose `cascadeState` (`waiting_receipt`, `pending`, `failed`, `done`), `cascadeAttempts`, `cascadeNextAttemptAt`, `cascadeError`, `cascadeCompletedAt` and `cascadeRetryPath`. Stock ACK and cascade enqueue commit together. Operator-attested reconciliation also enqueues this work. An owner remains `cascadePending` until all settled operations' cascade work completes; its verified inbound proof waits. **Later native receipt/order deltas still advance in sequence after stock ACK**, so a failed derived target cannot stall component inventory mutations. Failures retain the already-settled stock state and never resend the receipt delta. A crashed final attempt becomes an explicit failed job, not permanent invisible pending work.

The worker calls the existing BOM inventory calculator through a strict receipt mode. It uses live Woo stock (not optimistic queued local quantities), surfaces both thrown errors and returned `success:false`, verifies derived write ACKs, pools inherited stock owners, and updates reachable BOM targets in dependency order. Shared targets run once in a healthy pass; cycles fail visibly. Separate account cascade leases serialize derived recomputation and fence its ACK, while heartbeat/progress checks support restart. They never take a native owner's transport lease. Stock work can continue; completion cannot clear newer or older pending cascade obligations. Default non-receipt calculator callers retain their existing behavior.

`POST /api/delivery-estimates/receipts/:operationId/cascade/retry` requires `manage_inventory`, works with the feature off, and returns **202** `{accepted:true, operationId:string, cascadeState:string}`. It resets only failed cascade work and records retry authority. Pending/done requests are idempotent; unresolved stock must first use receipt reconciliation. This is **not** a delta retry endpoint.

`GET /api/delivery-estimates/receipts/cycles?purchaseOrderId=<id>&cursor=<cycleId>` uses the same permission and returns `{cycles: ReceiptCycle[], nextCursor:string|null}` (50 per page). Cycle fields are `id`, `accountId`, `purchaseOrderId`, `active`, `skippedLines`, `createdAt`. This exposes skipped-only provenance even when the operation list is empty.

### BOM orders must not publish absolute component stock over guarded receipts

Guarded-mode BOM consumption and cancellation/restock use the **same owner-sequenced native delta outbox**. Otherwise an absolute write from the optimistic local mirror could erase or double-credit a receipt. `BOMDeductionLedger` links `guardedOperationId` / `guardedReversalOperationId`; native operations expose immutable `sourceType` (`purchase_order`, `bom_consumption`, `bom_reversal`) and `sourceId`. BOM operation references use `purchaseOrderId: "bom-order:<Woo order ID>"` for audit grouping, not a real PO. Their cycles are inactive and cannot be reversed through PO APIs.

Local consumption and outbox intent commit together; `QUEUED_GUARDED` is durable and prevents another local deduction. Cancellation queues one ordered inverse even if consumption has not ACKed yet. Applied consumption becomes `COMPLETED` only after its cascade; a late ACK cannot resurrect a ledger already marked `REVERSED`. These paths never force inherited component variations to manage their own stock.

Legacy absolute BOM writes are tracked as legacy review work. An interrupted/uncertain legacy BOM entry is never converted automatically to a new delta. Cutover materializes old `EXECUTED` BOM entries for the existing operator-attested legacy review workflow. Their jobs expose `sourceType` / `sourceId`; a drain ACK closes the corresponding legacy ledger state. New BOM order mutations during cutover use guarded intents; native stock/cascade dispatch waits while unresolved legacy review jobs remain. Final cutover rechecks all legacy, native and cascade work before changing transport mode.

### Historical legacy PO reversals

`POST /api/delivery-estimates/receipts/legacy-reversals/:purchaseOrderId` with `{receivingPaused:true,workersRestarted:true}` requires `manage_inventory`. It creates an operator-review job and returns **202** `{accepted:true,jobId:string,state:string}` for a legacy `RECEIVED` PO lacking an active guarded cycle. It refuses to bypass guarded provenance. Use that job's existing legacy observation/reconcile endpoints.

The reconciliation request additionally requires `legacyReceiptReversalConfirmed:true` and the incomplete-history acknowledgment. The operator establishes correct counts **excluding the original legacy receipt effect, preserving other completed movements, excluding later queued native operations, and reviewing dependent BOM stock**. The exact observation/audit ACK changes the PO to `ORDERED`; no guessed delta or fictional receipt cycle is created. Receiving remains frozen until the normal resume-cutover action. This is the normal API recovery path for historical receipts whose exact applied targets were never recorded.

### Pre-cutover inventory compatibility and actual risks

`inventory_compatibility_required` exposes affected Woo IDs/reasons before cutover and is rechecked before the final handshake. Known incompatible direct custom types, unmanaged receiving/component targets, fractional stock, invalid whole-unit BOM consumption requirements, and the calculator's unsupported variable-parent BOM configurations require explicit correction. Native owner/data-store/count validation also runs during plugin baseline certification. A newly introduced unsupported type after cutover gets a controlled conflict, never an unsafe absolute fallback. Woo native stock management must remain enabled.

The native delta is attempted at most once under the journal protocol. **BOM propagation is convergent recalculation, not a distributed exactly-once transaction**: after a crash/lost derived-write ACK, a retry can recalculate and repeat a derived absolute write, but never the component receipt/consumption delta. External sales, third-party stock writers and concurrent BOM-definition changes are not atomically locked with the entire derived graph; live-input checks, graph ordering and subsequent sync reduce this window, not eliminate it. Review failed cascades promptly. Owner deletion/remapping and unsupported custom stock integrations remain explicit review conditions. No finished-BOM delivery-date availability or phantom-assembly expansion is introduced.

Schema migration: `server/prisma/migrations/20260922170000_receipt_cascade/migration.sql`. It adds durable cascade/BOM transport state, protects cycle/source provenance and corrects the original receipt CHECK to allow parent-owned variation targets without weakening immutable operation identities.

## Managed-stock adapter

The native variable-owner datastore `WC_Product_Variable_Data_Store_CPT` is explicitly supported alongside native simple/variation datastores. The actual stock writer must remain Woo's native global `WC_Product_Data_Store_CPT`; readiness reports `guarded_receipts_native_stock_store_required` for a replaced global stock store and `transactional_native_stock_storage_required` if the native stock table cannot support transactional observation/reconciliation. These metadata checks are authenticated validation only, never storefront queries. This fixes parent-managed native receiving without changing immutable receipt operations, owner sequences or ledger semantics. Custom datastores are not silently treated as native.

Native `WC_Product_Variation::managing_stock()` may return the literal `'parent'`. The adapter accepts it only for an actual variation whose effective owner and inbound owner pointer both match its verified variable parent, with that parent's `managing_stock()` strictly `true`. It does not accept this marker for a variation-local owner, an unmanaged parent or a non-variation. All existing proof/guard/live-stock checks still run.

The adapter reads native CPT `_stock`, `_stock_status`, `_manage_stock`, `_backorders` directly, not the cart object's cached quantity. It checks the exact released proof/guard before and after the stock/held snapshot, then re-reads and compares after calculation. Held Woo reservations are prior demand; explicit negative-stock backlog is added once, while the engine clamps stock to zero once. For the actual Woo cart only, a hash-matching pending/draft session order is excluded from Woo held quantity to avoid counting this cart twice; synthetic product previews exclude nothing. Parent-managed variations do not get `manage_stock=true` forced onto the variant. Custom Woo stock stores, missing native stock rows, corrupt pools, pending/new guards, stale inbound and unsupported BOM remain unavailable rather than falsely ready. No frontend Overseek HTTP or shipping rate calculation is introduced.

## Verification and outstanding launch work

Final backend SQL cutover gate: **405 tests passed; 22 native-connection tests skipped** in the targeted isolated PGlite run. `tsc --noEmit`, the server build and `git diff --check` passed. Tests cover missing prerequisites before cutover/certification writes, already-guarded idempotent diagnostics, old pending jobs, schema damage during the final ACK, and disable with prerequisites unavailable. Native concurrency coverage adds actual trigger-disable/repair cases for the parent's final PostgreSQL run. Critical checks use the transaction connection and bypass the 15-second diagnostic cache. No migration or plugin runtime changed; read-only verification still matches the frozen ZIP and its 95-file runtime manifest.

Cutover batching review (2026-09-22): **394 backend tests passed; 20 native-connection tests skipped** in the isolated PGlite run; `tsc --noEmit` and `git diff --check` passed. Actual PostgreSQL metadata-page tests cover 500/1000 products (11/21 commands including finalization), a whole 1000-variation product, owner and UTF-8 byte caps, complete-product cursor boundaries, empty/tombstoned/excluded records, oversized variation rejection, and ownership/insertion/deletion fences. Control-drain tests cover multiple pages per tick, fair account rounds, mid-round disable priority, command/time budgets, unchanged lost-ACK replay, bounded source rebuilds and pre-batching payload recovery. Progress and page metadata reuse existing JSON columns; the migration chain remains at 13. No plugin or UI code changed in this optimization.

Inventory-preservation review (2026-09-22): **377 backend tests passed; 12 native-connection tests were skipped** in the isolated PGlite run. TypeScript and Prisma validation passed, as did the PHP receipt/finalizer, inherited-stock, independent-disable and legacy-review harnesses. Added coverage includes component and variation-component receiving, mixed/empty PO cycles, immutable skipped provenance, applied-target reversal, cascade success/failure/restart/exhausted-budget recovery, nonblocking next native sequence, strict live-stock and derived ACK failures, dependency ordering/cycles, guarded BOM consumption/cancellation/reactivation without absolute component writes, manual reconciliation, historical PO reversal review, and the parent-owned variation SQL CHECK. No migration was executed outside isolated tests.

Native-agent handoff: use the **13-migration** fixture (including `20260922170000_receipt_cascade`), regenerate Prisma, and rerun `nativeConcurrency.test.ts` plus the native Woo receipt/BOM scenarios. A stock ACK now means `cascadeState:pending`; drain the cascade before expecting verified inbound release. Later native stock deltas may proceed meanwhile. Guarded BOM order consumption/restock must appear as owner-sequenced receipt operations and must not call the old absolute component writer. A failed derived target must leave visible retryable work while preserving the already-applied delta. The native variable-CPT observer remains unchanged.

Combined-review verification (2026-09-22): **344 tests passed across 29 backend suites**, with `DELIVERY_FRESHNESS_PGLITE` explicitly pointing to an isolated in-memory PostgreSQL engine and no native database URL selected. This includes actual readiness SQL for mixed eligible/BOM-excluded products, all-excluded catalogues, uncertified/integrity-error inputs, configured variation exclusions and deletion/tombstone ACKs. TypeScript and the changed PHP files passed checks. `delivery-control-disable.php` executes the actual PHP control handler/storage/gate against the SQL model: settings remain `enabled:true`, independent disable turns output off, its ACK replays, and an old activation revision is rejected. Native-shaped inherited-stock tests now use `managing_stock() === 'parent'` and retain wrong-owner/unmanaged-parent rejection. Input ACK tests assert no launch-control writes.

The parent-managed native environment should rerun inherited-variation cart estimates and SUPERADMIN feature-off with parked configuration after these fixes. No native Woo result is inferred from the PHP models. The native variable-CPT observer allowlist is preserved; rate mapping, settings schemas and snapshot parsing were not changed by this combined-review patch.

Focused tests include `launch.test.ts`, `revalidation.test.ts`, `legacyRecovery.test.ts`, `reconciliation.test.ts`, route authorization cases, and the PHP `delivery-launch-receipts.php`, `delivery-legacy-recovery.php` and `delivery-managed-stock.php` harnesses. They cover explicit baseline/no auto-baseline, lost control/legacy ACK identity, receiving freeze, disabled-account recovery, authority/body validation, guarded and legacy reconciliation without stock replay, stale/busy observations, unavailable historical targets, authorized retry takeover, future sequence continuation, proof rollback/newer guard rejection, live stock/held/backlog, shared-parent deduplication, automatic settings revalidation, active-plugin roundtrip/network/page invalidation, URI/name false positives, scan-free active/inactive gate reads, and Woo 8/9.7/9.9 presentation compatibility.

Validation run on 2026-09-22: Node **22.23.1**, Vitest **4.1.10**, Prisma **7.8.0**, PHP CLI **8.4.23**. `prisma validate` and `tsc --noEmit` passed. Focused delivery services/routes/Woo receipt tests: **314 passed, 9 skipped** (the isolated database suite is opt-in and was not executed). PHP receipt/finalizer/legacy recovery, inbound input, managed adapter, storefront, cart display, storefront quote and engine harnesses passed; delivery/receipt PHP files passed lint. Woo versions mentioned in harness output are **stub fixtures**, not an installed Woo/WBS compatibility test. Prisma client generation was local only; no database migration execution occurred.

`tests/delivery-receipts-integration.php` now also exercises native parent-managed siblings: positive receipt, sibling receipt, reversal, duplicate ACKs, unchanged variation management, retained terminal journal rows and transactional guard-release rollback. It remains guarded by the disposable `wordpress_tests` database opt-in. This real integration harness was **not executed**: Docker CLI is present but the daemon is unavailable (`/var/run/docker.sock` does not exist); WP-CLI, MySQL/MariaDB server/client and Podman executables were also unavailable in PATH. No existing/live database was used as a substitute. The additive recovery migration is `server/prisma/migrations/20260922160000_delivery_launch_recovery/migration.sql`.

The CLI SQL models **do not prove real MySQL concurrency**. Required before merchant launch: isolated Postgres migration/transaction tests; isolated WP/Woo/MySQL control + proof-publish failure/concurrency tests; complete real-WBS/classic/Blocks checkout and receipt/reversal/reconciliation flow; exact Woo/WBS version recording; old-plugin header detection against the merchant's installed vendor; native held-stock behavior around existing checkout/draft-order reservations; full mobile/desktop/UI/rollback checks. No production rollout or merchant compatibility certification is implied.

Failed/crashed tracked legacy work is recovered through the operator-attested legacy review endpoints above. Unobservable historical effects require explicit manual-review acknowledgment, not impossible automatic proof or a database mode edit. Pre-upgrade untracked process-local jobs still require the explicit drain/restart attestation. Parent-owned UI implementation remains separate; this change makes no client edits.
