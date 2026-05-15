# Invoice Integration Contract

Production contract for third-party plugins integrating with OverSeek WooCommerce invoice access.

## Availability

- API available since plugin version: `2.16.0`
- Minimum WordPress: `6.4`
- Minimum WooCommerce: `7.0`

## 1) Final stable API

### Public PHP functions (stable)

```php
overseek_get_invoice_for_order( int $order_id, ?int $user_id = null ): ?array
overseek_invoice_is_available( int $order_id ): bool
```

### Recommended integrator flow

- For status-aware UI, call `overseek_get_invoice_for_order()` first and branch on `status`.
- Use `overseek_invoice_is_available()` as an optional fast check when you only care about ready-link rendering.
- If you need pending/failed UI states, do not gate exclusively on `overseek_invoice_is_available()`.

### Stable hooks and filters

- `overseek_invoice_payload`
  - Type: filter
  - Signature: `apply_filters( 'overseek_invoice_payload', array $payload, WC_Order $order ): array`

### Internal hooks (not integration contract)

- `overseek_invoice_generate_for_processing_order` (scheduled internal event)
- `overseek_invoice_cleanup_daily` (scheduled internal event)

## 2) Data contract (stable)

`overseek_get_invoice_for_order()` and `GET /wp-json/overseek/v1/invoices/<order_id>` return the same payload shape:

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

### Field requirements

- `order_id` (required): integer
- `invoice_id` (required): string
- `invoice_url` (optional): string URL or `null`
- `pdf_url` (optional): string URL or `null`
- `status` (required): enum `pending | ready | failed`
- `issued_at` (optional): ISO8601 datetime string (`gmdate('c')`) or `null`

### Status meaning

- `pending`: generation requested or not finished
- `ready`: private PDF exists and is readable
- `failed`: generation attempt failed

### `issued_at` timezone

- UTC, generated with `gmdate('c')`

## 3) Authorization and security

### Permission rules

- Order customer: allowed when current/logged user ID matches order `customer_id`
- Admin/shop manager: allowed with capability `manage_woocommerce`
- Site admins are also allowed via capability `manage_options`

### Guest order behavior

- Guests are denied for API and REST retrieval (no unauthenticated invoice access)

### Link protection

- `invoice_url` and `pdf_url` are auth-protected REST URLs
- Links are not signed and are not single-use
- Access is enforced at request time by user auth + ownership/capability checks

### Cache safety

- Download endpoint sets private no-cache headers:
  - `Cache-Control: private, no-store, no-cache, must-revalidate, max-age=0`
  - `Pragma: no-cache`
  - `Expires: 0`

## 4) Runtime behavior

### Return behavior (PHP)

- `overseek_get_invoice_for_order(...)`:
  - `array` when order exists and caller is authorized
  - `null` when order missing or unauthorized
- `overseek_invoice_is_available(...)`:
  - `true` only when file exists and is readable
  - `false` otherwise

### State behavior

- Pending invoice: payload returns `status: "pending"` and `invoice_url/pdf_url: null`
- Missing invoice: treated as `pending` unless explicit failed marker exists
- Unauthorized: PHP function returns `null`; REST returns `403` or `401`
- Failed invoice: payload returns `status: "failed"`

### Exceptions

- Public invoice functions do not throw; they return `null`/`false` on failures

### Pending-to-ready retry behavior

- Scheduled attempt occurs ~2 seconds after order moves to `processing`
- Additional opportunistic attempt occurs during `customer_processing_order` email attachment handling if invoice meta is missing
- No exponential retry queue is currently implemented

## 5) REST contract

### Endpoints

- Invoice details: `GET /wp-json/overseek/v1/invoices/<order_id>`
- Invoice PDF: `GET /wp-json/overseek/v1/invoices/download?order_id=<order_id>`

### Auth requirements

- WordPress authenticated user session (cookie auth)
- Caller must be:
  - order owner, or
  - user with `manage_woocommerce` or `manage_options`

### Canonical error body

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

### Canonical status codes

- `401`: unauthenticated
- `403`: authenticated but unauthorized
- `404`: order/invoice not found
- `409`: invoice pending or failed

## 6) Compatibility policy

- Public compatibility scope:
  - `overseek_get_invoice_for_order()`
  - `overseek_invoice_is_available()`
  - `overseek_invoice_payload` filter
  - REST paths in this document
  - Payload field names and status enum in this document
- Backward compatibility guarantee: maintained across minor versions
- Deprecation window: minimum 2 minor releases before removal
- Breaking changes announcement location: root `CHANGELOG.md` under integration notes

## 7) Testing pack

### Sample payloads

Ready:

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

Pending:

```json
{
  "order_id": 1235,
  "invoice_id": "order-1235",
  "invoice_url": null,
  "pdf_url": null,
  "status": "pending",
  "issued_at": null
}
```

Failed:

```json
{
  "order_id": 1236,
  "invoice_id": "order-1236",
  "invoice_url": null,
  "pdf_url": null,
  "status": "failed",
  "issued_at": null
}
```

### Required test scenarios

- Order owner can fetch details and download PDF
- Unrelated authenticated customer gets `403`
- Admin/shop manager (`manage_woocommerce`) can fetch/download
- Guest request gets `401`
- Pending invoice details endpoint returns `409`
- Failed invoice details endpoint returns `409`
