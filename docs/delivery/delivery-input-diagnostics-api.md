# Delivery input diagnostics and targeted recovery (schema version 1)

Both endpoints use the normal authenticated account context (`X-Account-Id`),
require account membership, return `Cache-Control: no-store`, and remain available
when `DELIVERY_ESTIMATES` is disabled. No request calls WooCommerce directly.

## Inspect attention inputs

`GET /api/delivery-estimates/sync/inputs`

Permission: `view_shipping`.

| Query | Accepted values | Default |
|---|---|---|
| `status` | `blocked`, `failed`, `plugin_update_required`, `attention` | `attention` (union of the other three) |
| `scope` | `settings`, `product`, `inbound` | All scopes |
| `limit` | Integer 1–100 | 25 |
| `cursor` | Opaque `nextCursor` from a previous response | First page |

Unknown/invalid parameters and malformed or mismatched cursors return HTTP 400.
Cursors are bound to the account, status and scope; keep those filters unchanged
when following a cursor. Page size may change. Results are ordered by ascending
immutable input ID. Each request is a local read-only, repeatable-read snapshot;
it does not discover capabilities, enqueue work, renew inputs, or change progress.
Pages across requests are live: a recovered row may leave the attention filter.
Refresh from the first page after a retry.

HTTP 200 response:

```ts
type InputPage = {
  schemaVersion: 1;
  observedAt: string; // ISO timestamp
  items: Array<{
    id: string;
    scope: 'settings' | 'product' | 'inbound';
    entityId: number; // settings: 0; product/inbound: Woo parent product ID
    status: 'blocked' | 'failed' | 'plugin_update_required';
    desiredRevision: string; // decimal integer; do not coerce to JS number
    ackRevision: string;
    attempts: number;
    proofRebuilds: number;
    lastAcknowledgedAt: string | null; // ISO
    updatedAt: string; // ISO
    diagnostic: null | {
      source: 'local' | 'remote';
      phase: 'capabilities' | 'inputs';
      disposition: 'record_rejection' | 'account_suppression';
      attemptedRevision: string | null;
      occurredAt: string; // ISO
      httpStatus: number | null;
      code: string | null;
      reason: string | null;
      message: string;
    };
    payloadSummary: {
      envelopeBytes: number; // UTF-8 size of the exact input envelope
      isTombstone: boolean;
      variationCount: number | null;
      targetCount: number | null;
      generatedAt: string | null;
      expiresAt: string | null;
      expiredAtObservation: boolean;
    };
  }>;
  nextCursor: string | null;
};
```

Tombstones mean disabled settings, an empty/null product production replacement,
or an inbound replacement with no targets. Counts/dates are null when absent.
Expiry is evaluated for inbound inputs at `observedAt`, including empty replacements.

Diagnostics contain fixed server-owned messages and allowlisted codes/reasons only.
They never include upstream prose, Axios data, names, costs, URLs, raw payloads,
receipt proofs or lease details. Unknown remote codes are null. Historical rows
with only generic `lastError` return `diagnostic: null`; the UI should label these
as “Cause not recorded”, rather than infer a validation or authorization cause.

Record diagnostics belong to the exact failed desired revision and lease. A new
desired revision clears them. Historical account suppression may instead be shown
with `disposition: 'account_suppression'` and `attemptedRevision: null`: this records
the account capability/auth decision that parked the row, not evidence that this
particular row was sent or that the account is still faulty. Its message starts
“Previously suppressed by an account-level decision”. The decision is bound internally
to that row's desired revision and remains visible when another row is retried or
successfully synced, even after the capability cache is invalidated. Earlier
instrumented rows with only an account fallback are preserved before retry clears
that fallback. Generic legacy rows without captured evidence remain unknown.
Successful retry clears its record diagnostic; new payloads never inherit an old
historical diagnostic.

Precise remote validation reasons supported:

`schema_invalid`, `inbound_expired`, `inbound_generated_in_future`,
`inbound_ttl_invalid`, `product_missing`, `product_type_unsupported`,
`variation_missing`, `variation_parent_mismatch`, `stock_owner_mismatch`,
`owner_pool_batches_mismatch`, `production_range_invalid`,
`supplier_lead_invalid`, `payload_limits_exceeded`.

Other safe reasons cover authorization, revision conflict, stale proof, transport,
invalid acknowledgement/capabilities and required plugin capabilities. In particular,
`variant_supplier_leads_required` means the input contains different supplier lead
times sharing a stock owner and the plugin has not advertised
`capabilities.variantSupplierLeads: true`. Only affected rows are parked; capability
details are cached per account. Treat reason/code as extensible strings; display the
provided message as text and tolerate nulls.

## Retry one input

`POST /api/delivery-estimates/sync/inputs/:id/retry`

Permission: `manage_shipping_settings`. No request body is needed.

HTTP 202:

```json
{"accepted":true,"disposition":"queued","inputId":"input-id"}
```

`disposition` is one of:

- `queued`: only this attention input was returned to pending. Cached capability
  decisions were cleared so an updated plugin can be detected on the next dispatch.
- `rebuilding`: the selected inbound input is expired, source-dirty, or from an old
  generation. Its target was marked dirty for a current-source rebuild. The builder
  creates a **new revision**; it does not relabel the old payload's timestamps.
  A captured remote `inbound_expired` rejection for the exact desired revision also
  requires rebuilding, even when local expiry is still in the future. Whole-sync
  retry retains this evidence until bounded recovery can queue each rebuild, and
  dispatch never resends those old payloads. Persistent WordPress clock skew leaves
  a freshly rejected revision blocked until another explicit retry; it does not
  start an endless automatic regeneration loop.
- `already_running`: this input is already pending, has a live lease, or account
  transport/full product rebuilding currently owns the work. Poll and retry later
  if it remains in attention. This response does not promise a second job was queued.

HTTP 404 means the input does not exist in the authenticated account. HTTP 409 means
it is not pending or an attention row (for example, already synced). Standard
authentication/context/permission failures are 401/400/403 respectively.

Recovery preserves ACK history and revision monotonicity. It does not force remote
acceptance, delete inputs, reset revisions, or refresh unrelated synced rows.
Missing local products are replaced with a new null-production/empty-variation
tombstone. Whole-sync retries and automatic dispatch also rebuild expired inbound
inputs safely; automatic recovery is bounded to four accounts × ten targets per pass.

## Deployment

Apply the additive `20260923140000_delivery_input_diagnostics` migration before
deploying this server, and generate the Prisma client. It adds nullable diagnostics
and capability JSON fields plus an attention pagination index. No historical errors
are backfilled with inferred codes. A precise live cause becomes available after
the input is attempted by this server version and the plugin returns a known reason.
