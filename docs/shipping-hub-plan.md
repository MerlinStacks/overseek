# Shipping Hub Remaining Work

This document now tracks only what is left to do for the Shipping Hub after the current implementation pass.

## Completed In Current Pass

- Added selectable rate/service UI and persisted selected service code on shipment drafts.
- Enforced service requirement before label creation (selected code or configured default).
- Added plain-language rate error surfaces with raw diagnostics visibility in UI.
- Added duplicate label/shipment safeguards and create-flow locking to prevent concurrent duplicate creates.
- Added asynchronous pending-label recovery flow with retry/backoff for label request polling and PDF download.
- Added staff recovery controls for pending label PDF states.
- Implemented live AusPost cancellation path with status guards and audit updates.
- Added WooCommerce fulfilment retry/backoff and admin retry control.
- Added configurable Woo fulfilment checkpoint behavior (`keep_in_dispatch`, `label_created`, `print_success`) and surfaced active checkpoint in UI.
- Added tracking automation allowlist controls, polling interval/backoff controls, and Operations visibility for tracking health.
- Added tracking poll audit events, centralized AusPost failure logging, and scheduler warnings for tracking issues.
- Added stored label retention cleanup scheduler and path-safety enforcement for label storage/print dispatch.
- Added secure print-agent label PDF download endpoint so agents no longer need direct filesystem access.
- Added Shipping Hub permissions to custom role management.
- Added tracking normalization tests for terminal/exception states and automation allowlist behavior.
- Updated print agent to use the secure label download API and added server-side minimum agent version enforcement with Operations visibility.

## Runtime Setup

- Apply the Prisma schema changes in the Docker/dev environment.
- Run Prisma client generation after schema changes are applied.
- Enter real AusPost Shipping and Tracking API credentials in `/shipping/settings`.
- Configure the AusPost account number, sender address, default service code, label print group, label layout, and print station.
- Test the saved AusPost credentials from Shipping Settings.
- Run a controlled sandbox/live test with one low-risk order before enabling warehouse use.

## AusPost Label Flow

- Confirm whether the merchant contract requires explicit order/manifest creation through `/orders` after shipment creation.
- If required, add order creation after shipment creation and persist the carrier order ID/summary.
- Confirm product-specific print group/layout behavior for all services used by the business.

## Rate Selection

- Extend diagnostics capture into audit-event payloads for rate warning/error traces.

## Cancellation And Refunds

- Confirm whether cancellation produces refunds or separate MyPost Business transaction records.
- Validate cancellation behavior against manifest/finalized states from real account responses.

## Transactions And Costs

- Implement MyPost Business transaction/invoice sync if the API exposes suitable records.
- Reconcile carrier transaction amounts against stored label costs.
- Wire label cost into the final COGS/profitability model, not just order metadata.
- Add discrepancy reporting for label estimate versus charged amount.

## WooCommerce Fulfilment

- Runtime-test WooCommerce completion and tracking metadata sync with the target store/plugin setup.
- Confirm exact tracking metadata keys expected by the store and any tracking plugin.
- Confirm production default for fulfilment checkpoint (`label_created` vs `print_success`) and lock rollout decision.

## Tracking And Automations

- Confirm raw AusPost tracking event codes and map them explicitly to normalized shipment states.
- Add tests for raw AusPost scan-event mappings once real event samples are available.

## Print Agent

- Sign and distribute the Windows installer/service package for the target dispatch machines.
- Runtime-test printer discovery, printer selection, secure label download, and print reporting on target hardware.
- Add operational docs/runbook for installing, rotating tokens, troubleshooting print stations, and upgrading unsupported agents.

## Security And Operations

- Add explicit external alert routing/on-call thresholds for AusPost/API failure log signals.
- Runtime-review permissions end to end for `view_shipping`, `manage_shipping_settings`, `create_shipping_labels`, `print_shipping_labels`, `cancel_shipping_labels`, and `manage_shipping_packages` with non-admin test users.

## Testing

- Add route tests for account scoping, feature gating, and shipping permissions.
- Add service tests for package selection and readiness blockers.
- Add service tests for live label flow idempotency and partial failure states.
- Add print-agent route tests.
- Add frontend tests for Shipping Hub draft editing, rate selection, bulk create/print, and Operations actions.
- Run full server typecheck/build once dependencies are available.
- Run full client build once frontend dependencies are available.

## Go-Live Pass/Fail Checklist

- PASS only if Prisma schema is applied and Prisma client is regenerated in Docker/prod-like environment.
- PASS only if AusPost credentials, account number, sender address, default service, print group, layout, and print station are configured and test successfully.
- PASS only if one low-risk order completes create label, recover/download PDF if needed, secure print-agent download, print result, Woo sync, tracking refresh, and cancellation test where allowed.
- PASS only if target WooCommerce store confirms tracking metadata keys and fulfilment checkpoint behavior.
- PASS only if real AusPost tracking samples are captured and mapped, with customer automation allowlist explicitly approved.
- PASS only if print agent is installed as a service on target hardware with printer discovery/selection validated.
- PASS only if external alerts are configured for AusPost adapter failures, tracking poll warnings, and queue/scheduler failures.
- PASS only if non-admin test users validate each shipping permission path.
- PASS only if full server/client builds and required test suites pass in a fully provisioned environment.

## Deployment Blockers

- Docker is unavailable in this worktree, so schema apply/generate and container-based integration tests still need to run elsewhere.
- Full server/client build checks are still blocked by missing dependencies/types in this worktree.
- Real AusPost API runtime behavior must be verified with configured credentials before production use.

## Recommended Execution Order

1. Runtime Setup
2. AusPost Label Flow
3. Rate Selection
4. WooCommerce Fulfilment
5. Tracking And Automations
6. Print Agent
7. Cancellation And Refunds
8. Transactions And Costs
9. Security And Operations
10. Testing

Rationale: this order reduces production risk by validating core carrier label creation first, then fulfilment/tracking correctness, then operational hardening and finance reconciliation.

## Milestone Gates

### Gate 1: Internal Label Pilot Ready

- Prisma schema applied and Prisma client generated in the real Docker/dev environment.
- AusPost credentials validated from Shipping Settings against the target account.
- Service code selection enforced (selected or default required before label creation).
- Duplicate-shipment safeguards implemented and verified.
- Partial-failure recovery states visible to staff in Shipping Hub.
- One controlled low-risk order successfully completes create label, download label, print label.

### Gate 2: Fulfilment And Tracking Reliable

- WooCommerce completion and tracking metadata sync verified against the production-equivalent plugin stack.
- Retry/backoff and admin recovery controls implemented for fulfilment sync failures.
- Raw AusPost tracking events mapped to normalized states with explicit allowlist for customer notifications.
- Terminal-state polling behavior validated for delivered, returned, cancelled, expired, exception.

### Gate 3: Production Go-Live Safe

- Print agent packaged for target OS with station health/version checks.
- Label retention cleanup and path-safety checks implemented.
- Audit coverage added for every live carrier call and retry path.
- Alerting and log monitoring configured for AusPost API failures.
- Shipping permission matrix reviewed and validated end to end.
- Server/client build and required tests pass in a fully provisioned environment.

## Open Decisions To Resolve Early

- Whether AusPost contract requires explicit `/orders` creation after shipment creation.
- Whether cancellation creates refunds or separate MyPost Business transaction records.
- Whether fulfilment checkpoint is label creation or successful print in production.
- Which print group/layout combinations are valid for each service used by operations.

## Definition Of Done (Shipping Hub)

- Labels can be created, downloaded, printed, cancelled (where allowed), and audited per account without duplicate carrier shipments.
- Fulfilment and tracking sync reliably to WooCommerce with recoverable failure flows.
- Carrier cost estimates and charged amounts are reconciled and visible for profitability.
- Operational safeguards (permissions, monitoring, cleanup, retries) are active and tested.
- Runtime verification completed with real credentials and representative order scenarios.
