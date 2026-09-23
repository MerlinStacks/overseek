# Native variant supplier validation — 2026-09-23

## Result

**PASS: 293 aggregate checks, all 43 native child runs, zero failures and zero
fixture-cleanup errors.** The source plugin remained version 2.23.0; this run
validated an isolated copy of the patched source, not a 2.23.1 release archive.

| Component | Version |
| --- | --- |
| WordPress | 7.1.1 |
| WooCommerce | 11.1.1 |
| Weight Based Shipping | 6.18.0 |
| PHP | 8.4.23 |
| MySQL | 8.4.8 |

The runner created a fresh WordPress install and fresh MySQL data directory under
`/tmp/opencode/overseek-variant-native-20260923`, using a dedicated MySQL process,
Unix socket and loopback port 43429. It created its own `wordpress_tests` database.
It did not connect to an existing/user database. WordPress external HTTP, cron and
mail were blocked. Public WordPress core was downloaded by WP-CLI; Woo/WBS were
installed from the existing local public-source ZIPs. The runner used PHP mysqli
for private SQL because the local MySQL CLI required unavailable `libncurses.so.6`.

## Commands actually run

The retained provisioning/teardown runner creates a new isolated installation on
each invocation; it refuses to reuse an existing WordPress or MySQL data directory:

```sh
python3 /tmp/opencode/overseek-variant-native-20260923/run-native.py
```

It invoked the source aggregate with these environment settings and command:

```sh
OVERSEEK_RUN_DISPOSABLE_DB_TESTS=1 \
OVERSEEK_NATIVE_ARTIFACT_DIR=/tmp/opencode/overseek-variant-native-20260923 \
WP_CLI_CACHE_DIR=/tmp/opencode/overseek-variant-native-20260923/cache \
WP_CLI_CONFIG_PATH=/tmp/opencode/overseek-variant-native-20260923/wp-cli.yml \
LD_LIBRARY_PATH=/tmp/opencode/mysql-libs/usr/lib/x86_64-linux-gnu \
php -d sendmail_path=/bin/true \
  /tmp/opencode/overseek-delivery-integration-bVKWca5q/wp-cli.phar \
  --path=/tmp/opencode/overseek-variant-native-20260923/wordpress \
  eval-file \
  "/home/agent/workspaces/Coding Files/Overseek/overseek/overseek-wc-plugin/tests/delivery-native-integration.php" \
  --use-include
```

The WordPress path has since been removed by successful teardown. For other
environments, provision the public dependencies and use the guarded instructions
in `overseek-wc-plugin/tests/delivery-native-integration.md`.

## New reusable native regression

`overseek-wc-plugin/tests/native/delivery-native-variant-leads.php` is included by
the existing `delivery-native-protocol.php`, under its owned-fixture lifecycle.
It uses real Woo parent-managed variations, real REST ingestion, control
baseline/guarded/activation, native stock SQL and receipt finalization. No mocked
Woo product, forced activation filter or guard bypass is involved.

The test remaps the shared producer-shaped fixture to native IDs. With A supplier
lead 2–4 and production 0–1, B supplier lead 7–10 and production 3–5, the run's
effective date was 2026-09-24:

| Case | Readiness observed |
| --- | --- |
| A-only preview | Sep 26–29 |
| Full A+B cart, either order | Oct 4–9 |
| Null A lead, configured fallback 30, A-only | Oct 24–25 |
| Null A lead, full cart | Oct 27–29 |
| Null A lead, configured fallback 0 | Sep 24–25 |
| Explicit A lead 0, configured fallback 30 | Sep 24–25 |
| Four dated units on Sep 25 cover four cart units | Sep 28–30 |
| Three shared dated units cannot cover four cart units | Oct 4–9 |
| One stock unit plus three dated units cannot cover five | Oct 4–9 |

Actual REST validation returned generic HTTP 400
`overseek_delivery_input_invalid` responses with exact `data.reason` for:
`owner_pool_batches_mismatch`, `inbound_expired`, `inbound_generated_in_future`,
`inbound_ttl_invalid`, `supplier_lead_invalid`, `stock_owner_mismatch`,
`production_range_invalid`, `schema_invalid` and `payload_limits_exceeded`.

An oversized request body returned the preserved **HTTP 413** response:

```json
{
  "code": "overseek_delivery_input_too_large",
  "message": "Delivery input exceeds the size limit.",
  "data": { "status": 413, "reason": "payload_limits_exceeded" }
}
```

A native prepared receipt suppressed the full cart; applied-but-unpublished stock
still suppressed the fast preview. Publishing the matching owner proof released
the guard and restored the Sep 28–30 dated-supply estimate.

The aggregate additionally passed the existing native receipt, classic/Blocks
render/cache and CPT/HPOS capture suites. These tests verify the code contract;
they do not establish the cause of the user's 23 live blocked records.

## Artifacts and cleanup

Retained under `/tmp/opencode/overseek-variant-native-20260923/`:

- `REPORT.json`: provisioning/native commands, versions, result and teardown.
- `native-full-aggregate.log`: exact new scenario results and all aggregate checks.
- `overseek-native-20260923-222412-5bea37ef/results.json`: 293 checks, 43 successful
  child runs, installed-runtime provenance, empty failure/cleanup-error lists.
- `database-cleanup-checks.log`: **zero** suite markers, fixture users, fixture
  products, account input rows, owner guard rows and failure triggers.
- `drop-private-database.log` and `shutdown-private-mysql.log`: successful teardown.

The runner dropped `wordpress_tests`, stopped its private MySQL process, verified
port 43429 was closed, and removed WordPress, MySQL data, cache and binary logs.
Only test scripts, logs and reports remain. No production access, commit, version
bump or release package was made.
