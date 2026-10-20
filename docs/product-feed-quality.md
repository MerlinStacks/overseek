# Google and Meta feed quality

These changes affect exported feeds only, not WooCommerce products, stock or prices. Feed URLs, signatures, product/variation IDs and variation selection modes remain unchanged. No deployment or advertising-account changes are included.

## Pricing

Woo sync stores the full Woo payload in `rawData` and the active price in `price`. For Google and Meta, the default price mapping now uses regular price **only when** a genuine active sale is confirmed: a lower sale price, valid/current sale window, Woo not explicitly reporting `on_sale: false`, and a matching active price (or explicit `on_sale: true` if active price is missing). Otherwise it uses the available active price and omits automatic sale fields. Empty/invalid prices do not become zero; a genuine zero is preserved.

Woo GMT timestamps take precedence. Local-only timestamps use the account timezone, including DST. Invalid calendar dates/nonexistent DST times do not activate a sale. Open-ended sales do not get invented endpoints. Variations use their own prices and sale dates, not a parent's sale. Manual price/date overrides and saved custom mappings remain authoritative; validation reports inconsistencies instead of rewriting them. In particular, an old saved custom sale-price mapping with a price fallback is preserved and may need correction in Settings.

## Identifiers and attributes

The Google/Meta defaults read Woo `global_unique_id`, GTIN/EAN/UPC fields and supported metadata; MPN comes only from explicit manufacturer-part-number fields/metadata. SKU is no longer automatically advertised as an MPN, merchant account name is no longer fabricated as the manufacturer brand, and variants no longer borrow parent barcodes/MPNs.

Google `identifier_exists` is `yes` when identifiers are present, or the explicit configured value. Missing identifiers alone remain unknown, not automatically `no`. Confirm genuinely identifier-free goods by editing `identifier_exists` to `no` in the Google spreadsheet/product feed editor. MPN is now editable as well. Existing explicit overrides are preserved and conflicts flagged. Invalid GTINs remain visible with format/check-digit errors; the health scan also warns about repeated GTINs.

Both channels include real colour, size, material and pattern values when available. A selected variation attribute takes precedence. Parent attributes are used only when they identify a single option, never an arbitrary choice from multiple options. Meta variations now include stable `item_group_id` grouping; simple products do not need a group.

## Automatic variant alignment

**Automatic (recommended)** is now the default for new/unconfigured feed views, signed export URLs without a mode, row/reference endpoints and health scans. Existing saved UI/manual modes and explicit URL `variationMode` parameters continue to work. To switch an existing saved manual view, select Automatic in Feeds Settings and use its generated feed URL.

On Google and Meta, Automatic exports a simple product once and exports individual variations instead of an additional variable-parent offer. Detection uses Woo type, Woo variation IDs and actual synced parent/variation relations. Stable `parentId-variationId` item IDs and shared parent group IDs are unchanged; standalone products have no synthetic group ID. Disabled/non-published variation records are excluded with a visible reason in health; stock exclusions and the opt-in backorder override retain their existing behaviour. Pinterest/other channels retain all-variations behaviour when Automatic is selected.

Selected global attributes containing only Woo IDs are resolved against their actual parent attribute definitions. Colour/color, size, material, pattern, age group and gender map to standard fields; Google also exposes size type/system. Known enum values are normalized to each platform's casing/values. There is no semantic guessing for unrecognized values or custom variation dimensions. A variant keeps its own price, sale, barcode, selected options and image, with safe shared parent descriptive fallbacks. Additional images exclude the main variant image and duplicates; Google is limited to ten additional images.

Native Woo variant permalinks are preserved. If only a parent URL exists, the fallback adds the stable variation ID and known custom-attribute values/actual taxonomy term slugs. Taxonomy slugs are never guessed from display names. Health warns when attribute preselection cannot be established, a group ID conflicts with its detected parent, sibling dimensions are missing, unsupported dimensions need platform eligibility review, or an Any-option variation is ambiguous. Missing variant records are reported as a sync error/exclusion, not replaced with a fabricated purchasable parent. No combinations, stock values or prices are synthesized. Existing explicit mappings and field overrides remain authoritative.

## Availability

Google uses `in_stock`, `out_of_stock`, `backorder`, `preorder`. Meta default stock mapping uses `in stock`, `out of stock`, `available for order` for backorders, or `preorder`. Backorder eligibility/ad delivery must still be checked in Commerce Manager. Saved explicit values are not silently converted; validation identifies invalid channel-specific overrides.

The existing default-off **Show backorderable products as in stock on Google and Meta** setting remains account-scoped, feed-only, and supports Woo `yes` and `notify` permissions, including parent-managed variations. It does not invent stock quantities. A visible warning and per-row diagnostics explain the risk of disagreeing with the website, structured data or fulfilment promises. No live pages are fetched or claimed to have been verified.

Google's `availability_date` mapping reads an explicit `availability_date`, `_availability_date` or `availabilityDate` field/metadata. Local dates are normalized with the account timezone. The field can also be overridden per product or variation in the spreadsheet/product feed editor. No supplier arrival date or arbitrary rolling date is invented. Google backorder/preorder requires a valid future expected shipping date, no more than a year away, and agreement with the landing page. Automatic availability dates are omitted for other statuses, including when the backorder override reports in stock.

## Read-only health checks

In **Feeds → Settings**, select Google or Meta and the desired variation mode, then **Check feed health**. This on-demand scan shows included/excluded **rows**, first-applicable exclusion reasons, error/warning totals, up to 100 contextual issues and 50 exclusion examples. Counts apply to that mode across the account catalogue, not the current spreadsheet search. Unselected parents/variations are outside the selected mode, not counted as exclusions. Invalid products are not silently dropped or modified.

Checks cover required fields independently of custom mapping flags, availability enums, conditions, prices/discounts, syntactic HTTP(S) URLs, character limits, identifier consistency/GTIN check digits, sale ranges, expected shipping dates and duplicate barcodes. URL syntax validation is not a reachability or image-content check. Spreadsheet rows also expose field-specific issues.

Authenticated `GET /api/feeds/:channel/health?variationMode=...` uses the existing feed feature and account authorization. Redis health results are scoped by account/channel/mode and cached for 60 seconds. Concurrent scans in one API process are coalesced. Product reads use 250-product cursor batches with deterministic timestamp/ID ordering; paginated views retain only requested rows. Exports still build their final response in memory; this is not a streaming-export implementation or a transactional catalogue snapshot.

Last successful product sync comes from the account's product SyncState, not a product edit timestamp. Export history starts with this release and uses Redis retention of 30 days: last valid-token generation attempt, success and failure, separated by account/channel/mode. Recording is best effort and never blocks a valid feed. Unauthorized token attempts do not create export history. **Locally generated does not mean delivered, fetched or accepted by Google/Meta.** Platform diagnostics remain in Merchant Center/Commerce Manager.

## Verification and rollout

Run the focused feed data, validation, mapping, health and route tests plus client health-panel/product-feed-write tests. Server type-check currently requires `--module esnext` to work around the repository's existing commonjs/bundler configuration mismatch. Known unrelated client type errors are in `ProductStockMovements.tsx` (`replaceAll` library target) and `services/api.ts` (`retryHeaders`).

No Prisma migration is required. On rollout, review a real Google XML and Meta CSV, then inspect Merchant Center/Commerce Manager diagnostics and storefront availability/delivery promises. Check manufacturer brand/identifiers, saved custom sale mappings and products with missing prices/dates; don't infer platform acceptance from the local health report.

References: [Google availability](https://support.google.com/merchants/answer/6324448), [Google availability date](https://support.google.com/merchants/answer/6324470), [Meta catalogue specifications](https://www.facebook.com/business/help/120325381656392).
