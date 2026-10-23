# Installed candidate ZIP validation — 2.23.1

## Certified candidate

- Archive: `/tmp/opencode/overseek-release/candidate-2.23.1/overseek-wc-plugin.zip`
- SHA-256: `365bc2369e44352a721dffd3b36d00d53888bf030ecb8222e00a456dd0622781`
- Size: **254,315 bytes**; **96 files**.
- Manifest: adjacent `overseek-wc-plugin.manifest.json`.
- Result: **PASS**, 2026-09-23.

The archive was installed with WP-CLI into a fresh normal plugin directory, not
copied from source or symlinked. All 96 archive entries matched the supplied
manifest, and the complete installed file set and SHA-256 hashes matched before
and after the native tests. The candidate ZIP digest was unchanged after teardown.
The existing default 2.23.0 download was not modified.

## Environment and runtime provenance

Fresh WordPress **7.1.1**, WooCommerce **11.1.1**, WBS **6.18.0**, PHP **8.4.23**,
and MySQL **8.4.8**. Installed plugin version: **2.23.1**.

The private root was `/tmp/opencode/overseek-candidate-2.23.1-native`.
MySQL used its own new data directory, Unix socket, process and loopback port
**43431**, with a newly created `wordpress_tests` database. No existing/user
database was used. WordPress HTTP and cron were disabled, fixture HTTP/mail filters
were active, and PHP sendmail was `/bin/true`; explicit provisioning downloaded
public WordPress core and installed the local public Woo/WBS ZIPs.

Initial reflection verified **44 loaded production classes**, including the new
input exception, inbound/input validators, input/discovery APIs and live adapter.
Every runtime class resolved beneath:

`/tmp/opencode/overseek-candidate-2.23.1-native/wordpress/wp-content/plugins/overseek-wc-plugin`

The aggregate's final reflection and **all 43 child-process provenance records**
also passed installed-root, non-symlink, version, candidate SHA and manifest hash
checks. `capabilities.variantSupplierLeads` was **true**. No test include-path
correction or runtime/source edit was needed for this certification.

## Passed checks

- **293 aggregate checks**, **43/43 native child runs**, no failures or cleanup errors.
- Actual WordPress REST ingestion of shared-owner variants with **2–4 / 7–10**
  supplier leads: single fast preview, full-cart maximum, reversed order,
  independent production ranges and whole-order readiness.
- Null configured fallback, configured zero, explicit zero, cumulative dated
  supply priority and single-count stock/batches.
- Exact HTTP **400** `overseek_delivery_input_invalid` reasons, including expired,
  future-generated, invalid TTL, supplier/production ranges, owner/batch mismatch,
  schema and collection limits.
- Preserved HTTP **413** `overseek_delivery_input_too_large` with
  `data.reason: payload_limits_exceeded`.
- Receipt replay, stock sequence/proof validation, pending/applied guard
  suppression, finalization, reversal, lock contention and native rollback tests.
- Classic and Blocks rendering/cache invalidation for stock, held reservations,
  receipt sequence/proof, quantity, address, actual rate cost and metadata.
- Forty normal checkout capture runs across CPT/HPOS, managed/unmanaged products
  and ten native shipping rates; **80 native saved snapshots** parsed,
  metadata-round-tripped and email-rendered by shared core, plus **25 shared fixtures**.

These are the existing available native suites; no additional browser smoke or
separately named `currentPriceQty` suite was run.

## Reproduction and retained evidence

The retained runner provisions, installs the immutable ZIP, verifies provenance,
runs the aggregate/shared-core checks and tears down its private environment:

```sh
python3 /tmp/opencode/overseek-candidate-2.23.1-native/run-native.py
```

The aggregate command was run with the normal private cache/config environment and:

```sh
OVERSEEK_RUN_DISPOSABLE_DB_TESTS=1 \
OVERSEEK_NATIVE_ARTIFACT_DIR=/tmp/opencode/overseek-candidate-2.23.1-native \
OVERSEEK_NATIVE_EXPECT_VERSION=2.23.1 \
OVERSEEK_NATIVE_ARTIFACT_ZIP=/tmp/opencode/overseek-release/candidate-2.23.1/overseek-wc-plugin.zip \
OVERSEEK_NATIVE_ARTIFACT_SHA256=365bc2369e44352a721dffd3b36d00d53888bf030ecb8222e00a456dd0622781 \
php -d sendmail_path=/bin/true \
  /tmp/opencode/overseek-delivery-integration-bVKWca5q/wp-cli.phar \
  --path=/tmp/opencode/overseek-candidate-2.23.1-native/wordpress \
  eval-file \
  "/home/agent/workspaces/Coding Files/Overseek/overseek/overseek-wc-plugin/tests/delivery-native-integration.php" \
  --use-include
```

Retained under `/tmp/opencode/overseek-candidate-2.23.1-native/`:

- `REPORT.json`: commands, results, version tuple and teardown.
- `candidate-before.json`, `installed-before.json`, `installed-after.json`: all
  96 file hashes and exact archive/manifest/installation verification.
- `runtime-provenance.json`, `runtime-reflection.log`: reflected installed classes
  and capability discovery.
- `native-full-aggregate.log`: complete native scenario output.
- `overseek-native-20260923-224637-f0f2ee4a/results.json`: aggregate result and child logs.
- `shared-core-80-snapshots.log`: snapshot and fixture validation, render metrics.
- `database-cleanup-checks.log`: all six cleanup counts zero.

## Cleanup

Zero suite markers, fixture users/products, native account input rows, owner guards
or failure triggers remained after fixture teardown. The runner then dropped
`wordpress_tests`, stopped its private MySQL process, verified port 43431 closed,
and removed WordPress, MySQL data, cache and binlogs. Only scripts, logs and reports
remain. No user/production database access, release promotion or commit occurred.
