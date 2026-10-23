# Inventory, experiments and analytics safeguards

This source review did not run seed scripts or mutate live experiment, order or inventory data. No new database migration is required for this batch.

## BOM validation and forecasting

New BOM edits require exactly one supplier, Woo product or internal-product reference. Component variations require their Woo parent. IDs fit PostgreSQL Int; quantity is positive, at most 999999.9999, with four decimal places. Waste is a fractional ratio from 0 through 1: 0.10 means 10%, not 10. Existing rows are not automatically rewritten; incompatible legacy values now produce a validation/planning error and require operator review.

Forecast history uses complete UTC days ending at today's midnight, not partial today or future orders. Searches are scoped by account and revenue statuses, nested aggregations are filtered to requested identifiers, terms truncation/shard failures/timeouts fail explicitly, and requests are batched to bound bucket counts. A complete empty search means no observed indexed demand; a failed search no longer produces a zero-demand forecast. Local/search sync completeness remains an operational prerequisite.

BOM mappings are tenant-filtered in SQL and resolve component variants authoritatively. Inactive, ambiguous, foreign or missing components fail rather than disappear. Default-parent demand excludes variants with specific BOM overrides. This implementation explicitly does **not** claim multi-level bundle planning: nested or cyclic component ancestry returns an unsupported-planning error instead of an incomplete one-level estimate. A separate multi-level planning implementation is needed for those accounts.

## Experiment observation contracts

New experiments validate unique named variants (2–10), bounded text and a 100-experiment/account limit. The first configured variant is the predefined control. Valid transitions are draft → running → completed; completed observations cannot be reused by restarting the experiment. Starting/completing records explicit observation timestamps. Legacy experiments without a known start window are retained but cannot produce results; create a new experiment rather than inventing a start date or silently resetting history.

Account-row transactions serialize experiment edits and exposure assignment. Writes update only the experiment JSON namespace within appearance settings. A visitor is assigned once and cannot be reassigned to another variant. Historical cross-variant contamination is excluded and counted explicitly.

Results use only the known window and purchases after exposure, deduplicate stable order IDs and use authoritative account-bound local revenue orders instead of raw tracking totals. Missing local orders, ambiguous identity, missing purchase IDs, mixed currencies or coverage limits fail explicitly. Exposure and purchase queries are each bounded at 50,000; at most 10,000 distinct purchase IDs are reconciled per result. Analytics-event retention and store synchronization must cover the observation window; local results are not proof of complete lifetime/customer tracking.

Statistical output compares each treatment against the configured control with a two-sided normal approximation and Bonferroni correction. Each arm requires at least ten successes and ten failures for that approximation. Running results are exploratory and do not produce a significant verdict. There is no sequential-peeking/stopping correction. `confidenceLevel` and `mde` are null: 1−p is not winner probability and no power/MDE target was specified. `sampleSizeSufficient` is null when power sufficiency is unknown, or false when even approximation requirements fail; use `normalApproximationValid` for that narrower check. API consumers must handle null fields and inspect per-comparison adjusted p-values rather than assuming one selected best-versus-worst test.

## Help seeding

`seedHelpContent.ts` is import-safe and covered by `server/tsconfig.operational.json`. Use `--help` without opening clients. Otherwise supply an explicit PostgreSQL DATABASE_URL and `--all` for global help content. Dry-run is the default and reports creates/updates/preserved records without writes. `--apply` additionally requires `--confirm=seed-help-content:ALL:DB_HOST/DB_NAME`, matching the credential-free configured database destination.

Existing content is preserved unless `--overwrite` is supplied. New articles are drafts unless `--publish` is supplied; publishing does not bypass preservation of existing articles. Seed input is validated and bounded to 50 collections/1,000 total articles, duplicates are rejected, and applied changes use one transaction. Failed source loading is an error, not an empty successful seed. The repository's actual `getHelpCollections` export is loaded from compiled static content in a restricted VM; no client source or generated bundle is changed. Database connections are disconnected in finally, and failures use a nonzero exit code rather than forced process exit.

## Analytics views

Revenue, AOV and CRO requests are keyed to authentication/account/range, cancelled on scope changes, bounded by request timeouts and validated before display. Missing authentication, malformed responses and request failures have explicit states/retries. CRO sections and AOV comparison/trend recover independently. Supporting AOV/CRO route calls now request strict service errors so backend failures cannot masquerade as empty/zero metrics.

AOV uses an order-weighted average of daily values (subject to the server's daily rounding), renders a single observation, keeps gaps for days without orders and does not invent percentage growth from a zero baseline. Currency comes from validated selected-account configuration rather than hardcoded dollars; missing/unsupported codes are labelled unavailable. These changes do not imply currency conversion or establish that historical orders share the configured currency. Charts and source bars validate finite values and bound display widths. All six existing day presets, including yesterday (-1), remain supported.
