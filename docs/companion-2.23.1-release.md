# Companion 2.23.1 patch release

Status: **native-verified and published as the LOCAL downloadable artifact** on
2026-09-23. **Not production deployed.** The exact installed candidate passed
[native ZIP validation](delivery-2.23.1-installed-zip-validation.md): 293 aggregate
checks, 43/43 child runs, 40 checkout runs and 80 saved snapshots. Its 96 installed
files matched the manifest before and after testing. That publication gate is met.

## Changes

- Shared stock-owner variants support distinct supplier leads via
  `capabilities.variantSupplierLeads`.
- Typed delivery input rejection reasons support diagnostics and targeted recovery.
- This patch does not force-activate delivery estimates.

The plugin header, version constant, README and asset metadata are 2.23.1.
WooCommerce tested up to remains 11.1; minimum PHP remains 8.1.

## Verified artifact provenance

Original candidate build command (historical; do not rerun to publish verified bytes):

```sh
PATH=/tmp/opencode/node-v22.23.1-linux-x64/bin:$PATH node server/scripts/build_plugin.js --output-dir /tmp/opencode/overseek-release/candidate-2.23.1 --lint
```

- ZIP: `/tmp/opencode/overseek-release/candidate-2.23.1/overseek-wc-plugin.zip`
- Manifest: `/tmp/opencode/overseek-release/candidate-2.23.1/overseek-wc-plugin.manifest.json`
- Built candidate: version **2.23.1**, **96 files**, **254,315 bytes**.
- ZIP SHA-256: `365bc2369e44352a721dffd3b36d00d53888bf030ecb8222e00a456dd0622781`.
- Manifest SHA-256: `60ab038ffbcc7aae478616a3abc6fd877866006c791d14bf5e1dde6ab6dc03b3`.
- The manifest records the version, ZIP SHA-256, byte count, exact runtime file
  list with individual SHA-256 values, and exclusions.
- Verify the new `includes/class-overseek-delivery-input-exception.php` is included,
  all runtime source files match the archive, and tests, developer fixtures and
  secrets are excluded. The builder checks ZIP CRCs and exact entry hashes and
  lints every packaged PHP file.

Packaging verification passed on 2026-09-23: all packaged PHP lint, ZIP CRC and
exact-entry/hash checks, complete runtime manifest comparison against the working
source (including the new exception), and `git diff --check`. Manifest review
confirmed no tests, developer fixtures or secret files are packaged. The existing
packager includes untracked runtime files; no packager change was needed.
The installed-ZIP native validation subsequently passed for these exact bytes.

Previous 2.23.0 release ZIP SHA-256 (historical):
`b193d955ff0920a266b93d35df0678fddf98b58c2eeac1bced1d87045cfa9070`.
Previous 2.23.0 release manifest SHA-256 (historical):
`0c1b4d338ce2678818cbb9b3c750bf1c777e8de61f85ab2222d8da2a7aef1a47`.

## Local verified publication

Executed from the repository root without rebuilding the archive:

```sh
PATH=/tmp/opencode/node-v22.23.1-linux-x64/bin:$PATH node server/scripts/build_plugin.js --publish-verified /tmp/opencode/overseek-release/candidate-2.23.1/overseek-wc-plugin.zip --expected-sha256 365bc2369e44352a721dffd3b36d00d53888bf030ecb8222e00a456dd0622781
```

The local download is `server/uploads/plugins/overseek-wc-plugin.zip`, with its
adjacent `overseek-wc-plugin.manifest.json`. Both match the candidate bytes and
hashes above. The installer `RELEASE` version, ZIP digest and manifest digest now
pin 2.23.1. Verified publication checked current runtime source, exact ZIP entries,
file hashes and CRCs before copying the archive verbatim. The new input exception
is included; tests, developer fixtures and secrets remain excluded.

This updates the checkout's artifact backing `/uploads/plugins/overseek-wc-plugin.zip`.
It does not deploy an application image, update a running download volume or install
the companion on a customer store. Verify the served digest during the eventual
deployment using the [release runbook](delivery-release-runbook.md).

Post-publication checks passed: **14/14 packaging and installer tests**, zero
failures/skips, the lightweight runtime `--check`, byte-for-byte comparison of
both published files with the candidate, both pinned SHA-256 checks, and
`git diff --check`. Tests used isolated fixtures under `/tmp/opencode`:

```sh
TMPDIR=/tmp/opencode PATH=/tmp/opencode/node-v22.23.1-linux-x64/bin:$PATH node --test server/scripts/tests/plugin-package.test.js server/scripts/tests/plugin-download.test.js
```

## Upgrade flow

1. Update OverSeek through its normal deployment flow. Apply all pending earlier
   migrations and `20260923140000_delivery_input_diagnostics` before starting the
   updated server, and generate the Prisma client. The additive migration records
   diagnostics without inferring reasons for historical failures.
2. Update the WooCommerce companion to the validated 2.23.1 package.
3. Open delivery sync attention and inspect the affected blocked, failed or
   plugin-update-required inputs. Resolve the reported cause, then use **Retry**
   on the specific affected input. Retry clears cached capability decisions so the
   next dispatch can discover the updated plugin. Expired/source-dirty inbound
   inputs rebuild from current sources with a new revision.
4. Refresh attention to confirm acknowledgement or inspect the new typed reason.
   Previously synced inputs are left untouched; a plugin update is not a request
   to reset revisions or resync every product.
5. Recheck readiness. If delivery estimates were already active, the plugin-version
   fingerprint changes and requires revalidation before reactivation. Activation
   remains explicit and readiness-gated.

See [input diagnostics and targeted recovery](delivery-input-diagnostics-api.md),
[variant supplier leads](delivery-variant-supplier-leads.md), and the
[delivery release runbook](delivery-release-runbook.md).
