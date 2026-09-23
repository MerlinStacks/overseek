const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { manifest } = require('./plugin_manifest');

const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

/** Derive authority from current source, never from the supplied archive's sidecar. */
function sourceReport(projectRoot) {
    const source = path.join(projectRoot, 'overseek-wc-plugin');
    const { included, excluded } = manifest(source);
    for (const file of [
        'overseek-integration.php', 'uninstall.php', 'README.md', 'includes/class-overseek-main.php',
        'blocks/delivery-estimate/block.json', 'blocks/delivery-estimate/editor.js',
        'assets/js/delivery-estimate.js', 'assets/css/delivery-estimate.css',
        'includes/class-overseek-delivery-control.php', 'includes/class-overseek-delivery-engine.php',
        'includes/class-overseek-receipt-api.php',
    ]) if (!included.includes(file)) throw new Error(`Required runtime file missing: ${file}`);
    const header = fs.readFileSync(path.join(source, 'overseek-integration.php'), 'utf8');
    const version = header.match(/\* Version:\s+(\S+)/)?.[1];
    if (!version || !header.includes(`define('OVERSEEK_WC_VERSION', '${version}')`) ||
        !fs.readFileSync(path.join(source, 'README.md'), 'utf8').includes(`Current version: **${version}**`)) {
        throw new Error('Plugin header, constant and README versions must agree');
    }
    for (const file of included.filter(file => file.endsWith('.asset.php'))) {
        if (!fs.readFileSync(path.join(source, file), 'utf8').includes(`OVERSEEK_WC_VERSION : '${version}'`)) {
            throw new Error(`Asset version metadata must match the plugin: ${file}`);
        }
    }
    const files = Object.fromEntries([...included, 'LICENSE'].sort().map(file => [
        `overseek-wc-plugin/${file}`,
        sha256(fs.readFileSync(file === 'LICENSE' ? path.join(projectRoot, 'LICENSE') : path.join(source, file))),
    ]));
    return { version, files, excluded };
}

/** Validate the captured bytes before any destination write; safe even for self-copy. */
function publishVerified({ projectRoot, archive, expectedSha256, outputDir }) {
    if (!/^[a-fA-F0-9]{64}$/.test(expectedSha256 || '')) throw new Error('A 64-hex expected SHA-256 is required');
    const bytes = fs.readFileSync(archive);
    const digest = sha256(bytes);
    if (digest !== expectedSha256.toLowerCase()) throw new Error('Verified ZIP SHA-256 mismatch');
    const source = sourceReport(projectRoot);
    // Reject extras, duplicate names, traversal, symlinks, corrupt contents and stale source.
    // ZIP bytes are passed on stdin so validation and publication use the same snapshot.
    execFileSync(process.platform === 'win32' ? 'python' : 'python3', ['-c', `
import sys, io, json, zipfile, hashlib, stat
expected = json.loads(sys.argv[1])
z = zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()))
entries = z.infolist()
names = [e.filename for e in entries]
assert len(names) == len(set(names)), 'Duplicate ZIP entries'
allowed_dirs = {n[:i+1] for n in expected for i, c in enumerate(n) if c == '/'}
for e in entries:
    assert not stat.S_ISLNK(e.external_attr >> 16), 'ZIP symlink rejected'
    assert e.filename in (allowed_dirs if e.is_dir() else expected), 'Unexpected ZIP entry: ' + e.filename
assert {e.filename for e in entries if not e.is_dir()} == set(expected), 'ZIP runtime manifest mismatch'
assert z.testzip() is None, 'ZIP CRC failure'
for name, digest in expected.items():
    assert hashlib.sha256(z.read(name)).hexdigest() == digest, 'ZIP differs from current source: ' + name
`, JSON.stringify(source.files)], { input: bytes, stdio: ['pipe', 'pipe', 'pipe'] });
    const report = { version: source.version, bytes: bytes.length, sha256: digest, files: source.files, excluded: source.excluded };
    const reportBytes = Buffer.from(JSON.stringify(report, null, 2) + '\n');
    // Recheck source after archive validation, before publication.
    if (JSON.stringify(sourceReport(projectRoot)) !== JSON.stringify(source)) throw new Error('Runtime source changed during verification');
    fs.mkdirSync(outputDir, { recursive: true });
    const target = path.join(outputDir, 'overseek-wc-plugin.zip');
    const sidecar = path.join(outputDir, 'overseek-wc-plugin.manifest.json');
    for (const file of [target, sidecar]) {
        if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) throw new Error(`Refusing destination symlink: ${file}`);
    }
    const staging = fs.mkdtempSync(path.join(outputDir, '.verified-plugin-'));
    try {
        fs.writeFileSync(path.join(staging, 'archive.zip'), bytes);
        fs.writeFileSync(path.join(staging, 'manifest.json'), reportBytes);
        // Self-copy is a verified no-op for the ZIP; regenerate a missing/stale sidecar.
        if (!fs.existsSync(target) || !fs.readFileSync(target).equals(bytes)) {
            fs.renameSync(path.join(staging, 'archive.zip'), target);
        }
        fs.renameSync(path.join(staging, 'manifest.json'), sidecar);
        if (sha256(fs.readFileSync(target)) !== digest) throw new Error('Published ZIP digest mismatch');
    } finally {
        fs.rmSync(staging, { recursive: true, force: true });
    }
    return report;
}

module.exports = { publishVerified, sourceReport };
