# UI regression audit — 23 October 2026

## Finding

The recent source-review changes mixed request/permission hardening with substantial presentation rewrites. This is not a compilation failure. Existing tests mostly check data, authorization, errors and mutations, rather than visual parity with the previous interface.

The diff from `a09f4842^` through `33b4710f` contains **207 changed non-test TSX files**. A mechanical layout-churn screen flags **70 candidates**: files previously containing at least 15 `className` attributes with fewer than half remaining. This is a triage heuristic, **not 70 verified broken screens**. Some files now delegate their rendering to another component. It does not detect all visual or behavioral regressions.

## Repaired in this pass

- `client/src/components/orders/OrderMetaSection.tsx`: restored compact product options and independently collapsible, colored custom-field/upload groups. Avoids printing long raw upload URLs inside the order table. Restored safe clickable field URLs, preserved line breaks and Unicode, and limited privacy guidance to upload groups. Kept HTTPS raster-image validation, explicit external-image loading, no-referrer requests and failure fallbacks.
- `client/src/pages/OrderDetailPage.tsx`: allows the header/actions to wrap, lets the main grid child shrink, and constrains the item table so metadata cannot expand its columns indefinitely. Horizontal table scrolling remains local on narrow screens.
- `client/src/components/orders/OrderCOGSPanel.tsx`: restored card/header treatment, compact item rows, contained long product names, profit colors and margin badges. Retained scope/permission resets, numeric validation and retry/error states.
- `client/src/components/orders/OrderTagPanel.tsx`: restored tag pills, mapping-color markers, search/dropdown presentation and visible button affordances. Retained version checks, serialized mutations and reconciliation behavior.
- `client/src/components/orders/OrderPreviewModal.tsx`: restored status badges, compact divided item rows, contained names and styled footer controls. Retained response validation and account-scoped requests.
- `client/src/components/ui/Pagination.tsx`: restored compact icon navigation, row-selector styling and responsive grouping across consumers. Kept accessible names and draft-only page entry with explicit commit.
- `client/src/components/settings/TeamSettings.tsx`: restored table hierarchy, role badges, form controls and distinct primary/secondary/destructive actions. No team API or authorization behavior changed.
- `client/src/components/analytics/VisitorProfileModal.tsx` (screenshot follow-up): restored a profile header, recorded-event/visit summary cards, details/source/customer sidebar and icon-led activity timeline. Newest visit opens by default; older visits collapse independently. Notes about coverage/attribution are in a secondary disclosure instead of dominating the modal. Preserved scoped reads, identity validation, response bounds, unknown-value handling and unverified-purchase labels; added a scoped error retry. Long IDs/URLs are contained and the two-column layout stacks on narrow screens.

## Follow-up repairs requested by the user

The listed priority surfaces have now received explicit presentation repairs (not a blanket rollback or global CSS override):

- **Shipping:** restored dispatch cards, search/no-match state, draft address/package sections, deliberate action buttons, labels/transactions tabs and tables, station cards, queue and audit panels. Grouped carrier settings into connection, services, output, tracking, sender, and advanced configuration. Restored the package/override editor's list/detail layout. Secondary scope notes are disclosures; errors and uncertain-operation warnings stay visible. Version checks, print/carrier confirmations and operation receipts remain unchanged.
- **Email settings:** restored outgoing/incoming protocol cards, host/port layout, TLS controls, relay fields, and distinct save/test/discard actions. Saved secrets remain blank replacement fields; all busy/permission guards remain intact.
- **Customer merge:** restored the retained-customer card, selectable source cards and destructive-action warning. Confirmation, source/version matching and uncertain-outcome handling are unchanged.
- **Inventory/products:** restored nine-column variant editing, stock steppers/save affordances, product-picker selected states and SKU hierarchy, BOM scope/search/table/cost/stock presentation, and sales-history rows/status badges/navigation. No stock arithmetic, BOM calculations or API payloads changed.
- **Analytics:** restored observed-spend metric cards/distribution/cohort/source panels and overview audience/cart/list hierarchy; improved AOV summary/metrics and geography drilldowns. Revenue's existing card/bar layout was inspected and retained rather than rewritten. No missing metrics or currency are invented.
- **Other listed screens:** restored policy-list selection and document actions, SEO content tabs/list/editor/score presentation, email dashboard metric/table/trend hierarchy, plugin/email/advertising onboarding cards and navigation, admin backup controls/table/preview, and hot-cache/SEO/live-cart/gold-margin widget presentation.

Shared `workspaceStyles.ts` provides explicit opt-in component classes and `DataNote` provides a secondary-context disclosure. They do not select or restyle arbitrary global buttons, inputs or tables. Existing screen handlers, validation, permissions, confirmations and disabled states remain in place.

These named areas are repaired in code; real-browser narrow/light/dark comparisons are still required. The original 70-candidate heuristic is not an exhaustive certification of the other changed components.

## Verification and limits

- Initial and post-repair production client builds passed (TypeScript plus Vite).
- Initial full client lint finished with **0 errors / 294 warnings**; warnings are a separate existing cleanup backlog, not proof of visual correctness.
- Post-repair order/metadata/tag/pagination, team-settings safeguards and inventory-consumer tests: **8 files / 66 passed**, including five new presentation/interaction regression cases.
- Targeted lint on the edited order, team-settings and pagination components/tests passed without warnings. `git diff --check` passed.
- Visitor screenshot follow-up: **10 tests passed** across visitor-profile and live-analytics-page suites; client TypeScript and targeted visitor lint passed. Added tests for newest-first/default-open visits, chronology, notes disclosure, safe links, zero/unknown values, legacy events, scoped retry and mismatched visitor rejection. Browser visual sign-off remains blocked as described below.
- Wider restoration: **27 tests passed** for shipping/email/merge safeguards, then **152 tests across 22 files passed** for presentation, product/BOM, analytics, policies, email dashboard, SEO, onboarding and admin-backup coverage. Seven new presentation tests cover disclosures, email protocol grouping/secret/busy behavior, retained-vs-source merge cards, variant columns/stock controls, BOM disabled controls and passive dispatch filtering. After final class/layout refinements, **44 tests across six files passed** for analytics, product controls, BOM and presentation. A further settings-layout test verifies all groups/advanced fields and unsaved-draft action locks; its final focused run passed **9 tests across two files**. These focused totals overlap and must not be summed.
- Wider restoration TypeScript and production build passed. Lint on changed client files reported no errors and seven existing `OrderDetailPage` hook warnings.
- TypeScript-AST call comparison against `HEAD`: network/read/confirmation calls are unchanged in all **39 edited non-test TSX components** (`fetch`, `shippingFetch`, `useScopedRequest`, `useShippingRead`, `window.confirm`). This is a scoped invariant check, not a replacement for runtime testing.
- First wider full-suite run: 273 files / 1,569 tests passed, with three failures. Two cache-widget tests exposed text fragmented by the new metric markup; the count and “cached” label are now together. An SMS test passed alone but failed under full-suite load because its account mock returned a new object every render, endlessly retriggering email-account reads; the mock now preserves identity like AccountContext. Composer production behavior was not changed. All **31 tests across four affected suites then passed**. The user cancelled the fresh full-client-suite rerun; its `Shell.NotFoundError` notice reflects that cancellation, not an independent test failure. No clean post-fix full-suite result is claimed, and the cancelled run was not restarted.
- Full client suite: **274 files / 1,563 tests passed** with two workers. This run started before the final presentation edits/new tests; the subsequent targeted run covers those edits. The initial unrestricted run stalled without results and was stopped, not counted as a pass.
- Browser verification is blocked locally: OpenChamber has no drivable browser client, and the installed Chromium cannot launch because `libglib-2.0.so.0` is missing. No screenshot or narrow/light/dark visual sign-off is claimed.
- Local Vite startup also reports an obsolete `react-email-editor` prebundle entry and unresolved optional `@capacitor/haptics` during dependency scanning. These are additional development-environment findings; neither was changed in this presentation repair, and the production build passes.
- No deployment, migration, live order mutation, email send, carrier operation or printing was performed.

This is a broad diff/automated audit and repair of the listed surfaces, **not an all-screens visual clearance**. Browser validation and review of any additional legacy surfaces are still required.
