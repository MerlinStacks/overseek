# Shipping discovery bridge

`GET /api/delivery-estimates/shipping-methods` uses the existing bearer authentication,
`X-Account-Id` account membership, `DELIVERY_ESTIMATES` feature gate, `view_shipping`
and `manage_shipping_settings` permissions. Responses have `Cache-Control: no-store`.

## HTTP 200

```typescript
{
    status: 'available' | 'plugin_update_required';
    timezone?: string;
    methods: Array<{
        methodId: string;
        instanceId: number;
        zoneId: number;
        zoneName: string;
        title: string;
        enabled: boolean;
        provider: 'woocommerce' | 'weight_based' | 'unknown';
        rateIdentityScope: 'method_instance';
        requiresRateVerification: boolean;
        observedRates?: Array<{ rateId: string; title: string; capturedAt: string }>;
    }>;
    warnings: string[];
    capabilities?: {
        shippingMethods: boolean;
        calculationEngine: boolean;
        configurationSync: boolean;
        storefront: boolean;
    };
}
```

An available result includes timezone and capabilities. A plugin endpoint HTTP 404
returns `plugin_update_required`, empty methods, no timezone/capabilities and the warning
`Update the Overseek WooCommerce plugin to enable shipping discovery.` An explicitly
false `shippingMethods` capability produces the same result with capabilities included.

Available results always include the warning `Discovery availability does not mean
configuration sync is ready or storefront delivery estimates are live.` Additional
warnings are generated locally for methods requiring rate verification. Arbitrary
upstream warning text, unknown properties, costs and settings are never forwarded.
Settings readiness remains `syncStatus: 'plugin_update_required'` and
`storefrontActivated: false`; discovery does not mutate it.

## Upstream error responses

Errors have exactly `{ error: string, code: string }`:

| HTTP | code | error | Condition |
| --- | --- | --- | --- |
| 502 | `DELIVERY_DISCOVERY_INVALID_RESPONSE` | `Invalid shipping discovery response.` | Invalid capabilities or methods payload, including unsupported schema version |
| 502 | `DELIVERY_DISCOVERY_AUTH_FAILED` | `Shipping discovery authorization failed.` | Plugin HTTP 401/403, including account linkage/permission failures |
| 502 | `DELIVERY_DISCOVERY_UPSTREAM_ERROR` | `Shipping discovery request failed.` | Other upstream failures, including redirects and response byte-limit errors |
| 503 | `DELIVERY_DISCOVERY_UNAVAILABLE` | `Shipping discovery is unavailable.` | Account/credential initialization failure, upstream 429/5xx, timeout/cancellation or common network availability errors |

Existing local authentication, membership, feature and permission errors remain in
force. Neither upstream error bodies nor credential-bearing transport errors are
returned or logged by this bridge.

## Validation and transport bounds

Each call loads credentials through `WooService.forAccount`. It GETs
`overseek/v1/delivery-estimates/capabilities`, validates it, then GETs
`overseek/v1/delivery-estimates/shipping-methods`. Both send
`X-Overseek-Account-Id` using the account context and HTTPS Basic header credentials
(`queryStringAuth: false`); non-HTTPS discovery is rejected before sending. Each request has a 10-second timeout/deadline, 1 MiB response limit, zero
redirects and no retries or credential-probe requests. There is no background polling.

Both upstream schema versions must be numeric `1`. Plugin version is required with
1–64 characters. All four capability flags and both method flags must be booleans.
IDs must be nonnegative safe integers (zone zero is supported). Method IDs must match
`[A-Za-z0-9_-]{1,191}`. Titles and zone names are limited to 255 characters; timezone
is required with 1–100 characters. Providers and identity scope use the exact enums
above. Missing identity scope is invalid. At most 1,000 methods and 1,000 upstream
warnings (512 characters each) are accepted; excessive arrays are rejected rather
than silently truncated. Output properties are allowlisted.

Observed options are optional for old companion compatibility and bounded to 100
per method: opaque printable non-space ASCII `rateId` (1–200), `title` (≤200 UTF-16
units), and UTC ISO `capturedAt`. They are past admin-only observations, not current
eligibility. Global WBS/WBSNG discovery normalizes the known vendor method getter
-1 to actual rate instance zero, never by parsing full rate IDs. See
`docs/delivery-shipping-options.md` for settings policy and native fixture instructions.
