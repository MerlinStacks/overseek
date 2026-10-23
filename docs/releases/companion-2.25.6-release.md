# Companion 2.25.6 release

Prepared on 2026-10-18. **Published to local application-download and SLDevs site
files only; not uploaded to the live host or installed on a WordPress store.**

## Release contents

See [customer release notes](companion-2.25.6-release-notes.txt) and
[Meta diagnostic/verification guidance](../marketing/meta-conversion-diagnostics.md).

Version 2.25.6 follows the publicly served 2.25.5 release, not the checkout's
previous 2.25.3 metadata. The 2.25.4/2.25.5 changelog entries and the SLDevs updater
have been restored to source so the new release preserves existing update support.
Plugin Update Checker v5.7, including its three vendor runtime dependencies,
translations and MIT license, is copied byte-for-byte from the existing 2.25.5
archive whose SHA-256 matches the live feed:
`6dc0eb02c7de1f4d99d4b581a2f5d1c8f2bf38978f2921e6f4a8ae21d085246b`.

The runtime manifest permits only those exact updater vendor files and license;
unrelated vendor/development files remain excluded. Existing automatic-update
preferences are not changed.

## Artifact

- Version: **2.25.6**; **215 files**, **435,940 bytes**.
- ZIP SHA-256: `20f59af264208bd7b6ca3962b95ae04b29cfc0de1899b8d45fa4b0cb5f99c5eb`.
- Manifest SHA-256: `9ec434985b25d50b934d40554da78cfdfdafdbf9a2a59b0b01be4bd78489a0d4`.
- Candidate: `/home/agent/.cache/overseek-release/candidate-2.25.6/overseek-wc-plugin.zip`.
- Application download: `server/uploads/plugins/overseek-wc-plugin.zip` with its
  adjacent source-verified manifest; installer pins identify the same bytes.
- SLDevs package: `updates/overseek-wc-plugin/overseek-wc-plugin-2.25.6.zip` in
  `/home/agent/workspaces/SL Devs Site`, with updated `info.json` and public changelog.

The package has verified CRCs, exact source/entry hashes, a single plugin root,
consistent header/constant/asset versions, bundled updater dependencies/license
and runtime-only contents. PHP lint and WordPress native staging installation
have **not** run: PHP and a Docker daemon are unavailable here. This release is
not represented as native-verified.

## Deployment

1. Test the ZIP on staging, including PHP lint and an in-place upgrade from 2.25.5.
   Verify update discovery/details with WooCommerce both active and inactive.
2. Deploy the matching OverSeek backend for server-side purchase validation,
   corrected AddToCart values and isolated Meta connection tests. The plugin ZIP
   does not contain the application backend.
3. Upload the immutable 2.25.6 ZIP to SLDevs first, replace `info.json` last, then
   update `changelog.html`. Retain earlier versioned ZIPs. The refreshed local
   `sldevs-site.zip` is also available, but deploying only these release files
   avoids overwriting other production feeds with older local copies.
4. Verify public feed/download HTTP responses and compare the downloaded SHA-256.
   Purge the feed's CDN cache if required.
5. Upgrade the existing `overseek-wc-plugin` folder without uninstalling. Purge
   separately managed page caches/CDNs as needed and revalidate already-active
   delivery estimates if the changed version fingerprint requires it.
6. Compare fresh browser/server Meta events with WooCommerce orders and repeat a
   classic AJAX cart addition to confirm unique, matching IDs. Historical events
   are not repaired, and coverage warnings can also involve other integrations.
