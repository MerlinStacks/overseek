# Email Preferences Plugin API

This document defines the public OverSeek API contract for WooCommerce plugin preference pages.

## Authentication

Send this header on all requests:

- `x-overseek-webhook-secret: <account webhook secret>`

Behavior:

- If the account has `webhookSecret` configured, the header must match.
- If no `webhookSecret` is configured, requests are allowed.

## Base Path

- `/api/email`

---

## 1) Get List Preferences

Endpoint:

- `GET /api/email/lists/public/preferences?accountId=<id>&email=<email>`

Purpose:

- Returns per-list subscription state for a single email address.

Example response:

```json
{
  "success": true,
  "accountId": "acc_123",
  "email": "customer@example.com",
  "preferences": [
    {
      "id": "list_a",
      "name": "VIP Customers",
      "description": "High-value repeat buyers",
      "isSubscribed": true,
      "updatedAt": "2026-05-12T10:22:11.000Z"
    },
    {
      "id": "list_b",
      "name": "Product Launches",
      "description": null,
      "isSubscribed": false,
      "updatedAt": null
    }
  ]
}
```

---

## 2) Update List Preferences

Endpoint:

- `POST /api/email/lists/public/preferences`

Body:

```json
{
  "accountId": "acc_123",
  "email": "customer@example.com",
  "listIds": ["list_a", "list_c"]
}
```

Purpose:

- Sets list subscriptions for the email in one call.
- `listIds` are treated as subscribed lists.
- Active lists not included in `listIds` are marked unsubscribed.

Example response:

```json
{
  "success": true
}
```

---

## 3) Get Unified Preferences

Endpoint:

- `GET /api/email/preferences/public?accountId=<id>&email=<email>`

Purpose:

- Returns global email preference flags and list-level subscriptions.

Example response:

```json
{
  "success": true,
  "accountId": "acc_123",
  "email": "customer@example.com",
  "preferences": {
    "globalSubscribed": true,
    "marketingSubscribed": true,
    "unsubscribedScope": null,
    "unsubscribeReason": null,
    "updatedAt": null,
    "lists": [
      {
        "id": "list_a",
        "name": "VIP Customers",
        "description": "High-value repeat buyers",
        "isSubscribed": true,
        "updatedAt": "2026-05-12T10:22:11.000Z"
      }
    ]
  }
}
```

Semantics:

- `globalSubscribed: false` means unsubscribe from all email (`scope=ALL`).
- `marketingSubscribed: false` with `globalSubscribed: true` means marketing-only unsubscribe (`scope=MARKETING`).

---

## 4) Update Unified Preferences

Endpoint:

- `POST /api/email/preferences/public`

Body:

```json
{
  "accountId": "acc_123",
  "email": "customer@example.com",
  "listIds": ["list_a"],
  "marketingSubscribed": true,
  "globalSubscribed": true,
  "reason": "Updated via account page"
}
```

Purpose:

- Updates list memberships and global/marketing suppression state together.

Behavior:

- Always updates list subscriptions from `listIds`.
- If `globalSubscribed` is `false`, suppression is upserted with `scope=ALL`.
- Else if `marketingSubscribed` is `false`, suppression is upserted with `scope=MARKETING`.
- If explicitly resubscribed (`globalSubscribed: true` or `marketingSubscribed: true`), suppression is removed.

Example response:

```json
{
  "success": true
}
```

---

## Errors

- `400` Invalid input
- `401` Unauthorized (invalid/missing webhook secret when required)
- `500` Internal server error

## Plugin Integration Notes

- Normalize email to lowercase before sending for consistency.
- For preference center UI, use unified endpoints (`/preferences/public`) as the primary source.
- Use list-only endpoints if you need a lightweight list widget separate from global marketing controls.
