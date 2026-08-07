# Wholesale PDF Catalog Generator Plan

## Goal

Add an account-level `WHOLESALE_CATALOG` feature that a super admin can enable in the existing Manage Accounts screen. Enabled accounts can maintain wholesale-only product information, generate multiple branded PDF catalogs whose final page contains wholesale ordering instructions and terms, and share them through protected customer-specific page viewers.

This document records the agreed design and the implementation/rollout status.

## Implementation Status (7 August 2026)

Phases 2 through 6 are implemented in the application code. This includes the feature gate and permissions, Prisma foundation, wholesale product configuration, catalog/defaults/branding management, queued immutable PDF generation, protected customer sharing, customer-specific artifacts, the isolated watermarked page viewer, analytics, notifications, staleness tracking, validity reminders, and retention jobs.

Static and automated verification completed during implementation includes Prisma schema validation, server/client TypeScript checks, a client production build, the full 115-file/603-test server Vitest suite, the full 28-file/117-test client Vitest suite, wholesale-focused server tests, and repository diff checks. A server-suite regression was isolated to an unnecessary import from the general Woo service into the Zod-backed wholesale settings module; the pure tax-import parser is now separated in `services/wholesale/taxImport.ts` so general content-route tests do not load wholesale settings as a side effect. The focused regression tests and complete suites pass after that refactor.

Phase 7 remains a deployment and acceptance activity. The current development environment has no running Docker daemon/PostgreSQL/Redis, so the live infrastructure checks listed below must be completed in the normal Docker development environment before pilot enablement. The server suite's expected Redis connection warnings did not cause test failures.

### Deployment and pilot checklist

- Apply `server/prisma/migrations/20260807000000_add_wholesale_catalog_foundation/migration.sql` and regenerate/verify Prisma Client in the target environment.
- Build the server image and confirm `poppler-utils`, approved fonts, `PRIVATE_UPLOADS_DIR`, and the persistent `private_uploads_data` volume are present and writable.
- Start PostgreSQL and Redis; run the complete server and client test suites without ignored failures.
- Exercise one successful, cancelled, failed, retried, and worker-recovered BullMQ generation.
- Generate visual fixtures for compact eight-card pages, a large variation gallery, five tiers ending in POA, missing/corrupt images, and maximum terms content; confirm A4 landscape output and exactly one final terms page.
- Configure a real outbound account email, create a customer share, verify activation ordering and resend/password rotation, and confirm first-page/new-viewer notifications.
- Verify unlock, five-attempt lockout, expiry, revocation, feature disable/re-enable, 24-hour sessions, watermarked page/thumbnails, staff PDF download, and absence of a public PDF endpoint.
- Run retention/validity jobs against test records and inspect Bull Board, structured logs, storage cleanup, and restart recovery.
- Load-test the 500-product limit and one-active-generation-per-account policy before enabling an internal pilot account.
- Obtain business approval of representative pricing, branding, terms, confidentiality/privacy copy, and printed PDF output.

## Initial Scope

### Included

- Super-admin feature toggle per account.
- A Wholesale Catalog area available only to enabled accounts.
- Wholesale settings on each product:
  - Multiple quantity breaks and unit prices.
  - Catalog-only notes.
  - One or more personalisation badges: `Engraving`, `Sublimation`, `UV`, `DTF`, or `Embroidery`.
  - Optional catalog image override, falling back to the product's first image.
- Multiple catalogs per account, each with its own product selection, category grouping, and ordering.
- Branding imported from the connected WooCommerce website, then reviewed and editable by staff.
- Catalog-level terms configuration, copied when a catalog is duplicated.
- Product selection, validation, preview summary, generation history, and internal artifact storage.
- A branded, A4 landscape PDF with the terms sheet as the final page.
- Customer-specific, password-protected viewer links with expiry, revocation, and recipient watermarks.
- No customer-facing PDF download control in version 1.
- Account scoping, role permissions, audit records, and automated tests.

### Not included in the first release

- Customer-specific price lists.
- Checkout or wholesale order placement.
- WooCommerce write-back for wholesale fields.
- Scheduled generation or automatic emailing.
- A free-form drag-and-drop PDF designer.
- Unprotected or anonymous catalog links.

These can be added later without changing the core product pricing model.

## Confirmed Decisions for Version 1

1. **Wholesale data is local to Overseek.** It must not be stored only in `WooProduct.rawData`, because product synchronization replaces that payload.
2. **Quantity breaks use minimum quantity plus unit price.** For example, `1 -> $12.00`, `25 -> $10.50`, and `100 -> $9.00`. The next break determines the previous break's upper bound, avoiding overlapping ranges.
3. **Pricing is product-level in version 1.** One shared quantity-price table applies to all variations of a variable product.
4. **A product may have multiple badges.** The list can be empty when a product does not use a supported personalisation process.
5. **The catalog is A4 landscape.** This matches the supplied terms-page reference and gives enough width for product imagery and quantity pricing.
6. **Generation runs as a BullMQ job.** Image-heavy PDFs can exceed a normal HTTP request timeout. The UI will poll generation status and expose the file when ready.
7. **PDF output is rendered server-side with PDFKit.** The server already uses PDFKit for invoices and has queue and stored-artifact patterns that can be reused.
8. **The first tier defines the product-specific MOQ.** It can begin at any valid positive quantity; it is not required to begin at one.
9. **Tax display is configurable per catalog.** Staff choose tax-inclusive or tax-exclusive labels while prices continue to use `Account.currency`.
10. **Accounts can create multiple catalogs.** Each catalog independently selects and orders products and categories.
11. **Catalogs include a cover and category structure.** The final terms content must fit exactly one page.
12. **Customer access uses protected page viewers, not a customer PDF download.** Staff select an existing WooCommerce customer and create a unique link with a password, expiry, revocation, and recipient watermark.
13. **Branding is imported, then editable.** Overseek detects branding and business details from the connected WooCommerce website, stores an approved snapshot, and lets staff correct it.
14. **Only eligible products can be selected.** Products must be published, currently in stock, have a parent SKU, have a usable main image, and have at least one numeric or POA quantity tier. A variable product is in stock when any variation is in stock.
15. **Removing all tiers removes products from visible catalog output.** Deleting a product's final tier shows a simple warning, then suspends its placements so it disappears from builders/output; remembered placements restore automatically if pricing returns unless staff manually clears them. POA counts as a valid tier.
16. **Product content is shared across catalogs.** Wholesale tiers, notes, badges, and selected main image have one product-level source. Product names and category names come from WooCommerce.
17. **Catalog grouping follows WooCommerce.** Use the product's first Woo category, flatten nested categories, place uncategorized products under `Products`, follow Woo category order, and sort products alphabetically within each category.
18. **Product pages show up to eight cards.** Use fewer cards or a dedicated product page when notes, tiers, or variation images require more space.
19. **Variable products show all unique in-stock variant images.** Group variants that share an image and show option labels plus variation SKUs. Omit variants without an image from the thumbnail gallery. Large galleries receive a dedicated product page.
20. **Price tables show automatic ranges and per-unit prices.** The final range uses `100+` style, quantity means individual units, and MOQ appears both as a badge and in the table.
21. **Pricing supports up to five tiers.** Numeric prices must be positive and non-increasing as quantities rise. POA may be used on a tier, requires a minimum quantity, and ends numeric pricing for that product.
22. **Wholesale price entry follows the WooCommerce tax basis.** Import and display Woo's `prices entered with tax` setting, snapshot the basis with the tiers, import an editable account GST rate, convert displays to the catalog's include/exclude GST choice, and round to the nearest cent. A later Woo basis change warns but never reinterprets stored prices automatically.
23. **Price presentation uses the currency symbol and two decimals.** Every page footer states whether prices include or exclude GST.
24. **Notes use restricted simple formatting.** Support bold, bullet lists, and line breaks, targeting roughly 250 characters per product.
25. **Catalog terms use account defaults copied into each catalog.** The supplied reference text is transcribed into fully editable structured sections; owner/admin approval is required for initial defaults. Later default changes offer an explicit update action for drafts rather than silently replacing catalog terms.
26. **Terms and commercial callouts are editable.** Deposit percentage/minimum, high-value threshold, ordering instructions, headings, section order, body text, and footer details can be changed. New generated versions require approval; old pinned shares remain unchanged.
27. **The visual layout is brand-adaptive.** Reuse the reference layout but recolour it from approved account/catalog branding. Import branding/business details from Woo settings plus public site metadata, show ambiguous choices for review, support PNG/JPEG/sanitized SVG logos, and fall back to manual setup and an approved bundled font.
28. **Catalog identity has internal and public names.** Covers include brand/catalog information, generation date, confidentiality notice, and customer-specific `Prepared for` company then contact details.
29. **Generated versions are immutable and approved before sharing.** The generator may approve their own version after preview. Displayed-data changes mark approved versions stale for staff, while customers receive no stale warning and existing shares stay pinned.
30. **Sharing is customer-specific.** Staff must select a Woo customer, explicitly choose an expiry no more than 90 days away, and use either a generated or custom password. Multiple active shares for one customer/version are allowed.
31. **Sharing requires outbound email setup.** Access email uses the connected account email and imported store branding, allows an editable subject/introduction, and sends the link and password in the same email. Manual copy remains available after a share is created, but share creation is blocked until outbound email is configured.
32. **Recipients use a protected page viewer.** No customer download or print controls. Mobile uses zoomable full-page images. Browser unlock lasts 24 hours, allows multiple logged devices, and locks for 15 minutes after five failed passwords.
33. **Viewer identity and acceptance are recorded.** Every viewer enters a self-declared name/email, sees explicit privacy/activity-logging notice, and accepts the editable account confidentiality notice once per viewer/share version. Forwarded viewers are allowed.
34. **Watermarks identify customer and viewer.** Stored personalized pages show the selected customer; each response adds a diagonal translucent `Viewed by` overlay with viewer name/email and confidentiality wording. Customer details also appear in every page heading; the final terms page uses watermarking rather than a separate prepared-for block.
35. **Viewer activity is accountable.** Notify the share creator by email and in-app on first open and each new viewer identity. Show summary analytics and retain viewer/access records for 12 months after link expiry.
36. **Staff receive customer-specific downloads.** When a share is created, generate stable customer-specific page assets and a customer-specific, diagonally watermarked PDF named with customer, catalog, date, and version. Only authorized staff can download it.
37. **Feature disablement suspends links.** Links resume automatically when re-enabled if still valid. Archiving prevents new work but leaves pinned shares active. Catalogs with history cannot be permanently deleted. Deleted Woo customers do not break snapshotted shares.
38. **Operational limits are explicit.** Support up to 500 products per catalog, one active generation per account, balanced approximately 150-DPI output, cleanup failed/unapproved artifacts after seven days, and retain approved artifacts for 90 days after their final share expires.
39. **Permissions are `view`, `edit`, `generate`, and `share`.** Owners/admins receive all by default; VIEWER can see internal previews/history. Product wholesale editing follows `edit`; approval and staff download follow `generate`; link/email/revocation follows separate `share`. Super admins must impersonate an account user to access content.
40. **First enablement uses a setup checklist.** Verify/import branding, Woo tax basis and GST rate, outbound email, default terms approval, wholesale product setup, and first catalog generation.
41. **Stale versions cannot create new shares.** Existing links continue unchanged, but staff must regenerate and approve current data before sharing with another customer.
42. **Typography has approved minimums.** Product cards and the final terms body never fall below 8 pt. Notes warn after 250 characters and reject content above 1,000 characters.
43. **Share passwords require strength.** Custom passwords require at least 12 characters and reject common/compromised values. Generated passwords use four random lowercase hyphenated words.
44. **Customer-specific PDF names are predictable and safe.** Use `Company-Catalog-YYYY-MM-DD-vN.pdf` in account timezone with ASCII-safe transliteration; preserve original names inside the document.
45. **Email and confidentiality defaults are defined.** Subject defaults to `[Catalog] prepared for [Company]`; introduction explains prepared access, expiry, and confidentiality. Default acknowledgement is named-recipient/confidential-use wording with checkbox `I agree to keep this confidential`.
46. **Viewer identity requires name and email.** Validate email format only. Acceptance covers confidentiality, not commercial ordering terms. Notify first-open only when the first page is actually served.
47. **Email activation is fail-closed.** Track delivery/bounces only. If activation email fails, do not activate or expose the URL; retain ready personalized artifacts for a new-password retry.
48. **Catalog editing is explicit and recoverable.** Catalog and product wholesale forms use explicit Save. Keep the latest 25 restorable catalog-configuration snapshots. Duplicate names use `[Name] v2`. Fast browser preview is approximate; exact generated pages are approved with an optional note.
49. **Generation is observable and cancellable.** Show stage plus percentage, notify requester in-app on success/failure, permit cooperative queued/running cancellation, keep cancelled metadata while deleting partial files after seven days, and enforce a 30-minute timeout.
50. **Generation versioning is immutable.** Every successful render consumes the next sequential vN. Retrying a failure creates a linked attempt using the exact same snapshot. Use a private bounded image cache.
51. **Customer access cannot be revived after expiry.** Expiry is capped at 90 days from share creation, not rolling; customers needing later access receive a new share. Revocation immediately ends sessions. Forgot-password UI directs them to the sender.
52. **Viewer lifecycle is visible.** Statuses are preparing, ready, active, locked, expired, revoked, and failed. Analytics appear per share and as a catalog summary. There is no idle timeout inside the 24-hour session.
53. **Viewer navigation uses protected thumbnails.** Show a watermarked thumbnail sidebar plus previous/next/page-number controls. Fetch full pages privately and preserve zoom support; disable text selection/right-click only as a documented deterrent.
54. **Eligibility removals are reversible unless staff intervenes.** Ineligible stock/no-tier placements become hidden suspended records so products disappear from builder/output but automatically restore to former catalogs when eligible again. Suspended placements remain invisible to staff until restoration. Manual removal clears remembered restoration for that catalog. Restoration sends an in-app summary and marks affected approved versions stale.
55. **Woo display changes flow into drafts.** First-category changes move placement automatically; Woo name changes update drafts. Both mark affected approved generations stale.
56. **Terms support up to 12 sections.** Overflow at 8 pt can request AI shortening suggestions with per-section before/after review and explicit acceptance. If AI is unavailable, show manual section/character guidance. Accepted AI copy follows the normal terms edit/approval process.
57. **Approval is lightweight but explicit.** Do not force every page to be opened. Use one confirmation plus optional approval note. Approximate previews are not approvable; only exact generated pages are.
58. **AI shortening uses account OpenRouter settings.** Do not add an extra confirmation beyond the user clicking the suggestion action. Audit accepted suggestions only, without retaining full prompts/responses in general logs.
59. **Main-image quality warnings begin below 800×800 pixels.** Warnings do not block generation. Customer-specific PDF downloads show a warning every time that files sent outside the viewer cannot be revoked or tracked.
60. **Viewer privacy is minimized and controlled.** Store truncated IP addresses, restrict viewer/device analytics to `share` permission, provide no analytics export, support identity/IP anonymization while retaining non-identifying security events, and retain exact rendered confidentiality copy/hash with acceptance evidence.
61. **Engagement analytics remain conservative.** Track unique pages, completion percentage, and last page reached, not time-on-page. Filter known email-security scanners. Notification emails/in-app alerts default on but can be muted per share.
62. **Variation details follow Woo ordering.** Option/SKU labels may shrink to 7 pt for large groups; variable products with no variant images remain eligible using the main image only. Never display exact stock quantities.
63. **Show retail comparison and wholesale savings.** Display parent Woo regular price as `RRP` near the heading, converted to the catalog GST mode. Every numeric tier shows `Save $X/unit` versus RRP. If parent RRP is missing, omit RRP/savings without blocking. POA has a generic `Contact us` instruction.
64. **SKU presentation is normalized visually.** Preserve underlying identifiers but render parent and variation SKUs in uppercase.
65. **Product page design is print-clean.** Use white pages with brand accents and clean bordered cards. Personalisation uses fixed platform icons and fixed process colours rather than text labels on each card.
66. **Process icon overflow is explicit.** Show up to three icons then `+N`; add a renderer-generated process line alongside notes naming hidden processes. Include shape/colour distinctions and metadata alt text. Repeat the fixed five-icon legend in every product-page footer.
67. **Viewer UI includes fullscreen and deterrence controls.** Watermarked thumbnail sidebar, previous/next/page number, fullscreen, zoom, disabled text selection/right-click, no print/download. These controls do not claim to prevent technical copying.
68. **Catalog pricing has explicit validity.** Before generation, staff choose a valid-until date with a suggested default of seven business days from generation. Display `Effective [date] · Valid until [date]` using account timezone and end validity at 23:59:59 account-local time.
69. **Expired pricing remains viewable with strong warning.** Existing shares may outlive commercial validity; after validity ends, keep pages accessible but overlay `Pricing expired — contact us for current pricing` on every page. Retain analytics/history normally. Expired versions cannot create new shares.
70. **Validity can be extended carefully.** `generate` permission may extend up to 30 days from original generation, including reviving an expired version, but never when stale. No reapproval is required because displayed products/prices do not change.
71. **Validity extension regenerates overlays.** Regenerate master/customer page and PDF date overlays, preserve old artifacts while showing an updating state, then switch all hosted assets atomically. Warn each user once that previously downloaded PDFs cannot update or be revoked.
72. **Validity reminders are proactive.** Notify the catalog generator by email and in-app two days before validity ends.

> Confidentiality limitation: hiding download controls discourages casual saving but cannot prevent screenshots, browser developer tools, or a determined recipient from copying displayed content. Passwords, expiry, revocation, recipient watermarks, rate limits, and access logs provide deterrence and accountability rather than absolute copy prevention.

## Current Architecture to Reuse

- Feature flags: `AccountFeature` in `server/prisma/schema.prisma`.
- Super-admin toggles: `server/src/routes/admin.ts` and `client/src/pages/admin/AdminAccountsPage.tsx`.
- Client feature checks: `client/src/hooks/useAccountFeature.ts`, `FeatureGuard` in `client/src/App.tsx`, and `client/src/components/layout/Sidebar.tsx`.
- Server feature checks: `server/src/utils/accountFeatures.ts`.
- Product storage: `WooProduct` in `server/prisma/schema.prisma`.
- Product editing: `client/src/pages/ProductEditPage.tsx` and `client/src/hooks/useProductEdit.ts`.
- Product routes: `server/src/routes/products.ts` and `server/src/services/products.ts`.
- PDF rendering precedent: `server/src/services/InvoiceService.ts`.
- Queue precedent: `server/src/services/queue/QueueFactory.ts`, `server/src/workers/index.ts`, and canonical invoice generation.
- Account role permissions: `AccountUser.permissions`, `AccountRole.permissions`, and `client/src/components/settings/RoleManager.tsx`.

## User Experience

### 1. Super Admin

- Add `WHOLESALE_CATALOG` to `KNOWN_FEATURES`.
- Display it as **Wholesale Catalog** in Manage Accounts.
- Missing feature rows default to disabled, matching most existing feature flags.
- Disabling the feature hides the tenant UI and causes all wholesale API routes to return `403`. Existing data and generated artifacts remain stored so re-enabling does not lose configuration.

### 2. Product Edit

When the account feature is enabled and the user can manage wholesale data, add a **Wholesale** tab to the product editor.

The panel contains:

- **Personalisation types** manually assigned multi-select with labels `Engraving`, `Sublimation`, `UV`, `DTF`, and `Embroidery`.
- **Catalog notes** restricted editor for bold, bullets, and line breaks, with a roughly 250-character target and visible layout guidance.
- **Catalog image** selector:
  - Default to the first current product image.
  - Allow selection from existing product images.
  - Allow an optional URL override only if required by operations.
- **Quantity pricing** editor:
  - Add, remove, and reorder rows.
  - Support a maximum of five tiers.
  - Minimum quantity must be a positive integer.
  - Each row is either a positive unit price or `POA`; zero is not valid.
  - Minimum quantities must be unique and ascending.
  - Show the inferred display range, such as `1-24`, `25-99`, `100+`.
  - Require numeric unit prices to stay the same or decrease as quantity increases.
  - A POA row ends numeric pricing, so later rows cannot return to numeric prices.
  - Display the imported WooCommerce tax-entry basis and account GST rate.
  - Show a simple warning before deleting the final tier; confirmation suspends remembered placements and removes the product from every builder/output until pricing returns.
  - Show full change history with editor, timestamp, old/new values, and affected catalogs.
- Save wholesale fields independently from WooCommerce fields through a dedicated endpoint. This avoids accidentally writing local catalog fields back to WooCommerce.

Catalog inclusion and ordering are not stored on the product profile because they differ between catalogs. Read-only users may see the tab only if they have the view permission, with all inputs disabled.

### 3. Wholesale Catalog Area

Add a sidebar item and `/wholesale-catalog` route. Its landing page lists the account's catalogs and provides create, duplicate, archive, and open actions. Opening a catalog provides the sections below.

#### Products

- Search by product name or SKU.
- Only show selectable products that are published, in stock, have a parent SKU, usable main image, and at least one numeric or POA tier.
- Filter by selected/unselected, badge, category, and readiness warnings such as low-resolution images.
- Add/remove products from the current catalog in bulk.
- Show readiness indicators and direct links to each product's Wholesale tab.
- Assign the first Woo category, flatten category hierarchy, place uncategorized products under `Products`, preserve Woo category order, and sort products alphabetically.
- If all products in a category become unavailable, omit the empty category.
- Use compact branded category-name headings rather than divider pages.

#### Design and Terms

- **Import branding from store** action that reads public branding/business metadata from the connected WooCommerce website.
- Review screen showing detected logo, colours, fonts, business/contact details, and source URLs before applying them.
- Catalog title and optional subtitle.
- Editable logo, primary/accent colour, font choices, and business details after import.
- Cover page and cover text.
- Footer business name, ABN/company number, phone, email, website, and effective-date text.
- Pricing display options:
  - Tax-inclusive or tax-exclusive label selected for the catalog.
  - Currency from `Account.currency`.
  - Symbol-only prices with two decimals and nearest-cent GST conversion.
- Terms-page editor based on the supplied reference:
  - Heading and subheading.
  - Prominent payment/deposit callout.
  - Optional secondary callout for high-value orders.
  - Ordered terms sections, each with a heading and body.
  - Footer legal text and confidentiality text.
- A screen preview of the terms page using the same normalized settings consumed by the renderer. It is a layout approximation, not an iframe or HTML-to-image PDF.
- Enforce the approved one-page terms limit before generation rather than shrinking text below the minimum readable size.
- Start from approved account default terms copied into the catalog; show an explicit update option when defaults later change.

#### Generate

- Show selected product count and validation summary.
- Automatically suspend/hide remembered placements when products lose all tiers or become out of stock, and restore them when eligibility returns unless staff manually removed them. Block generation if there are no eligible selected products, any remaining selection became unpublished/lost its parent SKU or image, required terms are empty/overflow one page, or catalog/tax/terms setup is incomplete. Outbound email is required only when preparing/activating customer sharing, not for generation.
- Warn, but still generate, for low-resolution images and missing optional notes/badges.
- Generate button creates an asynchronous job.
- Generation history shows queued, rendering, awaiting approval, approved, failed, and artifact-expired states, plus a separate stale warning/reasons badge; creator/approver; date; product count; page count; and publish/share action.
- Require preview and explicit approval before sharing; the generator may approve their own output.
- Permit retry/regeneration from current data.

#### Customer Access

- Staff select an existing account-scoped `WooCustomer` after generation.
- Search Woo customers by company, name, or email. Manual/non-Woo recipients are not supported in version 1.
- Staff must explicitly set an expiry no more than 90 days away and either enter or securely generate a password.
- The system creates a unique high-entropy viewer URL for that customer and generation.
- Show the password once; only a strong password hash is stored. Resending rotates the password and invalidates existing sessions.
- Share preparation queues customer-specific artifacts. Once ready, activation accepts or generates the password, sends it while plaintext exists, hashes it, and returns the active link/password result.
- Staff can copy the active link, rotate the password, change expiry, and revoke access.
- Activation sends a branded, editable access email from the connected account email with link and password in the same message. Block share preparation/activation when outbound account email is not configured.
- After password authentication, collect each viewer's self-declared name/email, show explicit monitoring/privacy wording, and require acceptance of the account confidentiality notice for that share version.
- The recipient sees zoomable page images without PDF download or print controls. Keep the browser unlocked for 24 hours and allow/log multiple devices.
- Stored personalized pages carry the customer watermark; each response adds a diagonal translucent customer/viewer/confidentiality overlay server-side.
- Notify the share creator by email and in-app on first open and each new viewer identity.
- Show summary analytics and retain identity/access records for 12 months after link expiry.
- Lock a share for 15 minutes after five failed password attempts.
- Provide authorized staff a customer-specific, watermarked PDF download; recipients never receive the PDF endpoint.

## Proposed Data Model

Names can be adjusted to match final Prisma conventions, but the responsibilities should remain separated.

### Enum: `WholesalePersonalisationType`

- `ENGRAVE`
- `SUBLIMATE`
- `UV`
- `DTF`
- `EMBROIDERY`

The UI maps enum values to title-cased labels. Using an enum prevents spelling variants from leaking into generated catalogs.

### Model: `WholesaleProductProfile`

One local wholesale profile per `WooProduct`.

Suggested fields:

- `id String @id @default(uuid())`
- `accountId String`
- `productId String @unique`
- `notesDocument Json?` (restricted bold/list/line-break structure, not arbitrary HTML)
- `personalisationTypes WholesalePersonalisationType[]`
- `imageUrl String?`
- `priceTaxBasis` enum: `INCLUSIVE`, `EXCLUSIVE` (immutable for the current tier-set version)
- `priceSetVersion Int @default(1)`
- `createdAt DateTime`
- `updatedAt DateTime`
- Account and product relations with `onDelete: Cascade`.
- Index on `[accountId, productId]`.

`accountId` is intentionally present even though the product already belongs to an account. It makes tenant-scoped queries explicit and allows a database/application check that the profile and product belong to the same tenant.

### Model: `WholesalePriceTier`

Suggested fields:

- `id String @id @default(uuid())`
- `accountId String`
- `profileId String`
- `minimumQuantity Int`
- `unitPrice Decimal? @db.Decimal(12, 4)`
- `isPoa Boolean @default(false)`
- `sortOrder Int`
- `createdAt DateTime`
- `updatedAt DateTime`
- Account and profile relations with `onDelete: Cascade`.
- Unique constraint on `[profileId, minimumQuantity]`.
- Index on `[accountId, profileId]`.

The service replaces or reconciles all tiers, basis, and incremented tier-set version in one transaction after validating the complete set. The imported Woo basis can never be updated independently of its prices; a later basis mismatch requires an explicit migration/re-entry flow. It permits no more than five rows, requires exactly one of positive `unitPrice` or `isPoa`, generates ranges from sorted minimum quantities, enforces non-increasing numeric prices, and rejects numeric rows after POA. Decimal values stay as decimal strings across API boundaries rather than JavaScript floating-point values. Removing the last row suspends all remembered `WholesaleCatalogProduct` placements in the same transaction after confirmation.

### Model: `WholesaleCatalogDefaults`

One account-level defaults/setup row containing imported Woo tax-entry basis, editable imported GST rate, approved structured default terms, editable confidentiality acceptance wording, setup-checklist completion state, and approval metadata. New catalogs copy the current terms rather than maintaining a live relation. Drafts compare a defaults version/hash to offer an intentional update action.

### Model: `WholesaleBrandProfile`

One approved branding profile per account. It is populated by a safe import from the connected public WooCommerce website and can then be edited by staff.

Suggested fields:

- `id String @id @default(uuid())`
- `accountId String @unique`
- `logoUrl String?`
- `primaryColor String?`
- `accentColor String?`
- `headingFont String?`
- `bodyFont String?`
- `businessDetails Json`
- `importSources Json`
- `importedAt DateTime?`
- `reviewedAt DateTime?`
- `createdAt DateTime`
- `updatedAt DateTime`
- Account relation with `onDelete: Cascade`.

Do not automatically trust arbitrary remote CSS, fonts, scripts, or HTML. The importer extracts only allowlisted public metadata and image URLs using strict outbound-request protections. Generation uses the saved/reviewed profile rather than re-reading the live website every time.

### Model: `WholesaleCatalog`

One account can own multiple catalog definitions.

Suggested fields:

- `id String @id @default(uuid())`
- `accountId String`
- `name String`
- `publicTitle String`
- `subtitle String?`
- `coverText String? @db.Text`
- `pricesIncludeTax Boolean`
- `supplementaryPriceNotice String?` (cannot replace or contradict the derived GST statement)
- `brandingOverrides Json`
- `paymentCallout Json` (fully editable values and wording)
- `termsSections Json`
- `footerDetails Json` (imported defaults plus catalog overrides)
- `defaultsVersion String`
- `status` enum: `DRAFT`, `ACTIVE`, `ARCHIVED`.
- `createdAt DateTime`
- `updatedAt DateTime`
- Account relation with `onDelete: Cascade`.
- Indexes on `[accountId, status]` and `[accountId, updatedAt]`.

Structured JSON is appropriate for ordered, presentational terms sections, approved branding overrides, and footer fields. The API must validate and normalize the JSON with Zod; arbitrary HTML or JavaScript is not stored or rendered.

### Model: `WholesaleCatalogProduct`

Join model defining catalog-specific product selection, reversible eligibility suspension, and snapshotted first-Woo-category placement. Category hierarchy is flattened, category order follows Woo, and products sort alphabetically at query/render time. Suspended rows are excluded from ordinary builder/output queries and restore automatically when eligibility returns; explicit staff removal deletes the row so it cannot restore.

Suggested fields:

- `id String @id @default(uuid())`
- `accountId String`
- `catalogId String`
- `productId String`
- `categoryKey String?`
- `categoryLabel String?`
- `categorySortOrder Int`
- `isSuspended Boolean @default(false)`
- `suspensionReason` enum: `OUT_OF_STOCK`, `NO_PRICE_TIERS`, or null
- `suspendedAt DateTime?`
- `restoreAllowed Boolean @default(true)`
- `createdAt DateTime`
- `updatedAt DateTime`
- Account, catalog, and product relations with `onDelete: Cascade`.
- Unique constraint on `[catalogId, productId]`.
- Indexes on `[accountId, catalogId]` and `[catalogId, categorySortOrder]`.

### Model: `WholesaleCatalogRevision`

Restorable internal draft snapshots containing catalog design, copied terms, branding overrides, and product/category selection state. Each explicit catalog save creates a revision and prunes to the latest 25 per catalog. Revisions never copy generation approvals, customer details, shares, or passwords.

### Model: `WholesaleCatalogGeneration`

Tracks immutable queued work, private master artifacts, preview, approval, and staleness.

Suggested fields:

- `id String @id @default(uuid())`
- `accountId String`
- `catalogId String`
- `requestedById String`
- `status` enum: `QUEUED`, `RENDERING`, `AWAITING_APPROVAL`, `APPROVED`, `FAILED`, `CANCELLED`, `EXPIRED`.
- `versionNumber Int?` (assigned atomically when rendering succeeds)
- `retryOfId String?`
- `progressStage String?`
- `progressPercent Int @default(0)`
- `cancelRequestedAt DateTime?`
- `masterFilePath String?` (never exposed to recipients)
- `basePagesPath String?`
- `fileSize Int?`
- `pageCount Int?`
- `productCount Int`
- `inputSnapshot Json`
- `errorMessage String?`
- `startedAt DateTime?`
- `completedAt DateTime?`
- `approvedById String?`
- `approvedAt DateTime?`
- `approvalNote String? @db.Text`
- `effectiveDate DateTime`
- `validUntil DateTime`
- `originalGeneratedAt DateTime?`
- `validityArtifactStatus` enum: `CURRENT`, `UPDATING`, `FAILED`
- `validityRevision Int @default(1)`
- `staleAt DateTime?`
- `staleReasons Json?`
- `expiresAt DateTime?`
- `createdAt DateTime`
- `updatedAt DateTime`
- Account, catalog, and user relations.
- Indexes on `[accountId, catalogId, createdAt]` and `[status, createdAt]`.

`inputSnapshot` is the authoritative, immutable renderer input captured transactionally when generation is requested. It contains normalized product display fields, tier prices, ordering, branding, and terms, while excluding unnecessary Woo raw payloads and secrets. The worker reloads only the account-scoped generation record and renders this snapshot, so edits made after enqueueing cannot change the queued output. A regeneration creates a new snapshot and generation record.

`staleAt` and `staleReasons` form a derived warning flag, not a separate status. `EXPIRED` is used only after master artifacts are removed by retention cleanup; the approval timestamps remain historical metadata.

### Model: `WholesaleCatalogShare`

One protected recipient link for a selected `WooCustomer` and approved generation.

Suggested fields:

- `id String @id @default(uuid())`
- `accountId String`
- `catalogId String`
- `generationId String`
- `customerId String?`
- `customerSnapshot Json` (company, contact name, email, phone, billing identifiers needed for approved display)
- `tokenHash String @unique`
- `passwordHash String`
- `expiresAt DateTime`
- `revokedAt DateTime?`
- `failedAttempts Int @default(0)`
- `lockedUntil DateTime?`
- `lastAccessedAt DateTime?`
- `artifactStatus` enum: `QUEUED`, `RENDERING`, `READY`, `FAILED`, `EXPIRED`.
- `artifactError String?`
- `personalizedPdfPath String?`
- `personalizedPagesPath String?`
- `personalizedFileName String?`
- `confidentialityTextSnapshot String @db.Text`
- `privacyNoticeSnapshot String @db.Text`
- `emailedAt DateTime?`
- `createdById String`
- `createdAt DateTime`
- `updatedAt DateTime`
- Account, catalog, generation, and creator relations with cascading ownership cleanup; customer relation with `onDelete: SetNull`.
- Indexes on `[accountId, catalogId]`, `[customerId, createdAt]`, and `[expiresAt]`.

Store only hashes of the high-entropy URL token and password. Snapshot structured selected-customer display details, confidentiality wording, and separate privacy/activity notice so later Woo/default edits or customer deletion cannot change the cover, headings, watermark, acceptance record, or active share. Share preparation requires an approved generation and expiry within 90 days, then queues stable customer-specific page/PDF rendering. Only after artifacts are `READY` can activation atomically accept the plaintext password/email copy, hash the password, send it while plaintext exists, and return the active URL; no recoverable password is persisted. A short-lived, signed HTTP-only viewer session cookie is issued after successful password verification so the password is not sent on every page request.

`expiresAt` can never exceed 90 days from `createdAt`; an extension cannot move that absolute cap. Expired shares cannot be reactivated and require a new share record.

### Model: `WholesaleCatalogViewer`

One self-declared viewer identity per share/email combination, including name, email, first/last access, confidentiality acceptance timestamp, accepted text/version hash, and notification timestamp. Every newly identified viewer must accept the confidentiality notice before pages are served. The privacy/activity notice is displayed and snapshotted separately; it is not represented as contractual acceptance unless legal review later requires that. The selected Woo customer and current viewer can be different.

### Model: `WholesaleCatalogViewerSession`

Hashed session token, share ID, nullable viewer ID during the post-password/pre-identification stage, expiry (maximum 24 hours and never beyond share expiry), revoked timestamp, IP/user-agent/device summary, and last activity. Identification binds the viewer ID; page access remains blocked until binding and confidentiality acceptance are complete. Multiple active device sessions are allowed. Password rotation, share revocation, feature suspension, or expiry invalidates access.

### Model: `WholesaleCatalogAccessLog`

Append-only security log for share authentication and viewing. Suggested fields include `shareId`, `viewerId`, `sessionId`, `accountId`, event type, success, IP address, user agent, page number, and timestamp. Retain through 12 months after share expiry and avoid storing submitted passwords or raw share tokens.

### Account reverse relations

Add reverse relations for profiles, tiers, defaults, branding, catalogs, catalog products, generations, shares, viewers, viewer sessions, and access logs. Do not edit or commit files under `server/prisma/generated/prisma`; regenerate through the established Prisma workflow.

## API Plan

Create authenticated management routes in `server/src/routes/wholesaleCatalog.ts`, register them under `/api/wholesale-catalog`, and create a separate minimal public viewer route module under `/catalog-view`. Move rendering, sharing, branding import, and business logic into focused services.

### Feature and authorization rules

Every endpoint must:

1. Require a valid authenticated account context.
2. Call `isAccountFeatureEnabled(accountId, 'WHOLESALE_CATALOG')`.
3. Enforce the required permission.
4. Scope every query by `accountId`, including download/history lookups.

Suggested permissions:

- `view_wholesale_catalog`
- `edit_wholesale_catalog`
- `generate_wholesale_catalog`
- `share_wholesale_catalog`

Owners/admins receive all four by default. VIEWER receives internal preview/history only. Product data/design/terms use `edit`; generation/approval/customer-specific staff download use `generate`; customer link/email/password/revocation use `share`. Add all permissions to custom role management. Super admins access catalog content only by impersonating an account user.

Endpoint-level read matrix: `view` permits catalog lists/details, product wholesale data in read-only form, generated preview/history, and non-secret share summaries/analytics. It never permits source-file download, customer link creation, password operations, email, or mutation. `generate` is additionally required for customer-specific staff PDF downloads.

### Authenticated management endpoints

- `GET /api/wholesale-catalog/branding`
  - Return the approved account branding profile.
- `POST /api/wholesale-catalog/branding/import`
  - Safely detect public store branding and return a reviewable draft; do not apply it silently.
- `PUT /api/wholesale-catalog/branding`
  - Validate and save the staff-approved branding profile.
- `GET|PUT /api/wholesale-catalog/defaults`
  - Manage imported Woo tax basis/GST rate, approved account terms, confidentiality wording, and setup checklist.
- `GET|POST /api/wholesale-catalog/catalogs`
  - List or create account catalogs.
- `GET|PUT|DELETE /api/wholesale-catalog/catalogs/:catalogId`
  - Read/update/archive; permit permanent deletion only when no generation record has ever existed. Archived catalogs reject edits, product reconciliation, generation, and new shares, while expiry/revocation/access for existing shares continues.
- `POST /api/wholesale-catalog/catalogs/:catalogId/duplicate`
  - Duplicate products, design, and terms as `[Internal Name] v2` without copying revisions, generations, approvals, customers, or shares.
- `GET /api/wholesale-catalog/catalogs/:catalogId/revisions`
  - List the latest 25 internal save snapshots.
- `POST /api/wholesale-catalog/catalogs/:catalogId/revisions/:revisionId/restore`
  - Explicitly restore a revision as a new current save/revision.
- `GET /api/wholesale-catalog/products`
  - Paginated readiness list with filters; do not load every Woo `rawData` payload.
- `GET /api/wholesale-catalog/products/:productId`
  - Return one profile and ordered price tiers.
- `PUT /api/wholesale-catalog/products/:productId`
  - Upsert the profile/tax-basis snapshot and no more than five tiers in one transaction after ownership validation; removing the final tier also removes catalog placements.
- `PUT /api/wholesale-catalog/catalogs/:catalogId/products`
  - Reconcile a bounded, account-owned product selection and its catalog/category order.
- `POST /api/wholesale-catalog/catalogs/:catalogId/generations`
  - Validate up to 500 eligible products and setup readiness, persist an immutable queued snapshot, enforce one active account generation, and enqueue a BullMQ job with only account ID and generation ID. Assign the next catalog vN atomically only when rendering succeeds.
- `GET /api/wholesale-catalog/generations`
  - Return paginated account history.
- `GET /api/wholesale-catalog/generations/:id`
  - Return job status and safe error information.
- `POST /api/wholesale-catalog/generations/:id/approve`
  - Approve a completed preview with optional note; the requester may approve their own generation.
- `POST /api/wholesale-catalog/generations/:id/retry`
  - Create a linked attempt using the exact failed generation snapshot rather than current catalog data.
- `POST /api/wholesale-catalog/generations/:id/cancel`
  - Cooperatively cancel queued/running work, clean partial artifacts, and retain audited metadata.
- `POST /api/wholesale-catalog/generations/:id/shares/prepare`
  - Require approved, non-stale, non-archived catalog generation/outbound email, validate account-owned Woo customer and mandatory expiry no later than 90 days from share creation, snapshot customer/notices, and queue personalized artifacts without persisting plaintext password.
- `POST /api/wholesale-catalog/shares/:shareId/activate`
  - After artifacts are ready, accept generated/custom plaintext password plus editable email copy, atomically hash/activate/send while plaintext exists, and return the active URL/password result once.
- `GET /api/wholesale-catalog/catalogs/:catalogId/shares`
  - List recipient, expiry, access summary, and revocation state without returning password/token hashes.
- `POST /api/wholesale-catalog/shares/:shareId/revoke`
  - Revoke access immediately.
- `POST /api/wholesale-catalog/shares/:shareId/rotate-password`
  - Replace the password hash and invalidate existing viewer sessions.
- `PATCH /api/wholesale-catalog/shares/:shareId/expiry`
  - Change expiry within policy and invalidate viewer sessions if the new expiry is already reached.
- `POST /api/wholesale-catalog/shares/:shareId/resend`
  - Accept/generate a new plaintext password, invalidate sessions, replace the hash, and resend through the connected account identity atomically because the original password cannot be recovered.
- `GET /api/wholesale-catalog/shares/:shareId/download`
  - Staff-only customer-specific, diagonally watermarked PDF download with safe customer/catalog/date/version filename.

Use Zod schemas with strict size and item-count limits. Never accept `accountId`, `filePath`, status, or requester identity from the client.

### Public viewer endpoints

- `GET /catalog-view/:token`
  - Return only minimal catalog/share metadata and password prompt state.
- `POST /catalog-view/:token/unlock`
  - Apply rate limits, verify active/expiry/lock state and password, then issue a short-lived signed HTTP-only session cookie.
- `POST /catalog-view/:token/identify`
  - Collect self-declared viewer name/email and return privacy/confidentiality acceptance requirements.
- `POST /catalog-view/:token/accept`
  - Record this viewer's acceptance of the snapshotted confidentiality notice/version before any page is served; the separate privacy/activity notice is displayed but not conflated with contractual acceptance.
- `GET /catalog-view/:token/pages`
  - Return page count and safe viewer metadata after session verification.
- `GET /catalog-view/:token/pages/:pageNumber`
  - Return a non-cacheable or private-cache page image composited server-side with the recipient watermark.
- `GET /catalog-view/:token/thumbnails/:pageNumber`
  - Return a protected low-resolution thumbnail with the same customer/viewer watermark requirements.
- `POST /catalog-view/:token/logout`
  - Invalidate the viewer session.

Public routes must not expose account IDs, filesystem paths, Woo customer records, PDF bytes, source image URLs, terms JSON, or other API endpoints. Apply token hashing, constant-time credential checks, five-attempt/15-minute lockout, 24-hour viewer sessions, explicit logging/privacy notice, strict CSP, `X-Robots-Tag: noindex, nofollow, noarchive`, `Cache-Control: private, no-store`, frame restrictions, and separate IP/share rate limits. Every public operation, including metadata, unlock, identify, accept, pages/thumbnails, and logout, checks feature suspension/share/artifact state; while suspended it returns no catalog or customer metadata. Store truncated IPs, filter known scanners from engagement metrics, and restrict raw access/identity analytics to `share_wholesale_catalog`.

## PDF Generation Design

### Rendering pipeline

1. The API validates that generation can start, transactionally captures the complete normalized renderer snapshot, and creates a `QUEUED` record.
2. Add a `WHOLESALE_CATALOG_GENERATE` queue constant and worker registration.
3. The worker atomically claims the generation and sets it to `RENDERING`.
4. Load and schema-validate the generation's immutable renderer snapshot. Do not reload mutable catalog/product values for rendering.
5. Normalize only renderer-runtime concerns such as image buffers; business values, currency, tier ranges, ordering, branding, and terms already come from the captured snapshot.
6. Fetch images with bounded concurrency, timeout, byte limits, and content-type checks. Use a private size/TTL-bounded cache keyed by safe URL/content hash.
7. Render to a temporary file, finalize PDFKit, verify a non-empty PDF, and atomically move it into the catalog artifact directory.
8. Update stage/percentage throughout validation, image fetching, page rendering, and finalization; check cooperative cancellation between bounded units of work and enforce a 30-minute timeout.
9. On success, atomically assign the next vN and update page count, file metadata, progress, and `AWAITING_APPROVAL` status; notify the requester in-app.
10. On failure/cancellation, remove partial files, store a sanitized diagnostic, mark `FAILED`/`CANCELLED`, and notify the requester. BullMQ retries must not publish duplicate files; an explicit retry uses the exact same immutable snapshot.

### Proposed page layout

- A4 landscape with a shared header/footer and page numbering.
- Base cover page with logo, public catalog title, subtitle, generation/effective date, website, confidentiality notice, and accent treatment. Customer-specific output adds `Prepared for` company then contact.
- Compact category-name headings using flattened first Woo categories in Woo order.
- Product pages use an adaptive grid of up to eight cards:
  - Product image.
  - Current Woo product name and required parent SKU.
  - Up to three fixed-colour/fixed-shape Overseek process icons, then `+N`; hidden processes are named in a renderer-generated line adjacent to notes.
  - Restricted-format shared catalog notes.
  - Parent regular price labelled `RRP` near the heading when present, converted to catalog GST mode.
  - MOQ badge and automatic quantity-range/per-unit price table. Numeric rows show `Save $X/unit` versus RRP when available; POA rows show generic `Contact us`.
  - Every unique in-stock variant image, grouped by image, with matching options and SKUs beneath it. Variants with no image are omitted from this gallery.
- Avoid splitting one product card or its tier table across pages.
- Use fewer than eight cards where needed. A product with a large variation gallery receives as many dedicated continuation pages as necessary, with repeated product/category headings and deterministic variant ordering, rather than omitting required unique in-stock images or shrinking beyond approved minimums.
- Fit product images with `contain` on white. Missing images block eligibility; images below 800×800 warn but do not block. Target balanced print quality around 150 DPI.
- Use white pages, clean bordered cards, and brand accents. Product/terms body never drops below 8 pt; dense variation option/SKU labels may drop to 7 pt.
- Every page heading includes customer/company details in personalized output. Every product-page footer includes business name, generation date, website, page X of Y, derived GST statement, and the accessible fixed five-process icon legend; editable supplementary wording cannot replace or contradict the GST statement.
- Final page is always the terms sheet:
  - Header/logo and title.
  - Full-width highlighted payment callout.
  - Ordered terms sections laid out in balanced columns.
  - Business/legal footer, effective date, and final page number.
- Terms font size must not shrink below an agreed readable minimum. If content does not fit exactly one final page, generation is blocked with a useful validation error; it must never clip text or silently create an additional terms page.
- Terms/body and product-card body text use an 8 pt minimum. Notes warn after 250 and reject above 1,000 characters.

The exact product-page wireframe, fonts, spacing, and transcribed reference terms need approval before renderer implementation. Use basic accessibility standards: selectable/readable PDF text where possible, logical order, sufficient contrast, meaningful product image descriptions where available, and zoomable viewer pages.

### Protected page-viewer rendering spike

PDFKit does not natively rasterize completed PDF pages. Before full renderer implementation, run a technical spike to select a production-safe way to create page images from the same approved layout. Options include a bounded native PDF rasterizer or a shared drawing abstraction capable of producing both PDF and page-image output. The selected approach must:

- Produce consistent page geometry between the internal PDF artifact and customer viewer.
- Create stable selected-customer pages/PDF when a share is created, then composite the identified viewer overlay server-side per page request rather than only with removable browser CSS.
- Avoid launching an unbounded browser process per page request.
- Cache base and selected-customer page images privately; never cache one customer/viewer's overlay for another.
- Enforce maximum DPI, pixel dimensions, memory, and render time.
- Return web-optimized page images and never the underlying PDF bytes to public viewer routes.

### Image and file security

- Accept only `https:` and, if existing stores require it, `http:` product image URLs.
- Resolve and block loopback, link-local, private-network, and cloud metadata destinations to prevent SSRF.
- Limit redirects, download time, image dimensions, decoded memory, and bytes per image.
- Treat a generation-time main-image failure as a clear failed/readiness result rather than silently publishing the product; omit only missing variation thumbnails as approved.
- Build artifact paths from server-generated IDs only and verify resolved paths stay under the configured uploads directory.
- Sanitize `Content-Disposition` filenames.
- Delete failed/unapproved artifacts seven days after failure/render completion. For an approved generation never shared, delete artifacts 90 days after approval. Once shared, delete master/personalized artifacts 90 days after the latest of all share expiry/revocation timestamps; extending a share moves the cleanup anchor. Artifact cleanup updates status/paths but never cascade-deletes generation, share, viewer, acceptance, audit, or access-log rows needed for their separate retention policies.
- Keep generated PDFs and base page images outside the public static directory.
- Delete or invalidate page assets only after associated recipient links are expired/revoked according to retention policy.

## Frontend Structure

Suggested files:

- `client/src/pages/WholesaleCatalogPage.tsx`
- `client/src/pages/WholesaleCatalogEditorPage.tsx`
- `client/src/components/wholesale/WholesaleProductsPanel.tsx`
- `client/src/components/wholesale/WholesaleProductPanel.tsx`
- `client/src/components/wholesale/QuantityTierEditor.tsx`
- `client/src/components/wholesale/CatalogDesignPanel.tsx`
- `client/src/components/wholesale/TermsEditor.tsx`
- `client/src/components/wholesale/CatalogGeneratePanel.tsx`
- `client/src/components/wholesale/GenerationHistory.tsx`
- `client/src/components/wholesale/CustomerShareManager.tsx`
- `client/src/services/WholesaleCatalogService.ts`
- A deliberately isolated public recipient viewer that does not load the authenticated Overseek application shell or private account APIs.
- Shared wholesale request/response types in the existing shared/core package if both client and server need them.

Keep the route page as orchestration only. Product-tier validation and settings normalization should be shared where practical, while the server remains authoritative.

## Product Synchronization Behaviour

- Wholesale profiles and tiers are not part of WooCommerce sync payloads.
- Existing product syncs and webhooks must leave wholesale rows untouched.
- Deleting the local `WooProduct` cascades its wholesale profile, tiers, and catalog placements. Existing immutable approved generation/share snapshots remain until retention cleanup.
- If WooCommerce makes a selected product unpublished, generation is blocked until it is republished or removed. If it becomes out of stock or loses all tiers, suspend/hide remembered placements and audit the change; restore them with an in-app summary when eligibility returns unless staff manually deleted the placement.
- First-Woo-category or product-name changes update drafts automatically and mark affected approved versions stale.
- A variable product is eligible when any variant is in stock; personalized output includes only unique in-stock variant images.
- Catalog image selection uses the explicit shared wholesale image, otherwise `images[0].src`, then `mainImage`. If none is usable, the product is hidden from selection.
- Import Woo's tax-entry basis and standard tax rate into explicit account defaults. Never rely on volatile `rawData` alone for historical price interpretation.

## Approved-Version Staleness Matrix

Approved generations remain immutable. Existing shares always stay pinned and show no customer-facing stale warning. Staff see stale reasons when any displayed input changes after snapshot capture:

- Product name, required parent SKU, parent regular-price RRP, published/in-stock eligibility, selected/main image, in-stock variant image/options/SKUs, shared notes, or badges.
- Tier minimums, numeric/POA values, tier-set tax basis/version, account GST rate, account currency, or catalog include/exclude GST mode.
- Catalog product selection, first-category assignment/order, public title/subtitle/cover content, branding overrides, or footer settings.
- Approved account branding/business details when the catalog inherits them, catalog terms/callouts, or copied-default update.

The application records structured reasons and affected generation IDs when these writes/sync changes occur. Stale approved generations cannot create new shares; staff must generate and approve a current version. Existing shares are never mutated or warned.

## Validation Rules

### Product profile

- Product belongs to current account.
- Notes use only the allowlisted structured marks (bold, bullets, line breaks) and target roughly 250 characters.
- Badges are a deduplicated list containing only supported enum values.
- Image URL passes scheme and length validation; network safety is rechecked by the worker.
- Selection requires published/in-stock status, parent SKU, usable main image, and at least one numeric or POA tier.

### Price tiers

- At least one tier is required before the product appears in the builder; removing the final tier suspends/hides remembered placements until pricing returns or staff manually clears them.
- Maximum five tiers.
- Minimum quantity is an integer between 1 and a safe upper limit.
- Each row has either positive decimal unit price or POA, never zero/both/neither.
- No duplicate minimum quantities.
- Server sorts by minimum quantity regardless of submitted order.
- Numeric values stay equal/decrease with quantity; POA ends numeric pricing.
- Ranges are inferred automatically and the final tier uses `N+`.
- Store/snapshot imported Woo tax-entry basis and use editable imported account GST rate for nearest-cent display conversion.

### Terms/settings

- Required heading and payment callout.
- Maximum 12 terms sections.
- Terms are structured plain text sections; preserve line breaks but do not accept raw HTML.
- Hex colour validation plus automatic foreground contrast selection.
- URL and text-length limits on all branding fields.
- A preflight layout check proves the terms fit exactly one final page at the approved minimum font size.
- Default terms require initial owner/admin approval and are copied into catalogs. Default updates require an explicit draft update action.
- Support no more than 12 sections. Overflow highlights sections/estimated reduction. When an account AI provider is available, offer shortening suggestions only, with per-section before/after review and explicit acceptance; otherwise retain manual guidance. AI acceptance follows normal edit/approval rules and never silently changes legal copy.

### Recipient shares

- Selected customer belongs to the current account.
- Generation is approved and belongs to the selected catalog/account.
- Expiry is mandatory, in the future, and no more than 90 days away.
- Password meets minimum length/strength rules.
- URL tokens are cryptographically random, shown only in the resulting URL, and stored only as hashes.
- Revoked, expired, locked, or artifact-expired shares cannot unlock or request pages.
- Account outbound email identity must be configured.
- Each viewer supplies name/email and accepts the snapshotted confidentiality/privacy notice before pages are served.

## Auditing and Observability

- Add audit entries for product wholesale/tax-basis changes and placement removals, branding/default terms approval, catalog changes, generation request/approval/staleness/failure, customer-specific staff downloads, and share creation/email/password rotation/expiry/revocation/viewer acceptance.
- Avoid logging full terms text or signed/private image data unnecessarily.
- Include `accountId`, `generationId`, duration, product count, image failure count, page count, and final bytes in structured generation logs.
- Expose the queue in Bull Board through the existing queue factory.
- Add metrics/alerts for repeated generation failures, excessive duration, and artifact cleanup failures.

## Testing Plan

### Server unit tests

- Tier validation, sorting, inferred ranges, and decimal formatting.
- Branding/catalog normalization and default merging.
- Badge labels and exhaustive enum handling.
- Terms pagination and overflow behavior.
- Product image fallback selection.
- Safe artifact paths and filenames.
- Image URL/SSRF rejection and download limits.
- Renderer handles missing/corrupt images and long notes.
- Branding extraction allowlist, SSRF handling, normalization, and manual overrides.
- Recipient watermark composition cannot leak across cached responses.

### Route/integration tests

- Disabled feature returns `403` for every wholesale endpoint.
- Users cannot read or mutate another account's branding, catalogs, products, generations, shares, or files.
- Permission matrix for view/edit/generate/share and owner/admin/VIEWER defaults.
- Product ownership checks and transactional tier replacement.
- Catalog selection cannot reference another account's products/categories and hides ineligible products.
- Generation readiness validation.
- Duplicate/retried queue jobs remain idempotent.
- Customer-specific staff download is unavailable before approval/share rendering and after artifact expiry.
- Product deletion cascades wholesale data.
- Share token/password hashing, mandatory 90-day-max expiry, revocation, five-attempt lockout, 24-hour multi-device session invalidation, Woo customer ownership, viewer identity, and acceptance.
- Feature disable/re-enable suspension, archive behavior, customer deletion snapshot behavior, and retention cleanup.
- Public viewer never returns PDF bytes or private source metadata.

### Frontend tests

- Feature-disabled navigation and route guarding.
- Permission-based view/edit/generate/share controls.
- Quantity-tier add/remove/edit validation.
- Product readiness filters and bulk inclusion.
- Multiple catalog create/duplicate/archive, Woo category grouping, and alphabetical products.
- Terms editor and settings save errors.
- Generation polling, retry, failure, and publish/share states.
- Customer selection, link creation, one-time password display, expiry, and revocation states.
- Public password prompt, viewer identity/privacy acceptance, expired/locked states, zoomable navigation, no print/download controls, and customer/viewer watermark display.

### PDF regression checks

- Keep deterministic fixture data and inspect extracted text/page counts in automated tests.
- Create visual fixtures for eight-card pages, dedicated large-variant pages, five tiers with POA, low-resolution images, grouped variant thumbnails, and maximum terms content.
- Manually approve representative PDFs in common PDF viewers and when printed on A4 landscape.

## Delivery Phases

### Phase 1: Confirm requirements and approve wireframes

- Resolve the open decisions below.
- Obtain the exact terms wording as editable text, not only an image.
- Approve cover, product card, badge, price table, footer, and final terms-page wireframes.
- Validate the confirmed 500-product maximum, one-generation-per-account policy, and approximately 150-DPI target.
- Complete the protected page-rendering technical spike and approve its runtime dependencies.

**Gate:** No renderer implementation until sample output and content rules are approved.

### Phase 2: Feature gate, schema, and permissions

- Add `WHOLESALE_CATALOG` to the super-admin feature list.
- Add Prisma enum/models/relations and migration.
- Generate Prisma client through the normal workflow.
- Add view/edit/generate/share permissions and role-manager defaults.
- Add server-side feature and permission guard helpers.

**Gate:** Disabled accounts and unauthorized roles cannot reach any wholesale API.

### Phase 3: Product wholesale management

- Implement profile/tier endpoints, Woo tax-basis/GST import, eligibility, final-tier placement cleanup, full pricing history, and service validation.
- Add the Wholesale product tab and quantity-tier editor.
- Add audit records.
- Verify product synchronization does not overwrite local wholesale data.

**Gate:** An authorized user can safely configure and reload wholesale data for simple and variable Woo products.

### Phase 4: Catalog management and terms

- Add the catalog route/sidebar entry.
- Implement multiple catalog definitions, eligibility list, first-Woo-category grouping/order, alphabetical products, structured account default/catalog terms, and setup checklist.
- Implement safe WooCommerce-site branding import, staff review, and editable overrides.
- Add defaults and preview approximation.

**Gate:** Users can produce a complete, validated catalog configuration without generating a PDF.

### Phase 5: PDF service and generation queue

- Add renderer DTO and PDFKit service.
- Add image fetch safeguards and fallbacks.
- Add generation model, queue, worker, immutable snapshot, private master/page storage, preview/self-approval/staleness, retry, and seven-day cleanup.
- Add generation history UI and polling.

**Gate:** A representative catalog generates reliably, ends with exactly one terms page, and its private artifacts are accessible only within the correct account.

### Phase 6: Protected customer sharing

- Add Woo customer search/selection, mandatory expiry, personalized artifact rendering, customer-specific staff PDF download, and recipient-share management.
- Add hashed tokens/passwords, expiry, revocation, lockout, and viewer sessions.
- Add self-declared viewer identity, confidentiality/privacy acceptance, customer plus dynamic viewer watermark rendering, and the isolated zoomable public viewer without print/download controls.
- Add connected-account branded email, first-open/new-viewer email and in-app notifications, summary analytics, auditing, rate limits, no-index/cache/security headers, and confirmed retention cleanup.

**Gate:** An expired/revoked/wrong-password link cannot expose any page; an active link exposes only recipient-watermarked page images and never PDF bytes.

### Phase 7: Hardening and rollout

- Complete unit, integration, UI, and PDF regression tests.
- Load test maximum supported catalog size and concurrent generation.
- Validate fonts, memory, storage, cleanup, and worker restart recovery in Docker/prod-like infrastructure.
- Enable for an internal/pilot account first.
- Review generated pricing and terms with the business before enabling more accounts.

**Gate:** Pilot PDFs are approved and operational limits/monitoring are documented.

## Remaining Acceptance Decisions

The implementation uses Poppler for PDF-to-page rasterization and server-side SVG overlays for viewer watermarks. The remaining decisions are pilot acceptance items rather than architecture blockers:

1. Owner/admin approval of the transcribed reference terms and exact confidentiality, privacy, and email copy.
2. Business approval of final eight-card, process-icon legend, RRP/savings, and large-variant continuation-page geometry using representative generated PDFs.
3. Production approval of Poppler, font, memory, storage, and rendering performance after the Docker/runtime checks above.

## Definition of Done

- A super admin can enable or disable `WHOLESALE_CATALOG` per account.
- Disabled accounts cannot see or call the feature; enabled users remain subject to granular permissions.
- Authorized users can maintain notes, multiple approved badges, image selection, and shared product-level quantity pricing.
- Authorized users can create multiple catalogs with independent product selection using confirmed Woo grouping/order rules.
- Branding can be safely imported from the connected WooCommerce site, reviewed, edited, saved, and previewed with catalog terms.
- Catalog generation supports up to 500 eligible products, is asynchronous/immutable/retryable/account-scoped/idempotent, and requires preview approval before sharing.
- The PDF displays approved product content and pricing, uses robust image fallbacks, and ends with exactly one approved wholesale terms page.
- Staff can select an account-owned Woo customer and issue an approved-version, password-protected, mandatory-expiry, revocable link through configured account email.
- The customer viewer records viewer identity/acceptance and exposes customer/viewer-watermarked page images without print/download controls or a public PDF endpoint, with the documented limitation that screenshots/copying cannot be completely prevented.
- Authorized staff can download the customer-specific watermarked PDF; customer links remain pinned and immutable.
- Historical artifacts, links, and access logs are secure and retained/expired according to agreed policies.
- WooCommerce synchronization does not erase wholesale configuration.
- Automated security, scoping, validation, UI, and PDF regression tests pass.
- A pilot account's generated PDF is approved by the business before wider rollout.
