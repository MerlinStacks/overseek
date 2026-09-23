# Delivery client validation — 2026-09-22

## Final freeze handoff — superseding result

Final parent verification: **72 files / 469 tests passed**, zero failures, using
`npx vitest run --maxWorkers=2` (94.60 seconds); `npx tsc --noEmit` also passed.
This includes feature-off frozen-cutover recovery, refusal to prepare against a
known incompatible/missing plugin, SQL prerequisite checks and private preparation
with Pi still active. The calendar keyboard-focus test now explicitly mocks and
advances animation frames, rather than relying on a fixed 20ms timer delay.

Production `npm run build` passed against the source TypeScript Vite config after
removing generated `vite.config.js`/`.d.ts` artifacts (4,319 modules, 2.19-second
Vite bundling; existing large-chunk warnings only). No source-config error was masked.
This supersedes the prior 451-test handoff and the earlier 432-test run below.
See `plan.md` and `delivery-release-runbook.md` for the controlled rollout boundary.

## Earlier validation result (retained history)

- Full client suite after corrections: **70 files, 432 tests passed**, no failures or skips (85.94 seconds).
- Shared `@overseek/core` CommonJS and ESM builds passed.
- Client production `npm run build` passed, including its `tsc` application typecheck.
- Explicit source-config build also passed: `npm run build -- --config vite.config.ts` (4,316 modules; Vite bundling 2.03 seconds).
- Runtime: Node 22.23.1; Vitest 4.1.10; Vite 8.1.5. Every test run used `--maxWorkers=2`.

## Commands

Each command used `PATH=/tmp/opencode/node-v22.23.1-linux-x64/bin:$PATH`.

From repository root:

```bash
npm run build --workspace=@overseek/core
```

From `client/`:

```bash
npm run test:run -- --maxWorkers=2
npm run build
npm run build -- --config vite.config.ts
```

The application tsconfig excludes test files; passing Vitest proves their execution, not a separate strict typecheck of test sources. No build/config errors were suppressed. Generated untracked `client/vite.config.js` and `.d.ts` were present during the earlier validation; the parent later removed those artifacts and verified the normal production build directly against the source config.

Build logs retained at:

- `/tmp/opencode/delivery-client-final-build-20260922.log`
- `/tmp/opencode/delivery-client-source-config-build-20260922.log`

## Integrated behavior covered

The full run includes launch setup, settings, holiday calendar, shipping transit/WBS grid, guarded and legacy recovery, product production, email delivery previews, account feature gating and role management.

- Added three missing/incomplete readiness cases: activation and cutover stay disabled; no fabricated active state or force/drain action; authorized disable remains available.
- Added pending activation coverage: no activation request or force/drain control while worker work is pending.
- Existing role-manager test passes: a delegated `manage_roles` user can save a custom role granting `manage_inventory` and `view_shipping` with account-scoped authorization.
- Existing recovery tests cover exact observation identity/count, expiration, immutable UUID/request retry across lost ACK/remount, stale observations, permission/account cancellation, and pending/unknown-state rejection. Accepted recovery stays queued rather than applied/drained.
- Calendar tests cover date selection, scoped closures, duplicate-date updates, deletion, keyboard/month boundaries and inherited read-only permissions.
- WBS grid tests cover explicit provider policy and exact mapping identity for the product default.

Reviewed UI semantics against `docs/delivery-launch-api.md` and the current server response implementation. Corrected launch text to call readiness `active` the **verified** storefront state, rather than the last control acknowledgement. Corrected certification guidance: existing desired activation is revalidated after fresh proofs; disabled accounts remain inactive. The product endpoint's local `storefrontActivated` is the last control acknowledgement, so its notice now explicitly identifies that and directs operators to launch readiness rather than asserting current storefront availability. Two added product tests cover both acknowledged states.

## Bundle evidence

Final explicit source-config build: `assets/2026-09-22T070419421Z/`. Sizes are Vite-reported decimal kB, minified / gzip:

| Asset | kB | gzip kB |
| --- | ---: | ---: |
| DeliveryEstimatesSettingsPage | 67.36 | 18.84 |
| ProductEditPage | 160.65 | 38.49 |
| EmailDesignEditorV2 | 130.31 | 32.19 |
| SettingsPage | 240.54 | 51.03 |
| Main index JS | 567.36 | 164.90 |
| ECharts | 555.34 | 189.07 |
| Main index CSS | 317.55 | 38.72 |

Vite reports the existing >500 kB chunk warning for main index/ECharts; it is not suppressed. npm reports the workspace `.npmrc` is ignored. No dependencies were installed or added, and package manifests/lockfile/build configuration have no diff from this work. Sizes describe the integrated workspace, not an isolated delivery-feature dependency delta.

Build outputs under client/shared-core `dist` are untracked/ignored; no tracked generated output was changed. This pass changed only the two delivery UI components, their tests, and this validation document. Backend/plugin, shared-core exports/parser and unrelated chat/user changes were preserved. No commit or deployment occurred.

These results establish client test/compile/bundle readiness. They do not establish live merchant Woo/WBS compatibility or execute the live activation/recovery transport.
