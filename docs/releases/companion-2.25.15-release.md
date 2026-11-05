# Companion 2.25.15

Prepared on 2026-11-05. Local candidate only; not deployed or installed on a customer store.

## Changes

- Order, customer and review change signals persist independent background jobs instead of making sequential blocking HTTP calls during checkout or bulk edits.
- Jobs use WooCommerce Action Scheduler (`overseek-store-sync` group), with WP-Cron fallback if scheduler admission is unavailable or fails. A serviced background runner is required.
- Operational failures retain their event IDs and retry after 30, 120 and 480 seconds, outside the capped purchase retry transient. Purchase acknowledgement and existing purchase retry behaviour remain unchanged.
- Existing operational entries in the old transient move to independent jobs when the retry worker drains them. Foreign-account jobs are discarded after relinking.
- Uninstall removes pending operational jobs from both schedulers. Upgrade in place, without uninstalling.

## Artifact

- ZIP: `server/uploads/plugins/overseek-wc-plugin.zip`.
- Version: **2.25.15**; **227 runtime files**, **1,131,567 bytes**.
- ZIP SHA-256: `1367f8fcf233edeb25ac2f1128f08badbd6ea63362a31400740d58240389d3fb`.
- Manifest SHA-256: `d1b26b973ec23f153f18ce5a787cac0408379194ade1e8bbc87105e56c671a09`.

The candidate passed packaged PHP lint, ZIP CRC/content verification and verified publication into the application download path. Server/client release pins match these exact bytes; the integrity guard is unchanged.

## Validation

- PHP 8.4.27: all **21** tracking transport regressions pass, including 80 operational failures alongside 50 preserved purchase retries, mixed checkout, scheduler fallback, exceptions, stable IDs, legacy queue migration and relinking.
- Purchase-link, invoice-storage, invoice-recovery and review-summary scripts pass.
- PHP syntax checks pass for **165** runtime/test files. All **16** package/download tests pass; storefront JavaScript checks pass.
- Broader standalone PHP checks: **35 of 37 invocations pass**. Two unchanged delivery tests (`delivery-engine.php` and `delivery-order-snapshot.php`) fail because this local environment lacks legacy timezone aliases (`US/Pacific`, `US/Eastern`). The existing WordPress CI installs `tzdata-legacy` for this requirement. No delivery runtime files changed.
- Added a disposable native WordPress CI test for real Action Scheduler persistence/execution, failed-delivery retry and purchase isolation. It is not executable locally without WordPress/MySQL; hosted compatibility and upgrade checks remain required before rollout.

Deploy matching API/web builds so download pins agree, then install the companion in place. No database migration is required. This record is not evidence of hosted CI success or production rollout.
