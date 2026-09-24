const { splitSql, ident } = require('./sql');

// These migrations contain data transitions that db push cannot perform. Keep
// the migration SQL as the source, with explicit recovery-only preservation of
// values that the running application has already set since January.
function backfill(sql) {
    if (sql.startsWith('INSERT INTO "DeliverySyncAccount"')) return sql + ' ON CONFLICT ("accountId") DO NOTHING';
    if (sql.startsWith('UPDATE "WooProduct"')) {
        return sql.replace('"status" = NULLIF("rawData"->>\'status\', \'\')',
            '"status" = COALESCE("status", NULLIF("rawData"->>\'status\', \'\'))')
            .replace('"catalogVisibility" = COALESCE(', '"catalogVisibility" = COALESCE("catalogVisibility", ')
            .replace('"dateCreated" = COALESCE(', '"dateCreated" = COALESCE("dateCreated", ');
    }
    if (sql.startsWith('UPDATE "EmailUnsubscribe"\nSET')) return sql + ' WHERE "contactStatus" IS NULL';
    if (sql.startsWith('UPDATE "ReceiptOperation"')) return sql + ' AND "cascadeState" = \'done\'';
    return sql;
}

/** Materialise the final, custom SQL specification in an empty reference schema.
 * Current Prisma DDL supplies the final columns/FKs, while original migration
 * SQL supplies the CHECKs, partial indexes, functions and trigger bindings.
 * Historical CHECKs are superseded here, never temporarily imposed on live rows.
 */
async function buildCustomReference(db, migrations) {
    const data = [];
    for (const migration of migrations) {
        for (const sql of splitSql(migration.sql)) {
            if (/^(UPDATE|INSERT INTO|WITH)\b/.test(sql)) {
                data.push({ migration: migration.name, sql: backfill(sql) });
            } else if (/^CREATE TABLE\b/.test(sql)) {
                const table = sql.match(/^CREATE TABLE (?:IF NOT EXISTS )?"([^"]+)"/)[1];
                // Let PostgreSQL name/deparse even unnamed inline CHECKs. The
                // savepoint also restores every FK dropped with this EMPTY table.
                await db.query('SAVEPOINT inspect_table');
                await db.query(`DROP TABLE ${ident(table)} CASCADE`);
                await db.query(sql);
                const checks = (await db.query(`SELECT conname,pg_get_constraintdef(oid) AS definition
                    FROM pg_constraint WHERE conrelid=$1::regclass AND contype='c' ORDER BY conname`, [ident(table)])).rows;
                await db.query('ROLLBACK TO SAVEPOINT inspect_table');
                await db.query('RELEASE SAVEPOINT inspect_table');
                for (const check of checks) await db.query(`ALTER TABLE ${ident(table)} ADD CONSTRAINT ${ident(check.conname)} ${check.definition}`);
            } else if (/^CREATE (?:UNIQUE )?INDEX\b/.test(sql)) {
                await db.query(sql.replace(/^(CREATE (?:UNIQUE )?INDEX) (?!IF NOT EXISTS)/, '$1 IF NOT EXISTS '));
            } else if (/^CREATE (?:OR REPLACE )?FUNCTION\b|^CREATE TRIGGER\b|^COMMENT ON FUNCTION\b/.test(sql)) {
                await db.query(sql);
            } else if (/^ALTER TABLE\b/.test(sql)) {
                const match = sql.match(/^ALTER TABLE ("[^"]+")\s+([\s\S]+)$/);
                if (!match) throw new Error(`Unsupported ALTER in ${migration.name}`);
                for (const action of splitSql(match[2], ',')) {
                    if (/^ADD CONSTRAINT/.test(action) && /\bCHECK\s*\(/.test(action)) {
                        await db.query(`ALTER TABLE ${match[1]} ${action}`);
                    } else if (/^DROP CONSTRAINT/.test(action)) {
                        // FKs are independently verified against the current
                        // schema. Only the obsolete delivery CHECKs are removed.
                        if (!action.includes('_fkey')) await db.query(`ALTER TABLE ${match[1]} ${action}`);
                    } else if (!/^(ADD COLUMN|ALTER COLUMN|ADD CONSTRAINT [\s\S]*?\sFOREIGN KEY)\b/.test(action)) {
                        throw new Error(`Unsupported ALTER action in ${migration.name}`);
                    }
                }
            } else if (/^DO \$\$/.test(sql)) {
                if (migration.name === '20260922170000_receipt_cascade') await db.query(sql);
                else if (!sql.includes('FOREIGN KEY')) throw new Error(`Unreviewed DO in ${migration.name}`);
            } else if (!/^CREATE TYPE .* AS ENUM|^ALTER TYPE .* ADD VALUE/.test(sql)) {
                throw new Error(`Unreviewed SQL in ${migration.name}: ${sql.slice(0, 60)}`);
            }
        }
    }
    return data;
}
module.exports = { buildCustomReference, backfill };
