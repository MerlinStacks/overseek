// Small PostgreSQL lexer, not a SQL rewriter. Dollar bodies and quoted strings
// must remain intact when inspecting the repository's pinned migration SQL.
function splitSql(sql, separator = ';') {
    const parts = [];
    let text = '', quote = null, dollar = null, depth = 0, block = 0;
    for (let i = 0; i < sql.length; i++) {
        const c = sql[i], next = sql[i + 1];
        if (block) {
            if (c === '/' && next === '*') { block++; i++; }
            else if (c === '*' && next === '/') { block--; i++; }
            continue;
        }
        if (dollar) {
            if (sql.startsWith(dollar, i)) { text += dollar; i += dollar.length - 1; dollar = null; }
            else text += c;
            continue;
        }
        if (quote) {
            text += c;
            if (c === quote) {
                if (next === quote) { text += next; i++; }
                else quote = null;
            }
            continue;
        }
        if (c === '-' && next === '-') { while (i < sql.length && sql[i] !== '\n') i++; text += '\n'; continue; }
        if (c === '/' && next === '*') { block++; i++; text += ' '; continue; }
        if (c === "'" || c === '"') { quote = c; text += c; continue; }
        const tag = c === '$' && sql.slice(i).match(/^\$(?:[a-zA-Z_][a-zA-Z_0-9]*)?\$/);
        if (tag) { dollar = tag[0]; text += dollar; i += dollar.length - 1; continue; }
        if (c === '(') depth++;
        if (c === ')') depth--;
        if (c === separator && depth === 0) { if (text.trim()) parts.push(text.trim()); text = ''; }
        else text += c;
    }
    if (quote || dollar || block || depth) throw new Error('Unbalanced migration SQL');
    if (text.trim()) parts.push(text.trim());
    return parts;
}
const ident = value => '"' + value.replaceAll('"', '""') + '"';
module.exports = { splitSql, ident };
