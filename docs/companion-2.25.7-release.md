# Companion 2.25.7 release

Prepared on 2026-10-18. **Published to local application-download and SLDevs site
files only; not uploaded to the live host or installed on a WordPress store.**

## Release contents

See [customer release notes](companion-2.25.7-release-notes.txt). This maintenance
release fixes Blocks purchase links, deduplicates identical checkout-start events
for 30 minutes within the WooCommerce session across all capture paths, and limits
cart/checkout views to document requests. Classic and Blocks checkout remain
supported. Historical events are not modified.

## Artifact

- Version: **2.25.7**; **215 files**, **436,598 bytes**.
- ZIP SHA-256: `8d17a05e6569238881fafba69f2b43be6de7b014b967dc0be24c22f9e85049ea`.
- Manifest SHA-256: `e4708c27ce7e9ff98c8bdefb3baf18fcaec8a5f8deae1068e7a9776aa8bffa16`.
- Candidate: `/home/agent/.cache/overseek-release/candidate-2.25.7/overseek-wc-plugin.zip`.
- Application download: `server/uploads/plugins/overseek-wc-plugin.zip` and its
  source-verified manifest; installer pins identify these same bytes.
- SLDevs package: `updates/overseek-wc-plugin/overseek-wc-plugin-2.25.7.zip` in
  `/home/agent/workspaces/SL Devs Site`, alongside updated `info.json`, public
  `changelog.html` and the rebuilt `sldevs-site.zip`.

Package verification checks CRCs, exact runtime source hashes, a single plugin
root and consistent header/constant/asset versions. Regression coverage is wired
into the WordPress compatibility workflow. PHP lint, PHP regression execution
and native WordPress staging verification have not run here because PHP and a
Docker daemon are unavailable. This is not a native-verified release.

## Deployment

1. Run PHP lint and `php overseek-wc-plugin/tests/purchase-links.php`, then test an
   in-place upgrade from 2.25.6 on staging without uninstalling.
2. Exercise classic and Blocks checkout. Verify order-received links, repeated
   background updates, changed email/cart details, real page revisits and a new
   checkout after purchase. Confirm consent and purchase acknowledgement remain
   respected.
3. Upload the immutable 2.25.7 ZIP to SLDevs first, replace `info.json` last, then
   update `changelog.html`. Retain older versioned ZIPs. Prefer these scoped files
   over the full site archive to avoid overwriting unrelated production feeds.
4. Verify the public feed and download, compare the ZIP SHA-256 and purge CDN
   cache if required. The public feed still served 2.25.6 when checked during
   preparation; local publication does not deploy it.
5. Deploy the matching application download files/installer pins with the backend.
   This plugin release does not change the separate backend deployment
   requirements documented for 2.25.6.
6. Upgrade stores in place and purge separately managed page caches/CDNs as
   needed. Existing delivery estimates may need readiness revalidation after
   the version fingerprint changes. Validate fresh events, not historical logs.
