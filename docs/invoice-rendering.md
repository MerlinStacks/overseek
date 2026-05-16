# Invoice Rendering Architecture

## Legacy client renderer

Client-side HTML capture (`designer-capture`) is now a legacy path and is not used by the WooCommerce relay generation flow.

## Fallback renderer (disabled by default)

The legacy vector generator exists only as an emergency fallback:

- `client/src/utils/InvoiceGeneratorVector.ts`
- Enabled only when `VITE_INVOICE_ALLOW_VECTOR_FALLBACK=true`

If the flag is not enabled, capture failures return an explicit error and do not silently switch renderers.

## Server PDF path

`server/src/services/InvoiceService.ts` is the production renderer for WooCommerce relay and automation flows.

Important: this is now the primary operational path to prioritize fast, reliable customer downloads.

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

Renderer control:

- Canonical artifact generation now uses PDFKit as the default renderer (`pdfkit-primary`).
- Playwright/browser rendering is removed from the canonical relay generation path.

Artifact freshness control:

- `INVOICE_CANONICAL_INVALIDATE_BEFORE=<ISO datetime>`: if set, artifacts generated before this timestamp are treated as stale and regenerated.

Diagnostic reason values returned by relay/plugin payload:

- `missing_artifact`, `not_ready`, `missing_file`, `non_canonical_renderer` (legacy renderer artifact), `generated_before_cutoff`, `forced_refresh`

## Maintenance rules

- Do not add new invoice styling logic to vector/PDFKit renderers unless required for fallback/automation.
- Any visual invoice design changes should be validated against `InvoiceRenderer` output first.
- Keep renderer-path logs enabled so drift is easy to detect.
