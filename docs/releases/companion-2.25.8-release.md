# Companion 2.25.8 release

Prepared on 2026-10-20. **Published to local application-download and SLDevs site
files only; not uploaded to the live host or installed on a WordPress store.**

## Release contents

See [customer release notes](companion-2.25.8-release-notes.txt). Includes the
current storefront reviews and preference centre updates, separate store/product
ratings, empty states, fractional stars and twelve WebP achievement badges.
The original badge artwork source is excluded from the runtime package.

The SLDevs publisher now converts escaped plain-text notes to native HTML
paragraphs, headings and lists in `sections.changelog`. WordPress's existing
plugin-information dialog renders these directly; no preformatted scrolling box,
custom frame or bundled updater modification is needed. Existing cached update
metadata may remain visible until WordPress refreshes the feed.

## Artifact

- Version: **2.25.8**; **227 files**, **1,126,748 bytes**.
- ZIP SHA-256: `640bd0a87db06c2058d90c084d6f3407f544da818c2a0ffc5d92cab5737bb348`.
- Manifest SHA-256: `70886e81e77bd1e544e0f9d5c2f8315487a53109d9bf30c2970612bde2021e26`.
- Candidate: `/home/agent/.cache/overseek-release/candidate-2.25.8/overseek-wc-plugin.zip`.
- Application download: `server/uploads/plugins/overseek-wc-plugin.zip` and its
  source-verified manifest; installer pins identify these exact bytes.
- SLDevs package: `updates/overseek-wc-plugin/overseek-wc-plugin-2.25.8.zip` in
  `/home/agent/workspaces/SL Devs Site`, alongside updated `info.json`, public
  `changelog.html` and rebuilt `sldevs-site.zip`.

## Validation and deployment

Package creation and verified publication check CRCs, exact runtime source hashes,
one plugin root and consistent header/constant/asset versions. The publisher's
six tests include native changelog markup, escaping and wrapped bullet text.
PHP lint, PHP review regression execution and native WordPress staging checks
were not run: PHP is unavailable. This is not a native-verified release.

1. Run PHP lint and `php overseek-wc-plugin/tests/review-summary.php`, then test an
   in-place staging upgrade. Check reviews, badge images, the preference centre,
   classic/Blocks checkout and the native plugin-details changelog.
2. Upload the immutable versioned ZIP to SLDevs first, replace `info.json` last,
   and upload `changelog.html`. Retain older ZIPs. Prefer scoped files over a
   whole-site extraction that could replace unrelated feeds.
3. Verify public feed/download contents and compare the ZIP SHA-256. Purge CDN
   caches if needed. The live feed still served 2.25.7 during preparation.
4. Deploy the matching application download files and installer pins with the
   backend. This does not deploy the backend or alter 2.25.6's backend requirements.
5. Upgrade stores without uninstalling. Purge separately managed page caches/CDNs
   as needed; existing delivery estimates may require readiness revalidation.
