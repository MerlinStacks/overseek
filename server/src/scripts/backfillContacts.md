# Historical contact materialization

Run explicitly in the server environment with the intended `DATABASE_URL` and Elasticsearch configuration. No schema change is required by this backfill. It does not call WooCommerce, emit automation events, enroll anyone, or change consent/suppression records.

From `server/`:

```sh
npm run contacts:backfill -- --account ACCOUNT_ID --source orders --batch-size 100 --max-batches 100
npm run contacts:backfill -- --account ACCOUNT_ID --source enrollments --batch-size 100 --max-batches 100
```

Process orders first so enrollments can reuse known Woo identities. Each command processes at most 10,000 source rows with these settings. If `done` is false, resume that source with `--after CURSOR`, using the last successfully printed JSON page's `cursor`. Repeat until `done: true`. A failure leaves the current page uncommitted; resume from the previous successful cursor. Re-running from the beginning is safe. UUID keysets are not insertion-ordered: a final pass from the beginning covers historical imports inserted behind an earlier cursor; live writes use the same helper.

The npm command compiles the standalone script using the existing esbuild dependency, avoiding ts-node's incompatibility with TypeScript 7. Build with dev dependencies installed; the resulting `dist/scripts/backfillContacts.cjs` can also be invoked directly with Node in an environment containing the server's runtime dependencies. Use `npm run contacts:backfill -- --help` to check invocation without modifying data.

Each page uses the account's order-totals advisory transaction lock, repairs totals from local orders, and commits durable projection intent with the contact changes. Other accounts can proceed concurrently. Lower the batch size if a page exceeds the 60-second transaction timeout. **Elasticsearch and Redis do not need to be available for backfill or enrollment persistence.** A successful source cursor means DB persistence and projection intent committed, not that ES has caught up.

## Durable search projection

The existing `SyncState` table holds coalesced pending keys under the reserved entity type `contact-projection:<wooId>`. Its existing account/entity uniqueness constraint bounds intent to one row per pending ES key; `cursor` is an opaque generation token. These records are excluded from Woo sync status screens and deleted only after successful projection. No schema migration is needed.

Live writes, backfills, promotions, total changes, and customer reconciliation record intent **inside their DB transaction**. Promotion queues both the old negative key and the new positive key; deletion queues its old key. Rollback rolls back the intent too, without any ES side effect.

The existing BullMQ scheduler runs `contact-projection-recovery` every 10 seconds, up to 250 pending keys per run. It operates independently of Woo sync schedules/circuit breakers. Pending work survives process restarts or Redis job loss; starting the scheduler re-registers the periodic job. Redis is only the wake-up mechanism: the recoverable work is in PostgreSQL.

The projector reads committed DB state, then performs ES writes **outside DB transactions**. A PostgreSQL session advisory lock serializes projectors across processes. Each key is rechecked against the current contact, so a reused negative ID is indexed rather than blindly deleted. A generation-CAS acknowledgement retains newer mutations committed during an ES request; a second committed-state check also retains intervening legacy profile edits. Failed ES items remain pending, while successful items are acknowledged. Failed keys rotate behind other pending keys to avoid starvation. An ES success followed by a process/acknowledgement failure is safely replayed.

Contacts are immediately available from DB-backed Contacts views. Header search catches up after the scheduled projection plus normal ES refresh (longer during outages/backlogs). Enrollment persistence never waits on ES, and projection recovery never replays an email trigger or creates an enrollment.

For a bounded manual drain, including deployments where the scheduler is not running:

```sh
npm run contacts:backfill -- --account ACCOUNT_ID --source projections --batch-size 100 --max-batches 100
```

This projects up to 10,000 pending keys and refreshes the customers index. Failures keep unacknowledged keys for the next run. `projected: 0` means no work was claimed (empty account backlog or another projector currently holds the lock); it is not a durable completion checkpoint. Repeat as necessary. Do not clear pending `contact-projection:*` SyncState records manually during an outage.

Guest orders without email receive an order-keyed negative-ID contact (empty email, available billing name). There is no reliable basis for joining two anonymous orders. Invalid historical enrollments without an email or positive Woo ID similarly receive an enrollment-keyed contact. Existing distinct positive Woo IDs sharing an email remain distinct. This command does not destructively merge pre-existing duplicate contacts or their relationships.

Normal order sync's existing totals recovery also queues canonical contact projection. It does not scan all historic enrollments: run both backfill sources once for existing accounts. Historical materialization remains an explicit command; normal runtime recovery only processes committed pending projection keys.

## Integration checks

The regression tests can run against an explicitly supplied disposable PostgreSQL database:

```sh
CONTACT_MATERIALIZATION_TEST_DATABASE_URL=postgresql://... \
ORDER_TOTALS_TEST_DATABASE_URL=postgresql://... \
npm test -- src/services/__tests__/ContactMaterialization.sql.test.ts src/services/sync/__tests__/orderCustomerTotals.sql.test.ts
```

Contact tests create/drop a randomly named isolated schema; totals tests use connection-local temporary tables. ES responses are mocked to exercise success and partial-failure behavior.
