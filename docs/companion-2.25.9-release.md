# Companion 2.25.9 release

Prepared on 2026-10-21. Published to the **local application-download and SL Devs
Site files only**. No live hosting upload or WordPress staging upgrade was performed.

## Release contents

See [customer release notes](companion-2.25.9-release-notes.txt). Preserves Google
click-ID types and captures GA4 browser sessions per stream, including GS1/GS2
cookies. Meta cookies, values and browser/server deduplication IDs are unchanged.
Deploy the matching OverSeek server before upgrading the companion plugin.

The update feed supplies ordinary headings, paragraphs and lists through
`sections.changelog`. WordPress renders this in its native Changelog tab; no
nested frame, preformatted box or custom scroll container is supplied. WordPress's
own standard plugin-details modal is unchanged. Cached update metadata may need
refreshing before the new notes appear.

## Artifacts

- Plugin version: **2.25.9**, retaining the declared WooCommerce compatibility.
- ZIP: **227 files**, **1,127,257 bytes**.
- ZIP SHA-256: `0238cdf11427b1f39325109c410794890d6c26c6c2511aa4306c8e7ced8b165b`.
- Application manifest SHA-256: `07ff66958689e940ae6232acde7ea5470f557385d71bba519d2d48f55e0c17f0`.
- Application download: `server/uploads/plugins/overseek-wc-plugin.zip` and its
  source-verified manifest; installer version and hash pins match these bytes.
- Site ZIP: `/home/agent/workspaces/SL Devs Site/updates/overseek-wc-plugin/overseek-wc-plugin-2.25.9.zip`.
- Site metadata: adjacent `info.json`, public `changelog.html`, and rebuilt
  `/home/agent/workspaces/SL Devs Site/sldevs-site.zip`.
- Feed generated: **2026-10-21 22:21:57 UTC**. Earlier versioned ZIPs were retained.

## Validation

- All **15** package/download tests and **7** site publishing tests passed.
- PHP-WASM syntax parsing passed for **158** PHP files. Review-summary and
  classic/Blocks purchase-link/checkout regression scripts also passed.
- Site feed and package version/checksum match the application download exactly.
  The full-site archive contains the exact updated feed, ZIP and public changelog.
- A regression checks native changelog elements and rejects frame, embed,
  preformatted, script/style and custom scrolling markup in the OverSeek feed.
- Native WordPress installation, in-place upgrade and visual modal verification
  remain staging checks; the checks above do not certify those runtime flows.

## Live deployment

1. Deploy the matching OverSeek backend separately.
2. Test an in-place staging upgrade, Google attribution, Meta purchase matching,
   classic/Blocks checkout and the native plugin-details Changelog tab. Do not uninstall.
3. With DirectAdmin/SFTP access, upload the immutable `2.25.9` ZIP first, followed
   by `changelog.html`. Replace this plugin's `info.json` last, preferably atomically.
   Retain older ZIPs. Do not extract the full-site archive over unrelated live feeds.
4. Verify the public ZIP's SHA-256 and JSON version; purge feed/CDN caches if needed.
5. Review Google import eligibility, real consented orders and campaign goals.
   The release does not automatically configure an import or switch Primary actions.

The live feed served **2.25.8** during preparation. Live deployment requires hosting
access not available to this session; publishing local site files is not a live upload.
