# Legacy usage verification

## Scope and limits

Verified the legacy items raised in this session against the current checkout.
Used repository-wide tracked-text searches (including non-TypeScript files),
targeted reads of callers/routes/tests, and TypeScript language-service symbol
references over 1,959 source files, including tests and scripts. The symbol scan
excluded dependency resolution and standard libraries to stay within memory;
this was reference analysis, not a full-project typecheck or runtime coverage test.

No application code was changed or deleted. This is a targeted verification,
not a claim that every unused export in the application has been discovered.
No production database, request logs, installed plugins or Redis were inspected.
External consumers, reflection and persisted formats cannot be ruled out solely
by a source search.

## No current repository callers found

- `client/src/hooks/useSeoKeywords.ts:164` — `useKeywordTrends`.
  Symbol references and exact-name searches found only its declaration. It is an
  alias of `useKeywordMovers`, not a separate implementation. Candidate for removal
  from this private frontend after build/test verification.
- `server/src/services/search-console/KeywordRecommendationService.ts:235` —
  `getTrendingKeywords`. Only its declaration was found. Current routes call
  `getKeywordMovers` at `server/src/routes/searchConsole.ts:148`; no dynamic lookup
  of the old method was found. Candidate for internal API cleanup.
- `server/src/utils/auth.ts:37` — `needsRehash`. Only its declaration was found.
  **This does not make bcrypt support unused.** Login and password-change routes
  still call `comparePassword`, which verifies historical bcrypt hashes. The
  comment suggesting use after login is not implemented automatic rehashing:
  `server/src/routes/auth.ts:340` verifies the password, and the successful-login
  path creates a session without calling this helper. Decide separately whether
  to wire a carefully guarded migration or remove the unused helper/comment.
- `server/src/services/deliveryEstimates/service.ts:8` — the exported
  `deliveryStatus` constant. No references to this symbol were found. A similarly
  named property in `server/src/routes/deliveryEstimates.test.ts:29` is a mock,
  not a read of the real export. Message-delivery status fields elsewhere are
  unrelated and must not be removed. Candidate for obsolete export cleanup.

These findings mean **unused by the inspected repository**, not proven unused by
every independently modified install or external integration. Nothing was removed
as part of verification.

## Compatibility props with no production callers found

`client/src/components/ui/Card.tsx` declares and strips `glass` and `noHover`.
Tracked-source searches found no explicit production uses of those props. However,
`client/src/components/ui/Card.test.tsx:14` intentionally passes `glass` and asserts
that legacy props do not reach the DOM. The fields are a tested compatibility
contract, not completely unreferenced code. Do not simply remove destructuring and
allow old props passed through spreads to leak onto the DOM.

## Still in active use — not deletion candidates

- **Tracking facade:** `server/src/services/TrackingService.ts:42` is imported by
  `server/src/routes/trackingIngestion.ts:7` and
  `server/src/routes/trackingDashboard.ts:7`. Both routes call its methods, and
  security tests exercise those boundaries. Migrate callers before removing it.
- **Grid library legacy API:** imported by `client/src/pages/DashboardPage.tsx:1`,
  `client/src/pages/DesignerCanvas.tsx:1`, and
  `client/src/components/invoicing/InvoiceRenderer.tsx:14`. Removing or changing the
  import path is a UI/library migration, not dead-code deletion.
- **bcrypt password compatibility:** `comparePassword` is called from
  `server/src/routes/auth.ts:340`, `:565` and `:571`. Whether a particular install
  still has bcrypt users requires data verification without exposing hashes.
- **Plaintext credential compatibility:** `decrypt` remains on email SMTP/IMAP and
  relay-key read paths (`server/src/services/EmailService.ts:213`, `:648`, `:837`;
  `server/src/routes/email/accounts.ts:84`, `:275`). CAPI configuration readers
  also delegate to it. Existing encrypted/plaintext data must be migrated and
  verified before removing the legacy branch.
- **Inventory recovery/old job identities:**
  `server/src/services/sync.ts:44` still checks the historical BOM job ID;
  `server/src/routes/inventory/bomSync.ts:28` supports both identities. Delivery
  routes import legacy recovery, and the frontend exposes recovery actions. Old
  persisted jobs can remain even if new code no longer creates them.
- **Legacy backup object API:** still used by the direct JSON download route in
  `server/src/routes/admin/backup.ts`. Streaming stored exports did not retire the
  older interface. Backup readers also depend on existing persisted formats.

## Cannot certify unused from source alone

The no-op `/tracking.js` handler is still registered in
`server/src/routes/trackingIngestion.ts:183`, under both `/api/tracking` and `/api/t`
through `server/src/config/routes.ts:145` and `:161`. No current in-repository code
was found generating a request to it; the helper mention at
`client/src/components/settings/TrackingScriptHelper.tsx:132` is only a stale
comment. Previously copied merchant snippets, cached pages or older installed
plugins may still request these URLs. Keep the no-op until production access logs
and the supported plugin/install versions establish a safe retirement window.

## Safe cleanup order

Start with the four uncalled internal exports. Verify affected builds/tests after
removal; treat the unwired password-upgrade helper as a separate design decision.
Migrate active tracking callers separately. Preserve public endpoints and
password/credential/backup/inventory compatibility until usage/data checks and an
explicit migration or retirement policy justify removal. Deprecated does not mean
unreachable, and code age alone is not evidence of a defect.
