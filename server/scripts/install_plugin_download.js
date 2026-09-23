const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

// Release pins bind both the tested ZIP and its source-verified manifest. Update
// together only after verified publication of a new release; no ZIP parser needed.
const RELEASE = Object.freeze({
    version: '2.23.1',
    zip: '365bc2369e44352a721dffd3b36d00d53888bf030ecb8222e00a456dd0622781',
    manifest: '60ab038ffbcc7aae478616a3abc6fd877866006c791d14bf5e1dde6ab6dc03b3',
});
const ZIP = 'overseek-wc-plugin.zip';
const MANIFEST = 'overseek-wc-plugin.manifest.json';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const stat = file => {
    try { return fs.lstatSync(file); } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw error;
    }
};

/** Reject symlink ancestors as well as leaf links, including dangling links. */
function directory(dir, create = false) {
    const resolved = path.resolve(dir);
    const parent = path.dirname(resolved);
    if (parent !== resolved) directory(parent, create);
    const info = stat(resolved);
    if (!info) {
        if (create) fs.mkdirSync(resolved);
        return;
    }
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`Unsafe download directory: ${resolved}`);
}

function regularFile(file) {
    const info = stat(file);
    if (info && (!info.isFile() || info.isSymbolicLink())) throw new Error(`Unsafe download file: ${file}`);
    return info;
}

/** Validate fully before touching the volume; replace each file by atomic rename. */
function installPluginDownload({ packageDir = '/opt/overseek/plugin-download',
    uploadsDir = process.env.UPLOADS_DIR?.trim() || path.resolve(__dirname, '../uploads'),
    required = process.env.OVERSEEK_REQUIRE_PLUGIN_DOWNLOAD === '1' || process.env.NODE_ENV === 'production',
} = {}) {
    directory(packageDir);
    const sourceZip = path.join(packageDir, ZIP);
    const sourceManifest = path.join(packageDir, MANIFEST);
    const zipInfo = regularFile(sourceZip), manifestInfo = regularFile(sourceManifest);
    if (!zipInfo && !manifestInfo && !required) return { skipped: true, reason: 'No image package; local download left unchanged' };
    if (!zipInfo || !manifestInfo) throw new Error('Required plugin download package is missing or incomplete');
    const zip = fs.readFileSync(sourceZip), manifestBytes = fs.readFileSync(sourceManifest);
    if (hash(zip) !== RELEASE.zip) throw new Error('Packaged plugin ZIP SHA-256 mismatch');
    if (hash(manifestBytes) !== RELEASE.manifest) throw new Error('Packaged plugin manifest SHA-256 mismatch');
    const manifest = JSON.parse(manifestBytes);
    if (manifest.version !== RELEASE.version || manifest.sha256 !== RELEASE.zip || manifest.bytes !== zip.length) {
        throw new Error('Packaged plugin version/manifest mismatch');
    }
    const destination = path.resolve(uploadsDir, 'plugins');
    directory(destination); // Check existing ancestors before creating anything.
    const entries = [[ZIP, zip], [MANIFEST, manifestBytes]];
    const changed = entries.filter(([name, bytes]) => {
        const file = path.join(destination, name);
        return !regularFile(file) || !fs.readFileSync(file).equals(bytes);
    });
    if (!changed.length) return { version: RELEASE.version, sha256: RELEASE.zip, updated: [] };
    directory(destination, true);
    const staging = fs.mkdtempSync(path.join(destination, '.plugin-download-'));
    try {
        for (const [name, bytes] of changed) fs.writeFileSync(path.join(staging, name), bytes, { flag: 'wx', mode: 0o644 });
        // Recheck destination links immediately before replacing only the two names.
        directory(destination);
        for (const [name] of entries) regularFile(path.join(destination, name));
        for (const [name] of changed) fs.renameSync(path.join(staging, name), path.join(destination, name));
    } finally {
        fs.rmSync(staging, { recursive: true, force: true });
    }
    return { version: RELEASE.version, sha256: RELEASE.zip, updated: changed.map(([name]) => name) };
}

if (require.main === module) {
    try {
        console.log('[Startup] Plugin download:', JSON.stringify(installPluginDownload()));
    } catch (error) {
        console.error('[Startup] Plugin download validation/install failed:', error.message);
        process.exitCode = 1;
    }
}
module.exports = { installPluginDownload, RELEASE };
