# Email marketing workspace

## Deployment

Apply pending migrations in order, including `20261022060000_marketing_workspace`, then deploy the client, API and sending workers together. Generate the Prisma client during the server build. This work does not apply migrations, enable flows, queue broadcasts or send test messages automatically.

Existing executable flow definitions and activation states are preserved. No historical publication dates, A/B assignments or delivery outcomes are invented.

## Editing and publication

- Node configuration is local until **Apply to draft**. Cancel does not send a compensating write to the parent flow.
- Flow edits autosave only to `draftDefinition`. Saves and publication use `draftRevision` compare-and-swap, scoped to the current account. A conflicting editor receives 409 and keeps its local changes rather than overwriting someone else.
- **Review & publish draft** validates the graph, confirms the live impact, and atomically replaces the executable definition and trigger configuration. Publication does not enable a disabled flow.
- Publication of an enabled flow affects subsequent steps of existing enrollments too. This is not enrollment-version pinning.
- New flows start disabled with an unpublished draft. Enable requires a published definition and no pending draft. The legacy automation upsert endpoint no longer updates existing flows; use the draft/status APIs.
- Broadcast content can only be edited on an unsent DRAFT. Unschedule before editing a scheduled broadcast. Already-attempted broadcasts retain their content and recipient idempotency keys.

## Preview and readiness

The email step shows a desktop/mobile iframe preview alongside its content controls, resolved subject and preview text, missing-value diagnostics, and an explicit test-send form. Select one of the 30 most recent account orders to use its billing customer, or use sample data with an explicit null order ID. Cart/coupon examples remain samples, not live cart predictions.

Readiness distinguishes required fields from suggestions and lets operators jump to the relevant field/editor. Broadcast review also checks the configured sending account and displays audience exclusions. The server rejects missing content, empty placeholders, and broadcasts lacking an unsubscribe/preferences link before queueing or scheduling. These checks do not establish DNS authentication, inbox placement, legal compliance, or recipient consent.

Explicit operator test sends are logged as TEST and do not count as audience deliveries or consume the contact marketing-pressure cap. Tests send only when the operator submits a recipient address.

## Audience and delivery safeguards

Audience review shows matched rows, eligible unique addresses and exclusion counts. It scans at most 10,000 rows and labels incomplete coverage; its counts are not a promise about the final send. List membership and account suppressions are read again at the delivery boundary, including queued/retried broadcasts.

Missing/invalid addresses, duplicates, opted-out list members, account suppressions, and explicit bounced/complaint/soft-bounced classifications are excluded. Explicit UNVERIFIED contacts are excluded unless a subscribed list membership supplies that subscription. Legacy records without a classification retain the existing policy; absence of a classification is not proof of consent and should be audited before marketing use.

The shared per-contact cap uses `MARKETING_PRESSURE_MAX_SENDS` (default 3) and `MARKETING_PRESSURE_WINDOW_HOURS` (default 24). A database advisory lock serializes the final reservation across workers. It counts known marketing reservations conservatively, including ambiguous/in-flight sends; transactional mail and TEST are excluded. A capped recipient is marked skipped without stalling the campaign's other recipients. Legacy logs lacking stored category evidence are not reclassified. Existing account/day/second send-capacity limits remain separate.

## Logs, simulation and history

Message Logs now uses one database-ordered email/SMS timeline with common search, status/source filters, channel selection and pagination. Email actions and stored-content previews remain available. Source links open the originating flow or broadcast review. Existing SMS URLs redirect to the SMS channel.

**Test Path → Run dry-run** evaluates current graph conditions with the production condition evaluator and sample data or a selected existing customer's data. It never invokes NodeExecutor, queues, transport or coupon generation. Trigger enrollment eligibility, future customer changes, quiet hours, caps and action side effects are explicitly outside this simulation.

**Flow → Insights → Trace a customer** searches actual execution history by email. It shows the 10 newest enrollments and first 100 events each, with truncation labels and recorded outcomes/metadata. It does not manufacture reasons absent from historical records.

## Scheduling and experiments

Broadcast review accepts a wall-clock date/time plus an explicit IANA timezone. The server converts it to UTC and rejects invalid, ambiguous or nonexistent daylight-saving times rather than guessing. Scheduling is one chosen campaign timezone, not inferred recipient-local-time delivery. Scheduled broadcasts can be cancelled while still scheduled; transport already underway cannot be recalled.

An optional Subject B enables deterministic, approximately 50/50 assignment by campaign and normalized recipient email. Assignment and canonical payload stay pinned across retries. Experiment settings can change only on an unsent DRAFT. Both variants share the same body; B can be tested explicitly. Reports show accepted sends and unique recorded opens/clicks per variant, with privacy-proxy/bot caveats. This release does not claim statistical significance or select/roll out an automatic winner.

Email Hub's expandable **Delivery health & frequency caps** panel reports the rolling 30-day flow/broadcast log-status distribution (including transactional flow emails), current sender, suppression-record count and deployment cap. It is not an inbox-placement or DNS-authentication report.

## Verification and rollout checks

Run the focused client/server marketing workspace, draft, audience, preview, condition simulation, log-route, scheduling and email lifecycle tests, plus both TypeScript checks and Prisma validation.

Before production rollout, verify real PostgreSQL UNION pagination and advisory-lock concurrency, draft-conflict behaviour across two browsers, campaign suppression changes between review and delivery, queued retry stability, DST scheduling, and email/mobile layouts. Browser visual verification in this environment was blocked by missing Chromium system libraries. No production migration, activation, scheduling or transport validation has been performed here.

The original focused verification run passed 50 client and 141 server tests. The designer follow-up passed 153 client and 151 server focused tests, and a full server run passed 3,622 tests (131 skipped). Both application typechecks passed at an intermediate checkpoint; latest checks are blocked by concurrent Lexical-toolbar and invoice-route changes, not the earlier route-helper mismatch. See [designer delivery validation](email-designer-delivery.md) for exact verification limits, the shared renderer, immutable assets, library migration, offline MIME pack and outstanding real-mailbox sign-off.
