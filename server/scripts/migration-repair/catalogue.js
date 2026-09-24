const { ident } = require('./sql');

async function catalogue(db, schema) {
    await db.query(`SET LOCAL search_path = ${ident(schema)}, pg_catalog`);
    const queries = {
        columns: `SELECT c.relname AS table_name, a.attname AS name, format_type(a.atttypid,a.atttypmod) AS type,
            a.attnotnull AS not_null, pg_get_expr(d.adbin,d.adrelid) AS default_value
            FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
            LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
            WHERE n.nspname=$1 AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped AND c.relname <> '_prisma_migrations'
            ORDER BY c.relname,a.attname`,
        enums: `SELECT t.typname AS name, array_agg(e.enumlabel ORDER BY e.enumsortorder) AS values
            FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace JOIN pg_enum e ON e.enumtypid=t.oid
            WHERE n.nspname=$1 GROUP BY t.typname ORDER BY t.typname`,
        constraints: `SELECT r.relname AS table_name,c.conname AS name,c.contype AS type,
            c.convalidated AS validated,pg_get_constraintdef(c.oid) AS definition
            FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace
            WHERE n.nspname=$1 AND r.relname <> '_prisma_migrations' ORDER BY r.relname,c.conname`,
        indexes: `SELECT t.relname AS table_name,c.relname AS name,pg_get_indexdef(i.indexrelid) AS definition,
            i.indisvalid AS valid,i.indisready AS ready
            FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_class t ON t.oid=i.indrelid
            JOIN pg_namespace n ON n.oid=t.relnamespace
            WHERE n.nspname=$1 AND t.relname <> '_prisma_migrations' ORDER BY t.relname,c.relname`,
        functions: `SELECT p.proname AS name,pg_get_function_identity_arguments(p.oid) AS arguments,
            pg_get_functiondef(p.oid) AS definition,obj_description(p.oid,'pg_proc') AS comment
            FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
            WHERE n.nspname=$1 AND (p.proname LIKE 'delivery_%' OR p.proname LIKE 'protect_receipt_%') ORDER BY p.proname,arguments`,
        triggers: `SELECT c.relname AS table_name,t.tgname AS name,t.tgenabled AS enabled,pg_get_triggerdef(t.oid) AS definition
            FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
            WHERE n.nspname=$1 AND NOT t.tgisinternal ORDER BY c.relname,t.tgname`,
    };
    const result = {};
    for (const [key, sql] of Object.entries(queries)) {
        const rows = (await db.query(sql, [schema])).rows;
        // pg_get_* qualifies table/function names, but enum types visible in the
        // current search path are unqualified. No application values are read.
        result[key] = JSON.parse(JSON.stringify(rows).replaceAll(`${schema}.`, '__schema__.'));
    }
    return result;
}
function key(row) { return `${row.table_name || ''}/${row.name}/${row.arguments || ''}`; }
function differences(expected, actual, allowExtras = false) {
    const found = new Map(actual.map(row => [key(row), JSON.stringify(row)]));
    const errors = [];
    for (const row of expected) {
        if (found.get(key(row)) !== JSON.stringify(row)) errors.push(key(row));
        found.delete(key(row));
    }
    if (!allowExtras) errors.push(...found.keys());
    return errors;
}
module.exports = { catalogue, differences, key };
