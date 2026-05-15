# Invoice Integration Handoff (For Partner Dev Team)

Use this as the quick production contract.

## Version

- Available since: `overseek-wc` `2.16.0`
- Minimum WordPress: `6.4`
- Minimum WooCommerce: `7.0`

## PHP API

```php
overseek_get_invoice_for_order( int $order_id, ?int $user_id = null ): ?array
overseek_invoice_is_available( int $order_id ): bool
```

Recommended flow:

- Call `overseek_get_invoice_for_order()` first and branch on `status`.
- Use `overseek_invoice_is_available()` only when status-aware UI is not needed.

## REST API

- Details: `GET /wp-json/overseek/v1/invoices/<order_id>`
- PDF: `GET /wp-json/overseek/v1/invoices/download?order_id=<order_id>`

## Payload

```json
{
  "order_id": 1234,
  "invoice_id": "INV-2026-00124",
  "invoice_url": "https://example.com/wp-json/overseek/v1/invoices/download?order_id=1234",
  "pdf_url": "https://example.com/wp-json/overseek/v1/invoices/download?order_id=1234",
  "status": "ready",
  "issued_at": "2026-05-15T10:30:00+00:00"
}
```

- `status` enum: `pending | ready | failed`
- `issued_at`: ISO8601 UTC (`gmdate('c')`)
- `invoice_url` and `pdf_url` are currently equivalent (same auth-protected download endpoint), but both fields remain in contract for forward compatibility.

## Access rules

- Allowed:
  - order owner
  - users with `manage_woocommerce`
  - users with `manage_options`
- Denied:
  - guests (unauthenticated)
  - authenticated non-owner customers

## Error contract

- `401` unauthenticated
- `403` unauthorized
- `404` order/invoice missing
- `409` invoice pending or failed

Body shape:

```json
{
  "success": false,
  "error": {
    "code": "invoice_forbidden",
    "message": "You are not allowed to access this invoice.",
    "status": 403
  }
}
```

## Recommended client behavior

- On `409 pending`, retry after 10 to 30 seconds.
- On `409 failed`, show a distinct "Invoice Failed" message and allow retry-later UX.
- Do not cache invoice links beyond session state.

## Full spec

- See `docs/INTEGRATION.md` for complete compatibility policy and test pack.
