# Delivery input storage checks

Run from the repository root:

```sh
php overseek-wc-plugin/tests/delivery-inputs.php
php overseek-wc-plugin/tests/delivery-discovery.php
php overseek-wc-plugin/tests/delivery-engine.php
```

## Integration

`POST /wp-json/overseek/v1/delivery-estimates/inputs` uses the existing Woo REST authentication routing, the discovery permission check, and a mandatory `X-Overseek-Account-Id` header matching the linked account. Discovery now reports `configurationSync: true`, while `storefront: false` remains the activation boundary.

The API accepts the v1 settings/product envelopes in `server/src/services/deliveryEstimates/sync-contract.md`. It returns exactly `schemaVersion`, `scope`, `entityId`, `revision`, `storedRevision`, `applied`, and `storefrontActivated`. An equal canonical validated payload/revision is a successful replay; lower revisions and conflicting equal revisions return 409. Object keys are sorted recursively and integer JSON number spellings are normalized before hashing; array ordering and explicit nulls are preserved.

The private `${wpdb->prefix}overseek_delivery_inputs` InnoDB table is installed with `dbDelta` only during authenticated, validated ingestion. Its binary account/scope/entity primary key isolates revision history across accounts. A transaction acquires the unique-key write lock (including first-insert races), reads the locked revision, conditionally replaces the entire payload, and commits before acknowledging. A rollback removes any provisional revision-zero row. Database failures return sanitized 503 errors; nontransactional tables fail closed.

Internal PHP readers are `OverSeek_Delivery_Input_Storage::read_settings()` and `read_product($woo_product_id)` on an instance. Each returns `['revision' => int, 'payload' => array]` or `null`, uses only the currently linked account, and issues a single keyed read. Reads never install the table. Product variation inputs exist solely inside the replaced product blob, so an omitted variation is logically cleared. These readers are not REST endpoints or storefront hooks.

## Verification boundary

The dependency-free harness covers permissions, exact acknowledgements, bounded schema validation, canonical replay, stale/conflicting revisions, replacement clearing, relinking/account isolation, product/variation relationships, database failures, and installation/read isolation. SQL stubs enforce the scoped query shapes, transaction sequence, and conditional revision predicate, and model a competing writer committing before lock acquisition. Forbidden option/meta/product writes, remote calls, and new hooks/assets are guarded.

**Stubs do not prove actual MySQL/MariaDB concurrency, row locking, deadlock behavior, or real WordPress `dbDelta` execution.** A database-backed integration check should use independent connections issuing simultaneous first inserts, identical replays, conflicting equal revisions, and out-of-order revisions against the same key; verify the highest committed revision persists, only one equal revision applies, and other accounts/entities remain independent. This harness also does not boot WordPress or exercise real Woo REST credential authentication.

Timezone validation uses PHP's installed IANA identifiers and aliases (case-insensitive, excluding the `Factory` placeholder), with no numeric offsets. As with the server's ICU validator, recently added/retired identifiers depend on the installed timezone database version.
