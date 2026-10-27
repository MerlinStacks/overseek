# Companion 2.25.12

Prepared on 2026-10-27. Release-note source for the update publisher:
[`companion-2.25.12-notes.txt`](companion-2.25.12-notes.txt).

## Changes

- Restrict the current-post fallback in review product detection to the `product`
  post type. Homepage, ordinary-page and blog-post IDs no longer select the
  unrated-product branch instead of aggregate product ratings.
- Preserve the global WooCommerce product, genuine product-page fallback and
  explicitly selected product behaviour, including honest empty ratings.
- Add regression coverage to the WordPress compatibility workflow.
- Synchronize the plugin header/constant, README, block asset fallback versions,
  packaged ZIP/manifest and server/client checksum pins as 2.25.12.
- Include the pending visitor-profile layout/theme changes and matching tests in
  the repository commit; these belong to the web application, not the plugin ZIP.

## Artifact

- ZIP: `server/uploads/plugins/overseek-wc-plugin.zip`.
- 227 runtime files; 1,129,265 bytes.
- ZIP SHA-256: `22109a32bc310c6a2e798d5120707d215bd40f28151358fe4e28886b9018f7ab`.
- Manifest SHA-256: `5cd48d651836d6f29214ad80929f3f5b3ead3c6c086c9b2d76aaabbc743cd5e7`.

## Workflow review and local verification

The pending source initially failed the source-versus-shipped-manifest release
check. Publishing the new version and updating its pins fixes that failure
without weakening the check or replacing immutable older release bytes.

- Build & Deploy: client lint passes (0 errors, 299 warnings); shared-core,
  client TypeScript/Vite production build, Prisma generation and server build
  pass. All 16 package/publication/download checks pass, as does startup shell
  syntax. Docker image builds, registry pushes and deployment were not run.
- WordPress Plugin Compatibility: all plugin PHP syntax checks, review-summary
  regression, purchase-link/tracking checks and the workflow's standalone
  delivery, JavaScript, cart-display modes and quote-version scripts pass.
  Packaging with `--lint` verifies ZIP integrity and runtime contents.
  Native WordPress/WooCommerce/WBS installation, MySQL receipt/checkout checks
  and in-place upgrade tests were not run: WP-CLI, database services and Docker
  are unavailable here.
- Delivery Native PostgreSQL: the available delivery suite passes 402 tests;
  99 tests in 11 database-dependent files skip. This is not a passing native
  workflow reproduction: CI requires PostgreSQL 17/18 and zero skipped tests.
- Memory Soak Check is PR/manual-only, not a main-push check. It was not run;
  Docker is unavailable.
- All 9 visitor-profile tests pass. The installed local tools are Node 24.21.0
  and PHP 8.5.12, rather than the workflows' Node 22 and PHP 8.4.

No GitHub-hosted workflow result is claimed. Require fresh green hosted
workflows before deployment.

## SLDevs and native WordPress notes

The sibling `SL Devs Site` directory now contains the byte-identical versioned
ZIP, updated `updates/overseek-wc-plugin/info.json`, website changelog and rebuilt
`sldevs-site.zip`. The publisher's 8 tests pass; the exact package checksum,
archive contents and release-note HTML were also verified.

The updater already passes `sections.changelog` into WordPress's native plugin
information API. Continue using headings, paragraphs and lists in that section,
with no nested iframe, preformatted box or custom scrolling container. Do not
replace WordPress's own standard plugin-details dialog or modify the pinned
third-party updater for this presentation requirement.

This is local publication only. The live public feed served 2.25.9 when checked
on 2026-10-27. No live-host upload connection is configured here. Upload the
versioned ZIP first, then `changelog.html`, and atomically replace `info.json`
last; retain earlier ZIPs. The SLDevs directory is not committed by this task.

Deploy matching API/web artifacts so plugin-download pins agree. Replace the
existing plugin in place without uninstalling. No settings or stock migration
is needed. Purge separately managed caches/CDNs as needed; delivery estimates
may require readiness revalidation. Test homepage/product review summaries,
classic/Blocks checkout and the native plugin-details Changelog on staging.
