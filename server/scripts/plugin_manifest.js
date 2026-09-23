const fs = require('fs');
const path = require('path');

const roots = new Set(['includes', 'assets', 'blocks', 'templates', 'languages']);
const topFiles = new Set(['overseek-integration.php', 'uninstall.php', 'README.md']);
const forbidden = /^(?:tests?|__tests__|test[-_]?fixtures?|fixtures?|stubs|native|docs?|scripts?|commands?|node_modules|vendor|secrets?|credentials?|temp|tmp|coverage)$/i;
const extensions = new Set(['.php', '.js', '.css', '.json', '.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.woff', '.woff2', '.ttf', '.eot', '.mo', '.po', '.pot']);

/** Only runtime roots and asset formats ship; developer tooling is never copied. */
function isRuntimeFile(relative) {
    const parts = relative.split('/');
    if (parts.some(part => part.startsWith('.') || forbidden.test(part))) return false;
    if (topFiles.has(relative)) return true;
    if (!roots.has(parts[0]) || parts.length < 2) return false;
    if (/(?:^|[._-])(?:tests?|spec|fixtures?|secrets?|credentials|backup|native-db)(?:[._-]|$)/i.test(parts.at(-1))) return false;
    return extensions.has(path.extname(relative).toLowerCase());
}

/** Enumerate disk, not git: uncommitted runtime additions belong in a candidate. */
function manifest(source) {
    const included = [], excluded = [];
    function walk(dir, prefix = '') {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const relative = prefix + entry.name;
            if (entry.isSymbolicLink()) throw new Error(`Refusing plugin symlink: ${relative}`);
            if (entry.isDirectory()) {
                if (entry.name.startsWith('.') || forbidden.test(entry.name)) excluded.push(relative + '/');
                else walk(path.join(dir, entry.name), relative + '/');
            } else (isRuntimeFile(relative) ? included : excluded).push(relative);
        }
    }
    walk(source);
    return { included: included.sort(), excluded: excluded.sort() };
}

module.exports = { isRuntimeFile, manifest };
