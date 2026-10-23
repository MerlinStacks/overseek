# Delivery estimates launch completion contract

Finish functional integration; do not add another permanently inactive scaffold. Live stores must not be deployed/activated automatically during development. Preserve independent account feature availability (default on) and explicit storefront activation after readiness checks.

## Ownership boundaries for implementation

- Receipt/readiness work owns guarded cutover, receipt reconciliation/finalization, verified inbound proof decoration/ingestion, managed-stock adapter reads and the storefront gate. It may extend `buildInbound` at one well-defined decorator call; ordinary projection source/freshness logic remains separate.
- Shipping-option work owns configuration row identities/default selection, WBS/WBSNG rate resolution, discovery and shared PHP/TypeScript order-snapshot rate identity rules. Coordinate shared schema changes using additive patches; do not overwrite other work.
- Freshness work owns targeted mutation invalidation, expiry scheduling and remaining calendar UI; do not independently change the verified receipt-proof protocol.
- Checkout work owns final order capture/classic/Blocks checkout hooks and rate-to-snapshot selection, never changes guard eligibility.

## Readiness, cutover and activation

Provide account-scoped, permission-checked Overseek APIs:

- `GET /api/delivery-estimates/readiness`: current mode/activation, blockers, warnings, sync/freshness/provider support and unresolved receipt counts. No readiness inferred solely from an HTTP 200.
- `POST /api/delivery-estimates/cutover`: explicit confirmation that inventory receiving is paused and pre-upgrade legacy workers are drained/restarted. Persist durable work, do not make a long catalogue/network operation in the request. Refuse unresolved tracked legacy/guarded work. Default stays LEGACY until plugin and baseline handshake succeed.
- `POST /api/delivery-estimates/activation` with `{ active: boolean }`: false always queues a disable; true only after cutover, synced inputs, valid settings and verified receipt protocol. Detect the old estimate plugin and require manual deactivation; never deactivate another plugin automatically.
- Receipt status/list and a reconciliation action for authorized inventory managers, with exact operation identity, fresh observed stock, reason and explicit acknowledgement. Reconciliation is an operator-attested resolution, NOT proof inferred from matching quantity.

Reconciliation must **not retry a possibly applied stock operation**. Require the operator to establish the correct stock count including this operation's effect (and excluding later queued operations), then confirm that observed count under the owner lock. Record who/why and resume the original ordered queue as reconciled. Stale observations reject; lost reconciliation ACKs replay idempotently. Do not offer an automatic “try the delta again” button.

Use monotonic control revisions, account binding, durable retry/capability state and explicit ACKs. No hidden environment variable or database edit should be needed to complete normal setup. Cutover and activation need visible UI and recovery errors. Existing disabled-account controls must still deliver a disable.

## Verified inbound release

- Extend the staged payload with a versioned proof containing the active cutover epoch and one sequence/operation identity per effective stock owner. Unknown/unverified payloads remain accepted only as non-ready inputs.
- Build verified proofs only when source receipt operations for those owners are settled. On the plugin, compare the proof with the current owner guard/journal under the same owner locks used by prepare/apply. An old proof can never clear a newer pending guard.
- Store the matching inbound revision and release its matching guards atomically. A conflicting/stale proof triggers a bounded rebuild, not a forced overwrite.
- Baseline sequence zero must be established explicitly during cutover/initial certification; never infer a missing guard as safe.
- The managed-stock adapter may calculate only from a current verified proof and non-pending matching local guard. Read a coherent live stock/guard snapshot and recheck the guard before returning. Include Woo held stock and explicit negative-stock/backorder demand without double counting. Do not trust a stale cart product object's stock after a concurrent receipt.
- Support Woo parent-managed variation stock using the actual effective owner and deduplicated owner demand/inbound batches. Receipt ledger targets must follow that owner rather than forcing variation-local stock. BOM/component sourcing can remain an explicit unsupported-product exclusion, not a silent stock assumption.

## Shipping options and WBS

- Treat `WC_Shipping_Rate::get_id()` as opaque; method ID and instance ID are separate authoritative properties.
- Configuration supports a core instance mapping, an explicitly confirmed all-provider-rates mapping, or an exact option/rate-ID mapping. Exact overrides take precedence. Unknown providers/options stay blank; do not suppress configured supported methods solely because another offered rate is unmapped.
- Default product-page selection references the configured mapping, including an option ID when needed. Preserve prior valid customer selection, then nominated default, never a third service.
- Support both `wbs` and `wbsng`, including global instance 0 despite vendor getter -1, without deriving numeric instances from title hashes. Preserve costs/taxes/provider text and never recalculate shipping just to render estimates.
- Provide an admin-only way to identify actual rate option IDs or a clearly explicit instance-wide policy in the grid. Do not silently assume Express and Standard rules share transit time.
- Update immutable snapshot parsing/factory tests in both languages to permit valid opaque provider IDs. Parsing an identity does not certify rate eligibility; checkout must use actual selected rates.

## Freshness and remaining integration

- Indexed, bounded renewal before inbound expiry; retries never manufacture a newer generation timestamp. Park unsupported accounts rather than polling each product.
- Transactional or durable targeted invalidation for BOM eligibility, product/variation creation/deletion/ownership, supplier/PO changes and external catalogue reconciliation. Avoid rebuilding the catalogue on price/name edits or every ordinary stock sale.
- Finish the selectable month-calendar holiday UI. Retain separate production/transit weekdays and closure scopes, including weekends.
- Capture the final displayed selected-method estimate for classic and Blocks checkout using the existing first-write helper. Never recalculate it later for email. Missing/unavailable estimates produce no snapshot. Handle checkout retries/draft orders and exact order/shipping identities; reject unsupported multi-destination/partial arrangements rather than invent promises.
- Add the necessary Blocks pickup presentation when that flow is used, or block activation for that unsupported setup with an actionable message; do not claim it works from the standard local_pickup rate hook alone.

## Release verification

Exercise a complete flow in a NEW isolated WordPress/Woo/MySQL environment, including real WBS rates, product/variation/default/prior selection, cart/checkout, receipt/reversal/reconciliation and order snapshot. Test disabled/missing ranges, holidays/cutoff, fresh/stale inputs and old-plugin coexistence. Verify no estimate-induced carrier/Overseek calls on storefront rendering, bounded query/asset overhead, mobile/desktop and rollback. Run available backend/client/core/PHP tests and migrations against an isolated Postgres instance if possible.

Document exact tested versions and remaining store-specific verification. “Ready to launch” must not conceal a hard-false gate, missing supported-provider mapping, uncaptured order promises or an unimplemented reconciliation workflow. Do not deploy to production or claim merchant-specific compatibility without verification.
