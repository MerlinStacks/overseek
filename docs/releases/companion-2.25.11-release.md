# Companion 2.25.11 and workflow repair

Prepared locally on 2026-10-23. No commit, push, production deployment or live
update-feed publication was performed.

## Cause and repair

The latest API release check rejects the committed 2.25.10 manifest because three
tracking PHP files have changed since that package was published. The WordPress
workflow runs the same failing check inside its combined download/install step;
its authenticated GitHub logs were unavailable, so an additional runner-specific
failure cannot be ruled out from those logs.

- Package the existing delayed-payment tracking fixes as **2.25.11**, rather than
  rewriting versioned 2.25.10 bytes. Synchronize bootstrap, README, asset metadata,
  ZIP, manifest and application installer/client checksum pins.
- Keep source, checksum and publication safety checks enabled.
- Split WordPress release verification, WooCommerce installation, WBS installation
  and companion installation into separate steps to identify future failures.
- Install the exact shipped ZIP in native and upgrade CI, not a freshly rebuilt
  archive. Retain a separate lint build and upload the shipped release manifest.
- Exercise upgrades from the immutable 2.25.10 ZIP at commit
  `3eedc6e0b43d734ee16873d54a63deca6ca71b55` with its original checksum.

## Artifact

- ZIP: `server/uploads/plugins/overseek-wc-plugin.zip`.
- Version: **2.25.11**; 227 runtime files; 1,129,055 bytes.
- ZIP SHA-256: `f5a09b2c55073da96e87e801f62e231ec550b56822a15478a2c62f1ed5ec9d36`.
- Manifest SHA-256: `ee66fbe30a44fe62b558f556382d3e624d7315426cf422c45b3d2bc8626ce4cb`.

## Local verification

- All 16 package/publication/download tests pass, including the regression that CI must
  install the shipped ZIP for both native and upgrade tests.
- All packaged PHP files pass PHP 8.4.24 syntax checks; startup shell syntax passes.
- Both deployment and WordPress workflow files pass actionlint (shellcheck disabled).
- Purchase tracking tests (including background confirmations and failed-ACK
  replay) and all standalone delivery/storefront/cart-display/quote-version
  scripts from the WordPress workflow pass.
- WordPress **7.0** and **7.1.1**, WooCommerce **11.1.1**, WBS **6.18.0**, PHP
  **8.4.24**, MariaDB **11.8.6**: plugin installation, guarded-receipt integration,
  native launch aggregates and shared-core snapshot checks pass with the shipped
  ZIP. Each completed aggregate has no failures or cleanup errors, with all 43
  subprocess checks and 80 classic/Blocks snapshots passing per WordPress version.
- In-place **2.25.10 -> 2.25.11** upgrades on both WordPress versions preserve
  settings, activation, automatic-update preferences, stock and purchase metadata.
- Local native runs use an isolated disposable database, not production. GitHub's
  exact MySQL 8.4 environment and image publishing still need a fresh CI run.

## Rollout

Commit/push and require fresh green workflows, then deploy matching API and web
images so their download checksum pins agree. Update the companion in place,
without uninstalling. No stock rewrite or settings migration is needed. Live
WordPress automatic updates require the separate existing update-site process;
this repository change does not publish that feed.
