# Wholesale catalog retirement

Wholesale catalogs have been removed from the application. Navigation, product pricing panels, catalog settings, role permission options, and the admin feature toggle are no longer shown. Workspace branding, emails, product editing, Woo sync, and order tracking remain independent of catalogs.

## Existing installations

- Run the normal deployment and `prisma migrate deploy`. Previously shipped migrations and the legacy Prisma models remain in place; this release does not drop catalog tables, clear feature flags/permissions, or delete catalog records.
- Restart **all** API/worker instances on the new release. Old instances must not keep processing catalog jobs during a mixed-version deployment.
- Generation, personalized share, and validity workers are no longer registered. Existing jobs in their dedicated Redis queues remain inert; no queue flush or destructive cleanup is performed. Retained jobs may resume if you roll back to an older version.
- Startup removes the legacy `wholesale-catalog-maintenance` repeatable scheduler entry. Already queued maintenance deliveries are acknowledged without reminders, rendering, or retention deletion. Other schedules are unchanged.
- `/api/wholesale-catalog` and `/api/catalog-view`, including their child endpoints, return HTTP **410 Gone** with `FEATURE_RETIRED`. No catalog records or private artifacts are read. Existing feature flags, permissions, passwords, and viewer cookies cannot reactivate them.
- Old `/wholesale-catalog/*` bookmarks and `/catalog-view/*` share links show a retirement notice, without catalog API requests. Previously shared links no longer work.
- Existing account appearance settings remain usable and no longer depend on catalog branding requests. Catalog-specific branding stays archived in the legacy tables and is not automatically copied into workspace settings.

## Retained confidential data

Keep the existing `private_uploads_data` volume and `PRIVATE_UPLOADS_DIR` private, including during upgrades and backups. No volume, artifact, or database purge is included in this removal. Automatic catalog retention cleanup has also stopped: operators must apply their own approved archival/deletion policy to retained catalog data and PDFs. Never expose private storage through a public static route. Do not remove the shared private volume; other features may use it.

Historical audit entries and relationship safeguards remain supported. Do not delete or rewrite deployed migrations to remove the retired models; any future data purge must be a separate, explicit operation with backups.
