# Disposable native delivery launch suite

## One CI entry point

Provision a **dedicated disposable MySQL server** and fresh WordPress installation,
with database name **`wordpress_tests`**. Install and activate WooCommerce, this
workspace plugin, and public `weight-based-shipping-for-woocommerce` **6.18.0**.
No mock Woo classes, stock SQL rewrites, activation filters, or hard-gate overrides
are used. The suite also works in a previously used disposable installation: it
restores configuration and removes only its own account-scoped fixtures.

In that site's fresh `wp-config.php`, set:

```php
define('WP_ENVIRONMENT_TYPE', 'local');
define('WP_HTTP_BLOCK_EXTERNAL', true);
define('DISABLE_WP_CRON', true);
```

Install packages explicitly with CLI before blocking network as appropriate for
the CI provisioning step. Use `.invalid` site/email addresses. The native suite
blocks WordPress HTTP/mail in each process and disables PHP sendmail in children.
MySQL needs CREATE TRIGGER privilege and a compatible binary-log policy, such as
`log_bin_trust_function_creators=1` on that dedicated server. PHP needs mysqli,
proc_open, and symlink support. The artifact parent directory must already exist.

```sh
OVERSEEK_RUN_DISPOSABLE_DB_TESTS=1 \
OVERSEEK_NATIVE_ARTIFACT_DIR=/path/to/existing/ci-artifacts \
wp --path=/path/to/disposable/wordpress eval-file \
  /checkout/overseek-wc-plugin/tests/delivery-native-integration.php --use-include
```

The result directory contains `results.json`, individual subprocess logs with
positive completion markers, exact native versions, and `native-snapshots.jsonl`.
The aggregate exits unsuccessfully for any failed branch, child timeout, missing
completion marker, wrong snapshot count, or reported teardown error. This includes
PHP fatal errors even on WP-CLI setups that unexpectedly return status zero.

### Verify the actual release archive, not workspace production files

For release certification, deactivate the test-site plugin and verify/unlink its
workspace symlink **itself** before installing the ZIP into a normal plugin
directory. Never force-install recursively over a workspace symlink. Tests remain
in the checkout and are not packaged. Native production includes use
`OVERSEEK_WC_PLUGIN_DIR`, not paths relative to those checkout tests.

Add these environment variables to the aggregate command:

```sh
OVERSEEK_NATIVE_EXPECT_VERSION=2.23.0 \
OVERSEEK_NATIVE_ARTIFACT_ZIP=/path/to/final/overseek-wc-plugin.zip \
OVERSEEK_NATIVE_ARTIFACT_SHA256=7367da7a9c94e8ad68f3b696642a7858a987fb2c8afcef21627a4f6b7ec49a3d
```

The provenance helper rejects a symlink in archive mode, verifies the ZIP digest,
reflects all loaded OverSeek production class filenames, requires receipt/control/
gate/adapter/capture classes to resolve inside the installed plugin, and compares
loaded installed runtime files byte-for-byte with their ZIP entries. Each child
records this evidence; the aggregate records it in `results.json`. Lazy REST class
definitions are loaded from the installation for inspection without registering or
replacing any routes. Pass the same archive environment to the optional browser
server starter to record installed-artifact provenance for its HTTP requests.

## Coverage

- Real manager permissions/account binding; unverified inputs; old-plugin header
  checks; explicit baseline/guarded cutover; verified input publication; activation.
- The old display plugin can coexist during private baseline/guarded preparation;
  activation still refuses until the old plugin is removed. This is asserted through
  the actual installed control route, not an activation bypass.
- Native simple and parent-managed sibling stock; receipt/replay/reversal; dates
  suppressed until proof release; stale-proof rejection; native SQL-trigger failure,
  operator observation/reconciliation, retry identity, and post-reconciliation work.
- AFTER UPDATE trigger proves guard release and input publication roll back together.
- A second actual MySQL connection tests physical-owner lock contention. The older
  native receipt harness also runs unchanged, retaining its caller-owned transaction,
  historical replay and independent-variation checks.
- Explicit disable with still-enabled settings, fingerprint changes and explicit recovery.
- Native WBS/WBSNG global and zoned Standard/Express, with independent 4–6 / 1–2
  transit mappings. Their native charge is zero so Store API place-order never calls
  a payment provider. Twelve core instances produce exactly twenty native offered
  options, including six deliberately unmapped ones. Existing zones/configs restore.
- Forty calls to the **unchanged** `delivery-checkout-capture-integration.php`:
  ten selected native rates × managed/unmanaged × CPT/HPOS. Each call runs real
  classic checkout and Store API draft GET/PUT/PUT then final POST. The managed
  harness proves own-vs-other native reservations, same-hash other orders, stale
  session hashes, and saved-promise equality. Production bootstrap registration is
  asserted before the original harness executes; the preload never registers it.
- Eighty actual saved snapshots exported before order deletion, parsed by PHP,
  alongside the existing shared snapshot fixtures.
- Real classic action and Blocks delivery-time filter benchmarks and warm-result
  invalidation after receipt, live stock, held stock, product/settings revisions,
  quantity, address, rate cost/metadata, disable and old-plugin changes.

## Frontend subprocess guard and measurement method

Production intentionally suppresses presentation under WP_CLI. The **WP-CLI-only
aggregate** launches a private PHP CLI child with a random token that must match its
live fixture option, account, consent environment, and actual `wordpress_tests`
database. That child loads normal WordPress without defining WP_CLI, and establishes
the normal Woo cart context or Store API route context. It executes the registered
production callbacks and the real activation gate. It is not a public HTTP endpoint
or a gate bypass. It refuses direct invocation without the aggregate-owned marker.

Native Woo cart/package/rate calculation happens **before** measurements. The
20-option package is identical for one-callback and twenty-callback measurements.
Each has five samples with only the application request cache cleared at the start;
native object/database caches are warm. Measurements use `$wpdb->num_queries`
deltas and `hrtime(true)` around the actual registered callbacks. Warm unmapped
callbacks have a separate 20-call measurement. Shipping-calculation hooks and HTTP
attempts are counted and must remain zero. A query-filter counter tracks the
adapter's distinct per-product input SELECT as a calculation proxy; this is SQL
evidence, **not a PHP function profiler**. No latency threshold is imposed on CI.

Classic hook output is trimmed because WBSNG's empty breakdown template emits
whitespace even for unmapped/core rates. Rate objects must remain byte-for-byte
unchanged across presentation. Warm invalidation never clears the cache explicitly.

## Optional shared TypeScript / email verification

With Node 22.23.1 or another compatible native TypeScript-stripping runtime:

```sh
node --experimental-strip-types \
  overseek-wc-plugin/tests/delivery-native-artifacts.mjs /path/to/result-directory
```

This reads all eighty native saved snapshots using the real shared parser, metadata
reader and email renderer, runs the existing shared JSON cases, and prints precise
query/latency summaries. No package installation/build or live API is needed.

## Ownership / diagnostics

Only the native fixture files are test code. Global/provider options and existing
zone priorities are recorded and restored in `finally`; fixture products, pages,
users, zones, inert plugin symlink, triggers, account input/receipt rows, and marker
are removed. Checkout and renderer child-created orders release holds and delete via
Woo CRUD. Diagnostic logs/snapshots remain. The aggregate does **not** stop the
dedicated server; its provisioning owner controls server lifetime.

Do not run competing fixture suites against the same disposable WordPress site:
account binding, shipping configuration and HPOS are intentionally switched during
the tests. UI, PostgreSQL, production deployment and merchant-theme/browser payment
certification are outside this suite.

## Native verification record — 2026-09-22

Executed on WP **7.1.1**, Woo **11.1.1**, WBS/WBSNG **6.18.0**, PHP **8.4.23**,
MySQL **8.4.8**, Node **22.23.1**. The new control/receipt/proof checks, both frontend
renderer processes, forty unchanged checkout-harness runs, eighty saved PHP/shared
snapshots and twenty-five shared parser cases passed. Managed capture runs each
passed 42 checks; unmanaged runs each passed 31. Production bootstrap registration
was verified, rather than supplied by the aggregate preload. The complete aggregate
is **green**, including **90 assertions** in the existing native receipt harness.

Measured cold callback batches (five samples, one managed owner, twenty actual
offered rates, fourteen mapped/six unmapped):

| Renderer | Callbacks | Queries per sample | Median elapsed | Observed range |
|---|---:|---:|---:|---:|
| Classic | 1 | 25 | 11.544 ms | 11.360–14.138 ms |
| Classic | 20 | 82 | 42.131 ms | 41.654–67.879 ms |
| Blocks | 1 | 25 | 8.051 ms | 7.548–9.483 ms |
| Blocks | 20 | 82 | 42.267 ms | 41.058–43.183 ms |

Twenty additional warm unmapped callbacks used 60 queries, zero adapter product
reads, 36.341 ms classic / 35.307 ms Blocks. Every cold batch had one adapter
product-input read. These are local machine measurements, not CI latency targets.
All requested warm mutation boundaries passed for both actual renderers.

The existing receipt fixture now reloads each saved variation with
`wc_get_product($v->get_id())` before asserting inherited parent ownership. This
hydrates native Woo parent data and fixes the fixture-only failure; no production
receipt logic changed. No known exceptions or skipped aggregate branches remain.

## Optional retained native browser smoke

The browser fixture is deliberately separate from automatic aggregate teardown.
It retains public simple/variable products, real synced inputs, a released baseline
proof, active control, native WBS default mapping, and a minimal test theme for a
parent-requested rerun. It stores the original site URLs/theme/configuration in a
private ownership manifest. It is **not merchant-theme certification**.

Create an empty private artifact directory, then:

```sh
OVERSEEK_RUN_DISPOSABLE_DB_TESTS=1 \
OVERSEEK_NATIVE_BROWSER_DIR=/path/to/browser-artifacts \
OVERSEEK_NATIVE_BROWSER_ORIGIN=http://127.0.0.1:43389 \
wp --path=/path/to/disposable/wordpress eval-file \
  /checkout/overseek-wc-plugin/tests/delivery-native-browser-fixture.php --use-include

node overseek-wc-plugin/tests/delivery-native-browser-start.mjs /path/to/browser-artifacts

LD_LIBRARY_PATH=/path/to/extracted/browser-libs/usr/lib/x86_64-linux-gnu \
OVERSEEK_HEADLESS_SHELL=/path/to/installed/chrome-headless-shell \
OVERSEEK_BROWSER_FONT_DIR=/path/to/local/fonts \
node overseek-wc-plugin/tests/delivery-native-browser-smoke.mjs /path/to/browser-artifacts
```

The Node 22 runner uses built-in WebSocket/CDP, its own browser profile and fontconfig
file/cache. It blocks and records non-loopback browser requests. The PHP HTTP server
binds only to the configured loopback port; WordPress remains rooted in its public
directory, never the private MySQL/artifact directory. An owned MU probe blocks
server HTTP/mail and records actual shipping-calculation calls. A guarded local
session-seeding route tests that an existing customer address never appears in
product-page HTML. It does not bypass any delivery gate or calculate a quote.

Native browser result: **99 checks passed** on HeadlessChrome **149.0.7827.55** at
**320, 390 and 1280px**, for both products. Tests exercise genuine DOMContentLoaded
fetch, native Woo variation changes/reset and quantity controls, matching shortcode
and dynamic-block output, no horizontal overflow, private/no-store AJAX, and blank
output for a known address without a certified native quote. All **22 delivery AJAX
calls were local**; zero remote browser requests, runtime exceptions, server HTTP
attempts, shipping recalculations or mail attempts occurred in the measured AJAX.
The 190 browser request events include normal local assets/documents. Whole-request
AJAX SQL counts were **67–86** (including WordPress/Woo bootstrap, distinct from
the 25/82 renderer-only query budget). Screenshots, original HTML, network records
and server measurements remain in the browser artifact directory.

The fixture theme uses ordinary text wrapping for long related-product fixture
tokens; it does not hide horizontal overflow. A detected fixture-theme overflow
was corrected there, not in production delivery styles.

When the parent explicitly requests cleanup, stop only the PHP process recorded in
`http.pid`, then run the fixture command with
`OVERSEEK_NATIVE_BROWSER_ACTION=cleanup` and the same browser directory. This
restores site URLs/theme/options and deletes only the recorded fixture resources.
The browser runner closes its own Chrome process after each smoke run. MySQL
lifetime remains the provisioning owner's responsibility.

## Final 2.23.0 ZIP validation — 2026-09-22

Artifact SHA-256:
`7367da7a9c94e8ad68f3b696642a7858a987fb2c8afcef21627a4f6b7ec49a3d`.
All **95 installed files** matched the actual ZIP; the installation was a real
directory with no packaged tests. All **43 child processes** passed provenance
verification against that installation. Production runtime files were not edited.

- Aggregate: **229 parent checks**, **162 renderer checks**, **1,460 checks across
  40 checkout runs**, and **90 receipt integration assertions**; no failed branches.
- **80 native snapshots** and **25 shared fixtures** passed PHP/shared core parsing;
  native metadata round trips and shared email rendering passed.
- Final installed-ZIP browser repeat: **99 checks**, **22 local delivery AJAX
  requests** with artifact provenance, no remote browser requests or server-side
  shipping/HTTP/mail attempts, at 320/390/1280px. Browser query counts were 67–86
  including full WordPress bootstrap. This is still a fixture-theme smoke test.
- Renderer queries stayed **25 for one cold callback**, **82 for twenty**, and
  **60 for twenty warm unmapped callbacks**. Final cold median timings: classic
  9.020/43.201 ms and Blocks 7.759/42.240 ms for one/twenty callbacks respectively.
- Environment: WP 7.1.1, Woo 11.1.1, WBS/WBSNG 6.18.0, PHP 8.4.23, MySQL 8.4.8,
  Node 22.23.1, HeadlessChrome 149.0.7827.55.

The final disposable HTTP/MySQL processes and owned browser fixtures were cleaned
up. The private DB, both owned WordPress/MySQL state directories, binary logs and
browser profiles were removed; diagnostic reports, screenshots and request logs
were retained. No live store deployment or commit was performed.
