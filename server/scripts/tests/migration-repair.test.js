const { test } = require('node:test');
const assert = require('node:assert/strict');
const { splitSql } = require('../migration-repair/sql');
const { loadMigrations } = require('../repair_migration_history');
const { backfill } = require('../migration-repair/plan');

test('SQL lexer preserves dollar bodies, nested parentheses and quoted semicolons', () => {
    const sql = `-- ; ignore
    CREATE FUNCTION x() RETURNS text LANGUAGE sql AS $tag$SELECT 'a;b';$tag$;
    /* outer /* inner ; */ end */ SELECT 'it''s;a', "a;b", fn(1, 2);`;
    assert.deepEqual(splitSql(sql), [
        "CREATE FUNCTION x() RETURNS text LANGUAGE sql AS $tag$SELECT 'a;b';$tag$",
        `SELECT 'it''s;a', "a;b", fn(1, 2)`,
    ]);
    assert.deepEqual(splitSql('ADD COLUMN a numeric(10,2), ADD COLUMN b text', ','), ['ADD COLUMN a numeric(10,2)', 'ADD COLUMN b text']);
    assert.throws(() => splitSql('SELECT $$bad'), /Unbalanced/);
});
test('repair specification pins all sixty original files and the current schema', () => {
    const migrations = loadMigrations();
    assert.equal(migrations.length, 60);
    for (const migration of migrations) assert.ok(splitSql(migration.sql).length, migration.name);
});
test('recovery backfills preserve existing contact classification and sync state', () => {
    assert.match(backfill('UPDATE "EmailUnsubscribe"\nSET "contactStatus" = NULL'), /WHERE "contactStatus" IS NULL$/);
    assert.match(backfill('INSERT INTO "DeliverySyncAccount" SELECT 1'), /ON CONFLICT \("accountId"\) DO NOTHING$/);
});
