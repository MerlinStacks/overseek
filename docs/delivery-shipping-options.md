# Delivery shipping-option contract

## Settings API and JSON schema

`GET/PUT /api/delivery-estimates/settings` retain the existing complete settings document, account binding, feature checks, `view_shipping`/`manage_shipping_settings` permissions and 512 KiB envelope limit. No migration is needed for the new optional JSON fields.

Each `shippingMethods[]` row retains `methodId`, `instanceId`, `zoneId`, `zoneName`, `title`, `enabled`, `minTransitDays`, `maxTransitDays`, and `fulfilmentType`. It adds:

| Field | Contract |
| --- | --- |
| `mappingKind` | Optional `core_instance` (omitted means this for backward compatibility), `all_provider_rates`, or `exact_rate`. |
| `rateId` | Required only on an `exact_rate` row. Full opaque actual `WC_Shipping_Rate::get_id()`, 1–200 printable non-space ASCII characters (`[\x21-\x7e]`). Never split, decode, trim, infer from SKU, title, or vendor rule number. |
| `allRatesConfirmed` | Boolean; must be `true` for `all_provider_rates`. Must not be `true` for other kinds. Explicit merchant affirmation that every emitted option shares this range except exact overrides. |

Method IDs use `[A-Za-z0-9_-]{1,100}`; instance and zone IDs are integers 0–2147483647. Ranges remain integers 0–3650, min ≤ max. Up to 500 mappings. Duplicate keys are rejected across zones. Identity key is `(methodId, instanceId, mappingKind, exact-rate-ID-if-applicable)`; omission and explicit `core_instance` have the same key. Both old core rows and old unverified WBS rows remain schema-valid. Only core flat/free/pickup use the implicit policy; old WBS rows remain blank until deliberately remapped.

`defaultMethod` is null or `{ methodId, instanceId, mappingKind?, rateId? }` referencing an enabled mapping. `exact_rate` requires its row's ID. `all_provider_rates` may additionally nominate a `rateId` without changing the mapping key; otherwise known-address selection requires exactly one eligible option in that instance. A core default cannot carry `rateId`.

Example **identity shape** (replace the illustrative IDs with discovered actual IDs):

```json
{
  "shippingMethods": [
    {"methodId":"wbs","instanceId":0,"mappingKind":"exact_rate","rateId":"wbs:actual_standard_id","zoneId":0,"zoneName":"Global","title":"Standard","enabled":true,"fulfilmentType":"delivery","minTransitDays":4,"maxTransitDays":6},
    {"methodId":"wbs","instanceId":0,"mappingKind":"exact_rate","rateId":"wbs:actual_express_id","zoneId":0,"zoneName":"Global","title":"Express","enabled":true,"fulfilmentType":"delivery","minTransitDays":1,"maxTransitDays":2}
  ],
  "defaultMethod":{"methodId":"wbs","instanceId":0,"mappingKind":"exact_rate","rateId":"wbs:actual_standard_id"}
}
```

Resolution uses the rate's discrete method/instance getters as authoritative. Exact mapping first, then confirmed instance-wide mapping, then compatible core instance. Disabled exact rows exclude that rate even with an enabled broad mapping. Unknown providers/options stay blank; they do not poison other mapped rates. WBSNG `wbsng_solution` multi-shipment metadata remains excluded. No rate price, tax, label, description, provider metadata, session choice or Woo package is rewritten.

Unknown-address product rendering uses a timing-only stand-in for the nominated mapping, never a Woo quote or price. Known-address rendering only uses the existing certified session/package quote adapter: valid previous selection, then nominated default, otherwise blank. No third service and no extra shipping calculation. Existing Woo-version/hash guards (reviewed 9.7–10.9 and 11.0–11.1) remain applicable. A successful mapping does not bypass stock, freshness, receipt, activation or package eligibility.

## Administrative discovery and UI

`GET /api/delivery-estimates/shipping-methods` now requires `manage_shipping_settings` in addition to the existing account/view/feature checks. It proxies the existing plugin `GET /wp-json/overseek/v1/delivery-estimates/shipping-methods`; the plugin requires Woo management credentials and matching `X-Overseek-Account-Id`. Server transport requires HTTPS, uses private Basic-auth headers rather than query credentials, disables redirects, and caps response size/time. Both responses are no-store (plugin also private). Errors never forward vendor exceptions or credentials.

Existing response: `{status:"available", timezone, methods, warnings, capabilities}`; old-plugin capability/404 behaviour remains `plugin_update_required`. Methods retain their old fields and add optional:

```ts
observedRates?: Array<{ rateId: string; title: string; capturedAt: string /* UTC ISO */ }>;
```

The plugin observes `woocommerce_package_rates` **only for a signed-in `manage_woocommerce` user**, after the normal Woo calculation. It stores at most 100 allowlisted identities/labels/timestamps in an account-scoped transient for 24 hours; the last package calculation replaces the previous observation. It captures no address, contents, SKU, prices, tax or secrets. Ordinary customer calculations cause no observation reads/writes. It neither triggers a quote nor calls a carrier/Overseek service. Observation is evidence of an actual past emitted ID, not current eligibility. Normal Woo cache hits do not re-run this filter: change a cart quantity/destination normally in the admin's test session if an observation is needed. Do not flush live customer sessions for discovery.

Discovery includes zone instances and global WBS/WBSNG instances; only the known vendor global getter `-1` with actual method `instance_id` zero normalizes to 0. It never interprets title hashes as instance numbers. Global rows are displayed alongside zone zero; their method/instance identity is distinct from rest-of-world zone instances.

Grid UI provides the three policies, actual rate-ID input, and a required affirmative checkbox for all-provider-rates. Default selection stores the exact mapping identity and supports a nominated actual option for a broad policy. Old WBS rows display an unverified-policy message. Discovery displays observed labels/IDs/timestamps for copying into exact rows, and instructions for admin capture or explicit broad policy. Import remains disabled draft rows with transit review; it does not overwrite existing mappings or nominate a default. Rename/repeated-title changes can change generated IDs: refresh, review and remap explicitly.

## Snapshot identity

PHP parser/factory and shared core parser use the same bounded opaque grammar above; method IDs and nonnegative safe-integer instance IDs are discrete fields. No rate-prefix, numeric second-segment, or colon-suffix assumption remains. Snapshot version and 8 KiB bound are unchanged. Engine rate IDs now allow 200 characters to match snapshots; stock-owner grammar remains unchanged. Factories still require the selected rate ID to be present in the complete calculation. Checkout must supply actual selected rate metadata; parsing an arbitrary matching shape does not certify a rate.

## Native WBS 6.18.0 fixture for the integration agent

Code: `overseek-wc-plugin/tests/delivery-wbs-native-fixture.php`. This is a **setup + native adapter test**, not a live-customer version claim and not yet a completed storefront integration run in this task. It refuses production WP environment type, missing explicit disposable marker, a different WBS version, existing zones/global rules or an existing fixture marker.

In a **new isolated** WordPress/WooCommerce/MySQL site, install the companion plugin and public WordPress.org WBS release **6.18.0**. Set `WP_ENVIRONMENT_TYPE` to `local` or `development`. Run:

```sh
wp plugin install weight-based-shipping-for-woocommerce --version=6.18.0 --activate
OVERSEEK_NATIVE_FIXTURE=disposable wp eval-file /path/to/overseek-wc-plugin/tests/delivery-wbs-native-fixture.php --use-include
```

The script creates a 1 kg simple product at 50 currency units, an AU zone with native `wbs` and `wbsng` instances, and global instances of each. It seeds Standard (base charge 10) and Express (20), unrestricted destination/weight rules; WBSNG split shipping is disabled. Then it calls **native provider calculations in this test script only**, verifies two actual rates for each provider/instance, metadata (including global instance 0 despite getter -1), price and exact-mapping selection, and that mapping leaves the rate unchanged. Output lists actual generated IDs, complete mapping rows, product ID, Woo/WBS/PHP versions. It does not save Overseek delivery settings or activate the storefront. Destroy the disposable site after testing; reruns refuse existing fixture state.

Public GPL source reviewed at the **6.18.0 tag**, not a merchant installation:

- `https://plugins.svn.wordpress.org/weight-based-shipping-for-woocommerce/tags/6.18.0/server/src/ShippingMethod.php`
- `.../server/src/RulesMapper.php` (`meta`, `conditions`, `charges.base`, `charges.weight`)
- `.../server/vendor/dangoodman/shengine-wc-converters/src/RateConverter.php` (title MD5/slug, duplicate suffix)
- `.../server/wbsng/src/ShippingMethod.php`
- `.../server/wbsng/src/Model/Config/{Document,Method,Rule,Charge,DestCond}.php`
- `.../server/wbsng/src/Model/Config/Document/Settings.php` and `Method/Settings.php`
- `.../server/wbsng/src/SolutionMeta.php` (multi-shipment marker).

### Required native follow-up matrix

1. Use output actual Standard/Express rows in the full settings document; nominate Standard. Verify distinct 4–6 vs 1–2 transit, not a shared inferred range. Repeat global and zone cases for both providers.
2. Unknown product address: nominated default timing only. Known certified quote: prior Express wins over Standard default; invalid previous falls back to Standard only when offered. If neither exists, remain blank even when a third mapped option is offered. Test selected variation and quantity changes; stale/session-version-unsupported quote stays blank without recalculation.
3. Mix mapped Standard, unmapped Express and an unsupported carrier: Standard remains visible. Add a confirmed broad row and exact Express override; disable the exact row and ensure Express stays blank. Missing broad confirmation must fail server/PHP validation.
4. Rename Express, use duplicate titles and inspect actual emitted IDs. Old exact mapping must not silently migrate. Admin normal calculation capture and manager-only discovery must expose actual IDs; customer/public and wrong-account requests cannot read them. Verify bounded output and no secrets.
5. Classic and Blocks cart/checkout: compare serialized cost/taxes, provider description/delivery text and WBSNG breakdown before/after. No estimate-induced calculation, carrier call or Overseek storefront request. Test WBSNG multi-shipment metadata stays blank. Test shipping taxes with actual configured tax rates, not just tax-free default fixtures.
6. Capture final actual selected option through the checkout agent's lifecycle; PHP/core snapshot round trip preserves global/title-derived IDs. Email uses that immutable snapshot after provider rule/title changes. Run guarded stock/freshness/cutover tests under their owners' integration setup, not by bypassing their gate.
7. Record exact WP/Woo/WBS/PHP/MySQL versions and native assertions, desktop/mobile screenshots, and remaining merchant/theme-specific checks. Do not describe this code fixture alone as successful live-store certification.
