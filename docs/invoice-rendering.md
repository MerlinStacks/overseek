# Invoice Rendering Architecture

## Canonical renderer

Invoice PDFs generated from the client use a single canonical path:

- `client/src/utils/InvoiceGenerator.ts`
- Renderer: `designer-capture` (HTML capture of `InvoiceRenderer`)

This path is the source of truth for designer fidelity.

## Fallback renderer (disabled by default)

The legacy vector generator exists only as an emergency fallback:

- `client/src/utils/InvoiceGeneratorVector.ts`
- Enabled only when `VITE_INVOICE_ALLOW_VECTOR_FALLBACK=true`

If the flag is not enabled, capture failures return an explicit error and do not silently switch renderers.

## Server PDF path

`server/src/services/InvoiceService.ts` still contains a PDFKit generator used by server-side automation flows.

Important: this is **non-canonical** for designer fidelity. Use client canonical output when exact visual match is required.

## WooCommerce relay behavior

WooCommerce processing-order relay now uses a canonical artifact workflow:

- Route: `server/src/routes/invoiceRelay.ts`
- Service: `server/src/services/CanonicalInvoiceService.ts`
- Queue: `invoice-canonical-generate`

Current behavior:

- Relay first checks/reuses `InvoiceArtifact` for the account/order/template snapshot.
- If ready, it returns the exact stored PDF artifact.
- If still generating, it returns `202` (`status: pending`) so the plugin can retry asynchronously.
- If generation fails, it returns `409` (`status: failed`).

Fallback renderer control:

- `INVOICE_CANONICAL_FALLBACK_PDFKIT=false` (default): fail when canonical renderer is unavailable.
- `INVOICE_CANONICAL_FALLBACK_PDFKIT=true`: temporarily allow server PDFKit fallback generation.

Artifact freshness control:

- `INVOICE_CANONICAL_INVALIDATE_BEFORE=<ISO datetime>`: if set, artifacts generated before this timestamp are treated as stale and regenerated.

Diagnostic reason values returned by relay/plugin payload:

- `missing_artifact`, `not_ready`, `missing_file`, `non_canonical_renderer`, `generated_before_cutoff`, `forced_refresh`

## Maintenance rules

- Do not add new invoice styling logic to vector/PDFKit renderers unless required for fallback/automation.
- Any visual invoice design changes should be validated against `InvoiceRenderer` output first.
- Keep renderer-path logs enabled so drift is easy to detect.
