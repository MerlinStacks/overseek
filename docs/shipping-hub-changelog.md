# Shipping Hub Changelog

This changelog tracks implementation progress for the account-gated Shipping Hub feature set.

## 2026-05-19

### Added

- Created the initial Shipping Hub implementation changelog.
- Confirmed the build starts from the documented foundation in `docs/shipping-hub-plan.md`.

### In Progress

- Database foundation for shipping configuration, packages, shipment drafts, labels, tracking, print stations, audit events, and MyPost Business transactions.
- Backend `/api/shipping` route skeleton behind `SHIPPING_HUB`.
- Frontend Shipping sidebar group and page stubs behind `SHIPPING_HUB`.

### Decisions

- Hub action creates the AusPost label and sends it to print in one workflow.
- Reprints use the locally stored label and must not create a new AusPost label.
- Bulk create/print supports partial success.
- AusPost tracking is polling-based because webhooks are not supported for this workflow.
