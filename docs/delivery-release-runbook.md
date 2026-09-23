# Delivery companion-plugin release runbook

## Current patch: 2.23.1

**2.23.1 is native-verified and published as the LOCAL downloadable artifact;
not production deployed.** The tracked ZIP and manifest under
`server/uploads/plugins/` and the installer `RELEASE` pins now identify **2.23.1**,
**96 files**, **254,315 bytes**:

- ZIP SHA-256: `365bc2369e44352a721dffd3b36d00d53888bf030ecb8222e00a456dd0622781`
- Manifest SHA-256: `60ab038ffbcc7aae478616a3abc6fd877866006c791d14bf5e1dde6ab6dc03b3`

See [2.23.1 release/publication commands](companion-2.23.1-release.md) and
[installed-ZIP native evidence](delivery-2.23.1-installed-zip-validation.md).
Use those exact verified bytes for the current release; the 2.23.0 commands,
hashes, counts and validation below are retained as historical launch evidence.

For this patch, update OverSeek first, apply all pending earlier migrations plus
`20260923140000_delivery_input_diagnostics` before starting the updated server,
and generate the Prisma client. Then update the companion to 2.23.1 and use
**Retry** on the specific affected inputs in delivery sync attention after
resolving their cause. Previously synced inputs stay untouched. Expired inbound
inputs rebuild from current sources with a new revision. Already-active delivery
estimates require readiness revalidation for the changed plugin-version
fingerprint before reactivation; this patch does not force-activate them.

## Historical 2.23.0 launch record

**Launch 2.23.0 package: implementation ready for CONTROLLED ROLLOUT, not production
deployed.** The launch ZIP has passed its own fresh native installation and full
end-to-end aggregate after the compatibility-metadata correction. This document authorizes no deploy
or customer-store access. `2.23.0` is the companion plugin feature version; identify
OverSeek application builds by their existing build/commit identity.

## Package and handoff

From repository root, use the already-tested launch ZIP. Do not rebuild it to
populate the application's download path:

```sh
node --test server/scripts/tests/plugin-package.test.js
node server/scripts/build_plugin.js --check
node server/scripts/build_plugin.js \
  --publish-verified /tmp/opencode/overseek-release/launch-2.23.0/overseek-wc-plugin.zip \
  --expected-sha256 b193d955ff0920a266b93d35df0678fddf98b58c2eeac1bced1d87045cfa9070
```

Artifact: `/tmp/opencode/overseek-release/launch-2.23.0/overseek-wc-plugin.zip`.
The adjacent `overseek-wc-plugin.manifest.json` records version, bytes, ZIP SHA-256,
all archived file hashes and exclusions. The builder verifies CRC, exact entries and
bytes against staging and lints every packaged PHP file. Runtime roots are
`includes`, `assets`, `blocks`, `templates`, `languages`, plus bootstrap/uninstall,
customer README and the root MIT `LICENSE`. Tests/test-fixtures/stubs/native helpers,
developer Markdown, commands/scripts, coding-standard `vendor`, node_modules,
dotfiles, secrets, database dumps, backups and temporary artifacts do not ship.
Review the sidecar whenever adding a runtime file type/root.

### Application download artifact (workspace publication)

`TrackingScriptHelper` and onboarding `PluginStep` link to
`/uploads/plugins/overseek-wc-plugin.zip`. The source-controlled backing artifact is
**`server/uploads/plugins/overseek-wc-plugin.zip`**, now **2.23.0**, **252,676 bytes**,
with SHA-256 `b193d955ff0920a266b93d35df0678fddf98b58c2eeac1bced1d87045cfa9070`.
Its adjacent **`server/uploads/plugins/overseek-wc-plugin.manifest.json`** is included
in the intended release changes. Both match the tested launch ZIP/manifest exactly.
The prior tracked ZIP was confirmed unmodified in Git before replacement.

`--publish-verified` first validates the required digest, current source version and
asset metadata, exact runtime file set and hashes, ZIP CRC, legal license/readme and
exclusions. It rejects extra files/directories, duplicates, symlinks and stale source,
then copies the captured ZIP bytes verbatim without rebuilding or changing ZIP
timestamps. The sidecar is derived from current verified source, not trusted from
the input directory. Failed validation leaves the existing download/sidecar intact;
self-copy is safe. Seven package tests cover these paths, including wrong hashes,
stale source, extra entries and self-copy. The runtime check also passed.

This publishes **only into this checkout**: no network, live deployment or customer
installation occurs. Include this intentional tracked ZIP change and sidecar in the
release source; when distributing to the application's serving environment, verify
the same digest at the download location so an older 2.22.0 file cannot remain the
normal onboarding/settings download. The tested `/tmp` archive remains preserved.

### Docker image → persistent-volume download

The workspace ZIP alone is insufficient for Docker: `/app/server/uploads` is a
persistent volume and can retain an old download. The deployment path is now:

1. `.dockerignore` and `.gitignore` admit only the two exact plugin download files
   under `server/uploads/plugins`; all other uploads remain excluded. Keep both
   files in the release source, including the sidecar.
2. The production Docker stage copies them verbatim to **`/opt/overseek/plugin-download`**,
   outside the uploads volume, and copies `server/scripts/install_plugin_download.js`.
3. After the existing migration block succeeds and **before the API starts**,
   `server/start.sh` runs that installer. Existing migration ordering/fallback policy
   is unchanged. It validates pinned SHA-256 values for both the tested ZIP and
   exact manifest, plus manifest version **2.23.0**, archive digest and byte length.
   Full entry/source validation was already performed by verified publication; the
   immutable digest pins preserve that authority without a runtime ZIP parser.
4. Only `uploads/plugins/overseek-wc-plugin.zip` and its matching manifest are
   refreshed. The upload root honors the same `UPLOADS_DIR` override as the API,
   otherwise `/app/server/uploads`. Each changed file is staged beside its target
   and **atomically renamed**; identical files are left untouched. The two-file
   pair is not a filesystem transaction: an interrupted rename is repaired on the
   next start, and a failed installation prevents this process from starting the API.
   Other plugin files, invoices, attachments and customer uploads are never scanned,
   replaced or removed. Symlink source/destination files and ancestors are rejected.

Production images set `OVERSEEK_REQUIRE_PLUGIN_DOWNLOAD=1`; `NODE_ENV=production`
also requires the package. Missing, partial, corrupt or mismatched packages fail
closed before serving. In local development only, a completely absent `/opt` package
logs a skip and leaves the existing workspace download untouched. Partial/tampered
packages fail in all modes. These variables control only the download installer;
they neither contact nor activate WordPress.

The installer uses **Node built-ins only**, with no Python/PHP/ZIP executable or
new runtime dependency. A future plugin release must update its `RELEASE` version,
ZIP hash and manifest hash together after verified publication/native testing.

Validation for this wiring: **14 tests passed** (7 installer/static wiring and 7
packaging tests), including fresh/stale volumes, unchanged restart, partial prior
install, tamper/source failures preserving existing downloads, local skip/production
failure and symlink rejection. All installer writes were confined to isolated
`/tmp/opencode` fixtures. `bash -n`, `sh -n`, workflow `actionlint`, and static
Docker context/COPY/startup-order checks passed. WordPress CI runs these tests and
syntax checks for installer/image/context changes as well as plugin changes.
**No Docker image build was performed: the daemon is unavailable. Remote CI and
production deployment were not run.** Actual built-image startup/download checks
remain a release-environment verification; verify the served download SHA after
deployment and account for existing HTTP/CDN cache lifetime.

Launch metadata-only build, 2026-09-23: **95 files, 252,676 bytes**, including **65 PHP
files** linted successfully. Version remains **2.23.0**. All three package tests,
runtime check, exact ZIP manifest/content/CRC checks and `git diff --check` passed.
Independent verification matched every runtime source file to the archive. The
previous closure check covered 58 literal plugin-directory dependencies and every
block `file:` reference; all those references are unchanged in the launch ZIP.

| Digest | SHA-256 |
|---|---|
| ZIP | `b193d955ff0920a266b93d35df0678fddf98b58c2eeac1bced1d87045cfa9070` |
| Manifest JSON bytes | `0c1b4d338ce2678818cbb9b3c750bf1c777e8de61f85ab2222d8da2a7aef1a47` |
| Packaged runtime source | `6e55d119d5100c78be5bf51cdbd7149d7b6b1fc121cd024f8d65ace615a804f5` |

The source digest is SHA-256 of UTF-8 lines sorted by archive path, each exactly
`<file SHA-256><two spaces><archive path><LF>`, including packaged README/LICENSE.
Every file hash was checked against both frozen source and ZIP bytes; excluded tests,
CI and developer docs are not part of this runtime digest. Read-only reproduction:

```sh
python3 /tmp/opencode/overseek-release/verify-launch.py /absolute/path/to/checkout
```

### Metadata-only provenance and native validation boundary

The previous archive and manifest remain untouched at
`/tmp/opencode/overseek-release/final-2.23.0/`; its ZIP SHA-256 remains
`7367da7a9c94e8ad68f3b696642a7858a987fb2c8afcef21627a4f6b7ec49a3d`.
Comparing archive contents and both manifests proves **all other 94 files are
byte-identical**. The sole difference is in `overseek-integration.php`:
`WC tested up to: 9.5` → `WC tested up to: 11.1`. An exact byte-replacement assertion
rules out any other change in that file. PHP `token_get_all(..., TOKEN_PARSE)`
streams are identical after removing only `T_COMMENT`/`T_DOC_COMMENT` (all other
token text, including whitespace, retained; source line positions excluded).
The shared token-stream SHA-256 is
`85304e93efcec15711cca2ef2378c6a21f0982a9cf44c34a3e6d74a22215086b`.
Version stays **2.23.0**, `WC requires at least` stays **7.0** for other features;
delivery readiness still requires classic Woo 9.7+ / Blocks 9.9+ as documented below.
No packaged content changed after the launch build/hash.

The corrected **launch-2.23.0** ZIP was installed in a new owned disposable site.
All 95 installed files matched it before and after testing, and Reflection verified
installed-ZIP runtime paths in all 43 aggregate child processes. It passed 229
aggregate checks, 162 renderer checks, 40 checkout runs (1,460 checks), 90 receipt
assertions, 80 shared-core-validated saved snapshots and 25 shared fixtures, with
no failed or skipped branches. Audit and exact cleanup evidence:
`/tmp/opencode/overseek-final-native-1IWq5KD7/FINAL-REPORT.json` and
`FINAL-NATIVE-REPORT.md` in that directory. The new private database/server and
WordPress state were removed after verification; its port 43418 is closed.
The earlier byte-equivalent runtime also passed 99 real browser checks at
320/390/1280px; those browser checks were not repeated for this comment-only change.
Neither package was installed or activated on a customer store.
This workspace's shell `node` resolves to Bun; the successful commands used
`/tmp/opencode/node-v22.23.1-linux-x64/bin/node` in place of `node` above
(and `TMPDIR=/tmp/opencode` for the test runner).

Existing build convention: `npm run build:plugin -w server` uses this same builder
and defaults to the tracked `server/uploads/plugins/overseek-wc-plugin.zip`; `--check`
is only the existing lightweight Docker source check. The image workflow builds
API/web by commit SHA and can trigger Portainer on push; do not invoke it as a local
packaging check. Use the verified-publication command above for an already-tested
artifact; the ordinary build mode creates a new ZIP and does not preserve its hash.
Retain the tested source/artifact identity through the normal deployment process.

**Fingerprint handoff:** header/`OVERSEEK_WC_VERSION`/README are now **2.23.0**.
The version change invalidates an already-active native/browser fixture's environment
fingerprint. Blank dates until readiness-checked reactivation are expected. Parent
must explicitly revalidate/reactivate the isolated fixture when ready; packaging
does not activate it. Rebuild again if another agent changes runtime files.

### Native fresh-install handoff: launch archive, not workspace symlink

Use only the owned disposable `wordpress_tests` installation. Target **WordPress
7.1.1 / WooCommerce 11.1.1 / WBS/WBSNG 6.18.0** (11.1.1 is the Woo version).
Stop competing fixture/browser runs first. Verify the ZIP SHA-256 below and the
adjacent manifest before installing. With `WP_ROOT` and `CHECKOUT` set to the
verified absolute disposable-site and repository paths:

```sh
PLUGIN_LINK="$WP_ROOT/wp-content/plugins/overseek-wc-plugin"
test -L "$PLUGIN_LINK" && test "$(readlink -f "$PLUGIN_LINK")" = "$CHECKOUT/overseek-wc-plugin" && unlink "$PLUGIN_LINK"
```

Proceed only if that check/unlink succeeded and the plugin path is now absent.
Never recursively remove the symlink target or use `--force` over a workspace link.
If it is a real directory or points elsewhere, stop and review ownership instead.

```sh
wp --path="$WP_ROOT" plugin install /tmp/opencode/overseek-release/launch-2.23.0/overseek-wc-plugin.zip
wp --path="$WP_ROOT" plugin get woocommerce --field=version
wp --path="$WP_ROOT" plugin get weight-based-shipping-for-woocommerce --field=version
wp --path="$WP_ROOT" plugin get overseek-wc-plugin --field=version
OVERSEEK_RUN_DISPOSABLE_DB_TESTS=1 \
OVERSEEK_NATIVE_ARTIFACT_DIR=/path/to/existing/private-artifacts \
wp --path="$WP_ROOT" eval-file \
  "$CHECKOUT/overseek-wc-plugin/tests/delivery-native-integration.php" --use-include
```

Keep test helpers outside the installed plugin: execute them from the checkout with
WP-CLI's exact **`--use-include`** flag. Native agent must verify the installed
runtime hashes against the final manifest, ensure required fixture plugins are
active, and perform readiness-checked fixture reactivation explicitly as needed.
Retain test results with this artifact's hash; installation alone is not certification.

## Controlled OverSeek-first sequence

1. **Record baseline and recovery point.** Record application identity, plugin ZIP
   hash, installed WP/Woo/WBS/PHP/database versions, settings, receipt/backlog state
   and coherent database backups. Capture comparable pre-change callback/request
   query counts and p50/p95 timings, checkout/error rates, queue age, stale/unverified
   input counts and pending/failed cascades. Agree observation window/abort criteria.
2. **Build OverSeek first** from the reviewed snapshot (Node 22+, configured build
   environment), including shared core and both applications:

   ```sh
   npm ci
   npm run db:generate
   npm run build:packages
   npm run build -w server
   npm run build -w client
   npm run lint -w client
   ```

   Complete the backend/client/native checks linked below against this snapshot.
   Use the natively verified launch ZIP above. Repackaging changes the archive identity
   and requires a new hash/ZIP-install validation; do not rebuild it for docs/CI edits.
   Application evidence is snapshot-specific; record the matching release identity.
3. **Pause inventory receiving/unreceiving**, drain pre-upgrade process-local receipt
   and BOM work, and record unresolved historical jobs. In the approved deployment
   window apply **all pending migrations** using `npm run db:migrate` (Prisma
   `migrate deploy`, never `db push`). These 13 delivery migrations are required in
   chronological order, on top of the normal application migration history:

   List checked against actual `server/prisma/migrations/*/migration.sql` files
   on 2026-09-22 (the earlier `20260917000000_add_email_unsubscribe_contact_status`
   is part of the preceding application history, not one of these 13):

   ```text
   20260921000000_delivery_estimates
   20260921010000_delivery_input_sync
   20260921020000_delivery_sync_account
   20260921030000_delivery_inbound
   20260921040000_delivery_inbound_targets
   20260922000000_order_delivery_estimate_snapshot
   20260922010000_guarded_receipts
   20260922020000_delivery_launch
   20260922123000_delivery_freshness_targets
   20260922133000_delivery_freshness_prerequisite
   20260922134000_delivery_inbound_scope_constraints
   20260922160000_delivery_launch_recovery
   20260922170000_receipt_cascade
   ```

   Start the matching OverSeek API/workers/web and restart **every** pre-upgrade
   worker/API process. Confirm health and migration status; no old stock writer may
   survive the drain. After this deployment window, receiving can resume in LEGACY
   mode while products/settings are entered and the companion update is prepared,
   provided `receivingFrozen:false` and health checks pass. Do not hold the business
   paused throughout a long configuration period. Pause/drain again at step 6.
   Schema push is not a cutover fallback: inspect readiness's `freshnessPrerequisite`
   and apply the reviewed SQL migrations if it reports missing bindings/version markers.
   Cutover/certification perform uncached prerequisite checks before creating work or
   freezing receiving, and recheck inside the final transition transaction. A missing
   prerequisite returns `freshness_sql_prerequisite_missing` without changing a new
   request's mode/freeze/work state; already queued work retains its safe state and
   reports the error for repair/retry. Already-guarded requests are diagnosed too.
   Explicit disable and inventory-recovery endpoints remain available. This backend
   safety check does not change the frozen plugin runtime or verified ZIP.
4. **Configure the account in OverSeek.** Enable `DELIVERY_ESTIMATES`; grant
   `view_shipping`, `manage_shipping_settings`, and `manage_inventory` to operators
   who need them. Save timezone/calendar/working days, cutoffs, closures, labels and
   product/variation production inputs; review supplier lead times and PO inbound
   quantities/dates. Configure eligible native stock-managed targets. Finished BOM
   dates are excluded; native components can still participate in guarded inventory.
   Set transit mappings and product-page default deliberately. Core flat/free/pickup
   supports instance mappings; WBS/WBSNG requires observed **exact_rate** identity
   or explicitly confirmed **all_provider_rates** policy. Exact disabled exclusions
   override broad mappings. Renamed WBS titles may change IDs; unmapped rates stay
   blank. Do not infer transit from titles or shipping prices.
5. **Update the companion plugin** to the verified ZIP after OverSeek is ready.
   Keep delivery activation off and retain the old Pi delivery plugin until the
   controlled switch. Confirm plugin health/account binding and discovery. Request
   `POST /api/delivery-estimates/sync`; inspect `GET /sync` and `GET /readiness` under
   the same API prefix. Settings/input ACKs are not activation ACKs. Resolve sync,
   ownership and freshness errors; an old-plugin blocker is expected at this stage.
6. **Private preparation with Pi still active:** pause receiving/unreceiving now,
   confirm legacy work drained and all pre-upgrade processes restarted. Keep Pi
   active and OverSeek delivery activation off during baseline/guarded preparation;
   coexistence is allowed for these private steps, but still blocks activation. Submit:

   ```text
   POST /api/delivery-estimates/cutover
   {"receivingPaused":true,"legacyJobsDrained":true,"preupgradeWorkersRestarted":true}
   ```

   Use bearer authentication and `X-Account-Id`. Only attest facts already verified.
   A 409 with `legacy_review` durably freezes receiving: use the legacy observation/
   reconciliation UI/API, correct and attest inventory including dependent BOM work,
   then explicitly resubmit cutover. Never replay an uncertain stock delta. A 202 is
   queued work, not completion. Poll readiness until `mode:GUARDED`, epoch/control
   ACK agree, receiving is unfrozen, owners are certified and fresh verified inputs
   are rebuilt. Drain receipt **and cascade** work. Future ownership additions use
   explicit `/certification`, not SQL edits or implicit baselines. While Pi remains
   active, overall readiness may still be false due to its activation blocker.
   Require fresh verified inputs, current settings ACK, eligible configured targets,
   supported mappings, SQL prerequisites and resolved inventory/sync work before
   proceeding; do not deactivate Pi just to make private preparation succeed.
7. **Controlled presentation switch, then activation.** Once verified inputs are
   ready, manually deactivate Pi in WordPress and record its exact basename/version.
   Never delete it or let an automation deactivate it. Refresh readiness after this
   environment-fingerprint change. Require `ready:true`, no blockers, acknowledged
   current settings/inputs, `freshnessPrerequisite.ready:true`, eligible configured
   targets and supported shipping mappings. Review exclusions/warnings. Submit
   `POST /api/delivery-estimates/activation` with `{"active":true}`; poll until the
   control revision is acknowledged and `active:true`. Cutover and input sync alone
   never authorize storefront output. Fix `work.lastError` before retrying.
8. **Test and observe.** Verify product shortcode/block and variation/quantity
   changes, normal cart and classic/Blocks checkout rates, mapped/unmapped/pickup
   wording, address changes, stale/unverified suppression, reservations and saved
   order promises. Verify receive/reversal/replay, reconciliation and cascade retry
   without duplicate native deltas. Send a controlled test email to a designated
   test inbox: template preview and actual order/email must use the saved snapshot,
   including legacy orders without one. Check mobile/desktop/theme/cache behavior,
   worker health and baseline metrics before expanding rollout.

## Disable / rollback

- Immediately request `POST /api/delivery-estimates/activation` with `{"active":false}`.
  This works with the feature off or invalid settings. Poll control ACK and confirm
  storefront dates stop; `desiredActive:false` alone is not delivery confirmation.
  SUPERADMIN feature-off also queues the independent disable. If transport is down,
  treat disable as pending, pause affected checkout/inventory as needed, and restore
  control connectivity before declaring rollback complete.
- Keep guarded inventory workers/protocol available to settle receipts and cascades.
  Delivery disable **does not revert GUARDED to LEGACY**, clear journals/epochs or
  silently unfreeze a cutover. Resume failed cutover through its explicit action.
- Old Pi presentation can be restored only at a controlled switch after OverSeek
  output is confirmed off and coexistence/checkout is checked. Do not downgrade the
  companion or OverSeek stock writers to a pre-guarded implementation after cutover.
  Prefer a forward fix or a known compatible build while preserving the outbox.
- No down-migrations, `db push`, direct mode edits, guessed reversal deltas or one-sided
  database restores. A full disaster restore requires a stopped/coordinated system,
  matching OverSeek + Woo inventory/journal backups and explicit reconciliation of
  subsequent orders/stock movements before traffic resumes.

## Evidence and limits

- [Native 13-migration validation](delivery-native-validation-13-migrations.md):
   PostgreSQL 18.4 / Node 22.23.1 / Prisma 7.8.0; **396 tests across 36 files passed,
  zero skips**, all 13 migrations and production server build passed. Historical
  baseline is synthetic; Woo transport is mocked there. Real two-connection races
  run inside serial test files (`--no-file-parallelism`).
- [Native Woo record](../overseek-wc-plugin/tests/delivery-native-integration.md):
  WP 7.1.1, Woo 11.1.1, WBS/WBSNG 6.18.0, PHP 8.4.23, MySQL 8.4.8; real control,
  stock/proof/checkout tests against the actual final ZIP, 40 checkout runs and 80
  saved snapshots. Browser fixture: Chrome
  149.0.7827.55, 99 checks at 320/390/1280px. These are isolated fixtures, not
  merchant-theme, payment-provider or all-version certification.
- Delivery classic requires Woo 9.7+, Blocks 9.9+; reviewed quote cache families
  are 9.7–9.9, 10.0–10.9, 11.0–11.1. **Separate Blocks pickup-location flow remains
  blocked**; core `local_pickup` rate wording does not certify it. Unknown versions,
   custom stock stores, stock-derived finished-BOM promises and provider multi-shipment/partial-
  shipment promises remain unsupported/excluded.
- Client freeze handoff: **469 tests / 72 files and production build passed**.
- CI configuration: WordPress installs exact Woo 11.1.1/WBS 6.18.0 and a packaged
  plugin, then blocks external HTTP/cron in its local disposable site and runs the
  native aggregate plus shared snapshot verifier. Native PostgreSQL jobs target
  17/18 `overseek_test` services, all delivery suites with real native helpers and
  zero-skips enforcement. Reports upload even on failure. These workflow changes
  are locally linted configuration; **remote CI has not been executed here**.
- Recorded native callback baseline: one callback **25 queries**, twenty callbacks
  **82 queries**; median classic **11.544 / 42.131 ms**, Blocks **8.051 / 42.267 ms**.
  Twenty additional warm unmapped callbacks still cost **60 queries**. One adapter
  product-input read is a SQL proxy, not proof of one total calculation. Whole AJAX
  requests cost **67–86 queries**, including bootstrap. Measured callbacks/AJAX made
  zero shipping recalculations or remote HTTP calls. These local measurements are
  not production latency targets or a before/after performance improvement claim.
- API/recovery details: [launch contract](delivery-launch-api.md),
  [shipping policy](delivery-shipping-options.md),
  [freshness](delivery-freshness-launch.md). A stock ACK can leave `cascadeState:pending`;
  derived BOM propagation is convergent recalculation, not distributed exactly-once.
