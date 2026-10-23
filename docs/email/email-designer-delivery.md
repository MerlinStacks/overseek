# Email designer and delivery validation

## What changed

- **Edit layout** is the editable canvas. **Delivery preview** calls the server, shared versioned compiler, merge resolver, conditional-block resolver and final tracking/unsubscribe preparation. It is not an inbox emulator or a promise of identical pixels across email clients.
- Flow designer previews include configured sender/reply-to overrides and UTM parameters. Saved flow IDs resolve campaign-name defaults using an account-scoped lookup. Unsaved standalone previews use `preview` as their campaign fallback. Recipient identity and data still differ in real delivery. Automation-specific reply markers and generated coupons require actual enrollment context, not synthetic preview data.
- Preview context is explicit: synthetic sample data or one of the account's recent orders. Stress scenarios cover long names, missing product images, empty carts, 25 items, discounts and missing delivery estimates. Images-blocked/plain-text/dark-CSS simulations never modify saved HTML; dark CSS is not Gmail/Outlook colour inversion emulation.
- The wide desktop editor has a contextual inspector, block movement buttons, Alt+Up/Down outside text inputs, style copying, warning links and explicit brand-default refresh. Existing saved logo/footer snapshots are not silently replaced.
- Shared brand sections are account-scoped, versioned snapshots. Updating the library requires confirmation and compare-and-swap. Existing emails change only when explicitly refreshed; refresh and insertion receive new design IDs and remain undoable.
- Shared sanitation uses parse5 in browser and server. The compiler owns responsive rules and Outlook conditional tables/button padding. Reverse stacking uses table direction rather than flexbox. Unsafe imported rich text is stripped, not executed.
- Older/unversioned visual documents require an explicit saved-HTML/import or visual-upgrade choice. An upgrade is saved before opening its new editable version. Keeping HTML preserves it as the import source, but subsequent visual edits still compile/sanitize it; this is not archival byte-for-byte preservation.
- Pasted nested-table emails with stylesheets or decorated table layouts are retained as one HTML block instead of being flattened into lossy visual sections. Inline typography, spacing, panels and links survive HTML-block edits. The import warning explains that custom stylesheet/media rules are not retained; keep Raw HTML mode for the original document. Selecting Visual Builder alone does not convert saved HTML: the setup preview continues to show that saved content until the editor saves a design.
- Renderer `overseek-email-2026.10.23` shares block padding/alignment defaults with the inspector and canvas, honours image/logo/product alignment and removes uncontrolled coupon/review outer margins. Text defaults are inlined for delivery as well as editing; an explicit block font size is not multiplied by heading defaults. Explicit HTML margins and typography remain intentional content styling. Rich-text imports retain sanitized block/inline styles in Lexical state, and initialization/selection changes do not rewrite saved HTML. Older renderer documents continue through the explicit keep-HTML/upgrade choice above.
- The left builder sidebar provides Structure, Blocks and Layers; Layers selects sections and blocks, including device-hidden content, without replacing the outline. Section/Block property tabs live in the right inspector. The redundant canvas guidance/device strip and block visibility dropdown are removed; mobile hiding remains a toggle. New palette blocks are responsive by default, and an unset block responsiveness flag also defaults on in the inspector/compiler. Explicit saved `false` flags and non-stacking sections remain respected. Delivery estimate content is already a full-width table and does not gain an empty responsive wrapper when its snapshot is missing.
- Layers supports section/block drag reordering, moves between columns/sections, clone and delete actions, and Alt+Up/Down on focused drag handles. All edits remain undoable. Clones receive fresh descendant IDs; invalid drop destinations never remove source content. Footers can be rearranged, cloned or deleted like other layers; removing the last unsubscribe/preferences link still triggers marketing preflight checks. Deleting the final section leaves an empty design that can be rebuilt from Structure or restored with Undo.
- Renderer `overseek-email-2026.10.23.1` inlines footer image/link/paragraph defaults so settings-editor centring and horizontal social icons survive the canvas image reset and email delivery. Default footer text now matches the settings editor's 14px dark text; explicit saved colours, margins, image display and dimensions still win. Existing footer snapshots are not replaced with unrelated current account content.
- Flow status is a single Enabled/Disabled switch. Enabling validates, confirms, saves and revision-checks/publishes any pending draft before requesting activation. Failed saves, revision conflicts or edits made during review/publication prevent activation. Disabling does not publish. Draft edits on an already-live flow remain unpublished until the operator disables and re-enables it; the editor and Flow Health panel explain that workflow. There is no separate publish button.
- Prepared recipient messages persist HTML, text, subject, unsubscribe headers, image references, renderer version and a canonical-order SHA-256 integrity hash. Manual/queued retries reuse that artifact and tracking identity, with consent/caps checked again. Explicit **resend** is a new delivery and intentionally gets fresh tracking. Sender overrides are stored alongside the artifact. A hash is an integrity check, not an authentication signature.

## Deployment

1. Apply all pending prerequisite migrations, including `20261022060000_marketing_workspace` and `20261022070000_email_designer_sections`, through the normal deployment procedure. Neither was applied by this implementation.
2. Build `@overseek/core`, generate Prisma and deploy client/API/sending workers together. Retire old workers; do not mix compiler versions during rollout.
3. Set `API_URL` to the public HTTPS API origin. Set `PUBLIC_ASSET_URL` if public uploads use a different HTTPS origin. These are origins, not URL path prefixes. Ensure `/uploads/email-assets/` is anonymously reachable, persisted/shared across API replicas, backed up and not removed by temporary-upload cleanup. Do not embed secrets in public images.
4. Asset uploads accept raster files up to 5 MB, bound input pixels and normalize to PNG (up to 10 MB). Animation is intentionally flattened to the first frame. Filenames are content-addressed and never overwritten. Existing storefront/external URLs are not automatically copied or guaranteed permanent; review block asset warnings and load images anonymously before publication.
5. Check real Postgres section-library revision conflicts, tenant isolation, quota-deferred frozen messages and consent changes before retry. Existing prepared-message retention follows email-body retention; do not blindly requeue expired/ambiguous sends.

## Offline QA pack

Run from the repository root:

```sh
npm run build -w @overseek/core
npm run email:qa:export -w overseek-server -- /absolute/writable/email-qa-output
```

The exporter uses Nodemailer's **stream transport**, never SMTP or a relay. It creates seven synthetic scenarios, each with `.eml`, prepared `.html`, `.txt`, integrity `.json`, plus `manifest.json`. It requires no mailbox credentials and makes no database queries. All links use reserved `example.invalid` addresses; external social icons emitted by the renderer may still appear as image references. The manifest initially records every mailbox result as `NOT_RUN`.

A pack was generated at `/home/agent/.cache/opencode/email-qa-20261022`. It contains synthetic data, not a production-message capture. Export after rebuilding core when the renderer changes.

## Real mailbox sign-off (still required)

Use an authorized staging sender and dedicated Gmail, Outlook (including Windows desktop if supported) and Apple Mail inboxes. Do not use a live audience or enable a campaign for QA. Send only after an operator explicitly supplies/approves those inboxes. Importing an `.eml` is useful for local inspection but does not validate provider ingestion, relay rewriting or deliverability.

- [ ] Record provider/client/OS versions, sender authentication results, renderer/hash, scenario and received Message-ID.
- [ ] Capture desktop and narrow-mobile light/dark screenshots for every scenario. Compare subject/preheader, width, stacking order, typography, Outlook buttons, wrapping and footer.
- [ ] Repeat with images disabled; verify useful alt text, contrast and accessible link text. Verify custom-font fallbacks.
- [ ] Inspect the received raw MIME: decode HTML/text and compare with the stored prepared artifact, allowing only transport line-ending/transfer-encoding changes. Document any relay/provider body or header rewriting rather than marking it identical.
- [ ] Verify click destination/query entities, UTM values and direct unsubscribe/preferences headers with **test-only identities**. Do not unsubscribe a real customer during QA.
- [ ] Exercise a staging transient failure/quota deferral and verify unchanged prepared hash/body/tracking identity on retry. Explicit resend should have a new identity.
- [ ] Check anonymously reachable PNG assets after logging out and across API replica restarts.
- [ ] Store screenshots/raw MIME securely and update a copy of the manifest with PASS/FAIL, evidence paths and reviewer/date. Any unresolved layout defect blocks fidelity sign-off.

Real inbox and visual-browser checks were not performed here: mailbox access was unavailable and Chromium lacked required system libraries. No migration, activation, campaign send or real test email was performed.

## Automated verification

- Shared-core CommonJS/ESM builds, Prisma generation and schema validation passed.
- Final focused replay with one worker passed **153 client tests** (34 files) and **151 server tests** (14 files), including preview cancellation/timeouts, sender/UTM parity, library tenant/revision boundaries, raster assets, MIME round trips and frozen retry integrity. Parallel runs under whole-suite load hit timeouts; the serialized replay passed without changing application behavior or dropping assertions.
- A full server run passed **3,622 tests**, with **131 skipped**. That run began before the last narrow test additions; use the final focused replay for those changes.
- The full client run completed with **1,457 passing and 5 timeout failures** across 253 files. All five affected files then passed a one-worker replay (**35 tests**) with their original timeout settings; no assertions or test source were changed to hide those failures. This is not a claim that the original parallel full run was green.
- Both application typechecks passed at an earlier checkpoint. The latest shared-checkout check is blocked by concurrently edited `client/src/components/common/RichTextEditor/plugins/ToolbarPlugin.tsx` (Lexical exports) and `server/src/routes/invoiceRelay.ts` / `server/src/routes/invoices.ts` (`never` property errors). These unrelated files were not altered to mask the failures. Resolve and rerun before release.
- `git diff --check` passed. The offline pack exported successfully and contained no unresolved merge tokens.
