# Documentation

## Setup and operations

- [Project overview and local development](../README.md)
- [Deployment](../DEPLOYMENT.md)
- [Contributing](../CONTRIBUTING.md)
- [Changelog](../CHANGELOG.md)
- [Migration-history repair](migration-history-repair.md)
- [Emergency startup rollback](startup-rollback.md)
- [WooCommerce companion plugin](../overseek-wc-plugin/README.md)
- [Shipping print agent](../print-agent/README.md)

## Feature guides and contracts

### Delivery and shipping

- [Delivery release runbook](delivery/delivery-release-runbook.md)
- [Launch completion contract](delivery/delivery-launch-contract.md)
- [Launch control and receipt API](delivery/delivery-launch-api.md)
- [Input diagnostics and targeted recovery API](delivery/delivery-input-diagnostics-api.md)
- [Freshness and calendars](delivery/delivery-freshness-launch.md)
- [Shipping-option contract](delivery/delivery-shipping-options.md)
- [Presentation compatibility](delivery/delivery-estimates-compatibility.md)
- [Variant supplier-lead contract](delivery/delivery-variant-supplier-leads.md)
- [Shipping hub remaining work and runtime setup](shipping-hub-plan.md)
- [Shipping hub changelog](shipping-hub-changelog.md)

### Email marketing

- [Email marketing workspace](email/email-marketing-workspace.md) — editing, publication, product-tag conditions, footer media, delivery safeguards and scheduling.
- [Email designer and delivery validation](email/email-designer-delivery.md) — rendering, assets, library migration and mailbox sign-off.

### Advertising, feeds and commerce

- [Advertising audiences](marketing/advertising-audiences.md)
- [Website retargeting and Meta lookalikes](marketing/native-ad-audiences.md)
- [Google server-side purchases](marketing/google-server-purchases.md)
- [Meta conversion diagnostics](marketing/meta-conversion-diagnostics.md)
- [Meta creative analysis](marketing/meta-creative-analysis.md)
- [Google and Meta feed quality](marketing/product-feed-quality.md)
- [Native WooCommerce COGS export](native-woocommerce-cogs.md)

## Plans and design references

Plans record their own implementation and rollout status; they are not proof that a
feature is enabled in a deployed environment.

- [Delivery estimates replacement plan](../plan.md) — includes the frozen 2.23.0 rollout record and superseded design history.
- [Wholesale catalog generator plan and rollout checklist](wholesale-catalog-generator-plan.md)
- [Reviews roadmap](overseek-reviews-roadmap.md)
- [Standalone design mockups](design/README.md)

## Release records and validation evidence

These are point-in-time records. Check the installed version and the relevant
runbook before using an older result as a rollout prerequisite. Local or mocked
validation does not certify production deployment.

- Companion releases: [2.23.1](releases/companion-2.23.1-release.md), [2.25.6](releases/companion-2.25.6-release.md), [2.25.7](releases/companion-2.25.7-release.md), [2.25.8](releases/companion-2.25.8-release.md), [2.25.9](releases/companion-2.25.9-release.md), [2.25.10](releases/companion-2.25.10-release.md).
  Customer-facing release notes remain linked from their release records.
- [Installed 2.23.1 ZIP validation](delivery/delivery-2.23.1-installed-zip-validation.md)
- [Client validation, 22 September 2026](delivery/delivery-client-validation-2026-09-22.md)
- [Native PostgreSQL validation, 22 September 2026](delivery/delivery-native-validation-2026-09-22.md)
- [Native validation with all 13 delivery migrations](delivery/delivery-native-validation-13-migrations.md)
- [Native variant validation, 23 September 2026](delivery/delivery-variant-native-validation-2026-09-23.md)
- [Companion native integration evidence](../overseek-wc-plugin/tests/delivery-native-integration.md)
- [Source-review records and follow-ups](reviews/README.md)

## Keeping the repository tidy

Use the existing topic folders rather than adding another top-level change note:

- `delivery/`: delivery contracts, runbooks and native-validation evidence.
- `email/`: the workspace guide and detailed designer delivery record.
- `marketing/`: advertising integrations, audiences and feed quality.
- `releases/`: version-specific companion release records and publishing notes.
- `reviews/`: source-review assessments and follow-ups.
- `design/`: standalone visual experiments.
- `screenshots/`: images used by the project README.

Fold small feature notes into their owning guide when they share an audience and
rollout requirements. Keep detailed API contracts and version-specific evidence
separate so historical results do not become current operational instructions.

The two short top-level companion-release/runbook compatibility pages preserve
references in already packaged plugin READMEs. Their full content lives in the
topic folders; do not duplicate it in the compatibility pages.

Keep operational guides, API contracts, release evidence, screenshots used by the
project README, and original source assets in version control. Source-review
records belong in `reviews/`; standalone UI experiments belong in `design/`.

Generated previews belong in the ignored root `output/` directory. Lint reports,
logs, and local Prisma schema backups are disposable diagnostics, not source files.
Regenerate lint findings with `npm run lint -w client` or `npm run lint -w server`
rather than relying on checked-in reports.

Do not treat plugin download ZIPs, their manifests, migrations, runtime assets,
user uploads, dependency directories, or shared-core compiled output as disposable
just because they are generated. They may be required by packaging or a running
application.
