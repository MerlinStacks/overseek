# Companion 2.25.14

Prepared on 2026-11-05 to repair the failed Build & Deploy run
[41940656460](https://github.com/MerlinStacks/overseek/actions/runs/41940656460).

## Cause and correction

Commit `2cdcee6b` changed the invoice API/storage and customer recovery runtime
files without refreshing the shipped 2.25.13 package. The API image's existing
source-versus-package guard correctly rejected the stale manifest. Client lint
and the web image succeeded; the deployment job was skipped.

The new version packages the current invoice safety fixes and synchronizes the
plugin header/constant, README, block asset fallback versions, ZIP/manifest and
server/client checksum pins. The integrity guard remains unchanged. WordPress
compatibility CI now also runs the invoice-storage and invoice-recovery regressions.

## Artifact

- ZIP: `server/uploads/plugins/overseek-wc-plugin.zip`.
- Version: **2.25.14**; **227 runtime files**, **1,130,634 bytes**.
- ZIP SHA-256: `df8f83ee5a6826afff03398c4af60d80da0b117a0daa166d1c0f0feebfb96b09`.
- Manifest SHA-256: `263ff8a0e99e506f8032651483b98a8ffd8006d551e894c181f6725f6f3d7bdd`.

The builder verified archive CRCs, exact runtime file contents, exclusions and
version metadata. Verified publication copied those exact candidate bytes into
the application download path; it did not rebuild the candidate during publication.

## Validation and rollout

The exact API-workflow packaging/download command passes locally. PHP is not
installed in this environment, so PHP lint, the new invoice regression scripts,
and native WordPress/WooCommerce compatibility must pass in CI before rollout.
This is a source-verified package, **not a native-verified release**.

No push, hosted workflow rerun, Docker image publication, deployment, external
update-feed publication or customer-store installation was performed here.
Deploy matching API/web builds so download pins agree. Upgrade the plugin in
place without uninstalling; no settings or stock migration is required.
