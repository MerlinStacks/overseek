# Last 15 commits: regression audit

Reviewed range: `HEAD~15..5f8ae84c`, from `1558242b` through `5f8ae84c` inclusive. Approximately 1,500 changed files. This is a risk-focused source and local-test review, not a certification of every changed behavior or live integrations.

Follow-up: [regression fixes and startup recovery](regression-fixes-and-startup-recovery-2026-10-23.md) records subsequent implementation and rollout limits. The findings and test results below describe the original audit snapshot.

No application fixes were applied. The pre-existing `.gitignore` modification was preserved. Four temporary, mocked regression probes reproduced the findings below; the temporary test file was removed after execution. Probe output is retained locally at `/home/agent/regression-audit-reproductions.log`.

## Findings

### 1. High: one failed tracking read permanently blocks later polls

- Introduced in `2176f794`.
- `server/src/services/shipping/TrackingAdmission.ts:12-18,30` creates a pending per-label gate before the read, but leaves that gate pending after every exception, including a connection failure before any events have been imported.
- `server/src/services/shipping/ShippingTrackingService.ts:145-176` schedules a failure backoff, but every subsequent poll fails at the existing gate before reaching the carrier. A new operation ID or waiting out the backoff does not help. No tracking-gate reconciliation endpoint is implemented.
- Reproduction: call `admittedTracking` with a read that throws `GET connection refused`; call it again for the same label with a new occurrence and a successful read. The second call throws `Previous tracking import requires reconciliation`; its read is never executed.
- Fix direction: distinguish read-only/pre-import failure from partially committed import or uncertain automation. Permit safe bounded retries for the former; provide an audited reconciliation path for the latter. Do not blindly clear genuinely uncertain gates.

### 2. High: an opaque carrier event code hides an explicit delivery status

- Introduced in `5e651ac8`.
- `server/src/services/shipping/ShippingTrackingService.ts:257-280` normalizes only `eventCode || status || description` against exact text values.
- `server/src/services/shipping/AusPostShippingTrackingAdapter.ts:780-788` supplies provider codes/IDs separately from readable statuses. Thus `{ eventCode: 'SCAN-123', status: 'Delivered', description: 'Delivered' }` becomes `unknown`, not `delivered`.
- This prevents delivered/other milestone automation and terminal-state detection whenever an unrecognized nonempty code accompanies a recognized status.
- Fix direction: use verified provider-code mappings, then consider exact recognized status/description values when the code is unknown. Preserve rejection of negated or contradictory prose rather than restoring broad substring matching.

### 3. High: shipment event refactor breaks shipment email merge tags

- Introduced in `5e651ac8`.
- `server/src/services/shipping/ShippingTrackingService.ts:247` now stores raw order fields plus flat `shipmentStatus`, `scanEventDescription`, and `scanEventOccurredAt` inside the event envelope's `shipment` property.
- `server/src/config/events.ts:49-54` unwraps that property before passing it to automation. The former nested shipment context is no longer present.
- `server/src/services/MergeTagResolver.ts:256-266` still expects `shipment.status`, `latestScanDescription`, `latestScanLocation`, and `latestScanTime`, or those names on its fallback context. The flattened payload instead retains the raw order's `status` (for example, `processing`).
- Reproduction: resolving `{{shipment.status}}|{{shipment.latestScanDescription}}` against the dispatched delivered payload yields `processing|`, not `delivered|Delivered`. Scan time/location also lose their former mapping.
- Fix direction: restore the existing automation-context contract, including its nested shipment data, without bypassing outbox admission or chronological checks.

### 4. Medium: AI settings offer models the chat service refuses to use

- Restriction introduced in `5e651ac8`.
- `server/src/services/ai.ts:16-18` returns the provider's full model list; `client/src/components/settings/AISettings.tsx:97-107,125-135` lets users select and save those models.
- `server/src/services/ai.ts:35` silently returns `unavailable` unless the saved model is one of three fixed IDs in `server/src/config/limits.ts:34-38`. This disables previously supported tool-capable Google and newer OpenAI/Anthropic choices before any provider request occurs.
- Reproduction with mocked provider responses: `getModels()` offers `google/gemini-2.5-flash`; selecting that ID then calling `generateResponse()` returns `unavailable` without attempting generation.
- Fix direction: keep model availability/capability policy consistent between discovery, selection, saving, and execution. If the three-model policy is intentional, filter the picker and explicitly explain existing incompatible account settings.

## Verification

- Existing server suite: **414 files passed, 14 skipped; 3,802 tests passed, 132 skipped**.
- Four additional temporary regression probes: **four failed on the expected behavior**, reproducing the findings above. They are not part of the existing-suite totals.
- Shared core build: passed.
- Client and server application TypeScript checks: passed.
- Operational-script TypeScript check: passed.
- Production client build: passed.
- Prisma schema validation: passed.
- Plugin package/download checks: **15 passed**.
- Full client suite: **274 files passed, two failed; 1,578 tests passed, two timed out**. Both failing files (`ChatWindow.test.tsx`, `ReviewsPage.test.tsx`) passed when rerun with one worker (**9 tests**), so those initial failures are not classified as confirmed application regressions. A completely clean full-client run is not claimed.

## Limits and release considerations

- No live database migration, carrier call, OAuth flow, advertising upload, customer email, deployment, or stock/printing operation was performed.
- Native PHP execution was unavailable in this environment; package integrity tests do not substitute for WordPress runtime testing.
- The deleted ambient declarations and deleted legacy audience page did not produce unresolved-import or production-build errors in these checks.
- Several earlier workflows were explicitly disabled or restricted by the reviewed changes. Those intentional safeguards are not automatically bugs and should not be blanket-reverted. Existing rollout notes still require coordinated migrations and deployment of client/API/workers.
