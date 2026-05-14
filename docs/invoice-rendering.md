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

## Maintenance rules

- Do not add new invoice styling logic to vector/PDFKit renderers unless required for fallback/automation.
- Any visual invoice design changes should be validated against `InvoiceRenderer` output first.
- Keep renderer-path logs enabled so drift is easy to detect.
