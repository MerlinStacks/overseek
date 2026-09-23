const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { isRuntimeFile, manifest } = require('../plugin_manifest');
const { execFileSync } = require('child_process');
const { createHash } = require('crypto');
const { publishVerified, sourceReport } = require('../publish_verified_plugin');

test('runtime manifest excludes native helpers, secrets, tooling and nested fixtures', () => {
    for (const file of [
        'tests/delivery-native-integration.php', 'tests/native/browser-theme/functions.php',
        'includes/delivery-engine-contract.md', 'includes/tests/probe.php',
        'assets/test-fixtures/input.json', 'includes/native/db.php', 'assets/node_modules/a.js',
        'vendor/composer/autoload.php', 'scripts/db.php', '.env', 'assets/.env.json',
        'assets/secrets.json', 'includes/credentials.php', 'includes/example.test.php',
        'assets/tmp/data.json', 'assets/cache.sql', 'assets/app.js.map', 'wp-config.php',
    ]) assert.equal(isRuntimeFile(file), false, file);
    for (const file of [
        'overseek-integration.php', 'uninstall.php', 'README.md',
        'includes/class-overseek-delivery-control.php', 'assets/reviews-blocks.asset.php',
        'blocks/delivery-estimate/block.json', 'blocks/delivery-estimate/editor.js',
        'assets/css/delivery-estimate.css', 'assets/js/delivery-estimate.js',
        'templates/product-reviews.php', 'languages/overseek-wc.pot',
    ]) assert.equal(isRuntimeFile(file), true, file);
});

test('candidate contains every current runtime class, asset and block', () => {
    const source = path.resolve(__dirname, '../../../overseek-wc-plugin');
    const { included, excluded } = manifest(source);
    for (const root of ['includes', 'assets', 'blocks', 'templates', 'languages']) {
        for (const relative of fs.readdirSync(path.join(source, root), { recursive: true })) {
            const full = path.join(source, root, relative);
            if (fs.statSync(full).isFile() && !relative.endsWith('.md')) {
                assert.ok(included.includes(`${root}/${relative.split(path.sep).join('/')}`), full);
            }
        }
    }
    assert.ok(excluded.includes('tests/'));
    assert.ok(included.includes('blocks/delivery-estimate/block.json'));
    assert.ok(included.includes('includes/class-overseek-receipt-api.php'));
    assert.ok(included.includes('assets/js/delivery-estimate.js'));
});

test('manifest refuses symlinks instead of following files outside the source', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'overseek-manifest-test-'));
    try {
        fs.symlinkSync(__filename, path.join(dir, 'linked.php'));
        assert.throws(() => manifest(dir), /Refusing plugin symlink/);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

/** Build isolated real ZIPs so rejection tests exercise the archive reader, not mocks. */
function publishingFixture(t) {
    const repository = path.resolve(__dirname, '../../..');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'overseek-publish-test-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    for (const name of Object.keys(sourceReport(repository).files)) {
        const relative = name === 'overseek-wc-plugin/LICENSE' ? 'LICENSE' : name;
        fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
        fs.copyFileSync(path.join(repository, relative), path.join(root, relative));
    }
    fs.mkdirSync(path.join(root, 'overseek-wc-plugin/tests'));
    fs.writeFileSync(path.join(root, 'overseek-wc-plugin/tests/fixture.php'), '<?php // must not ship');
    const outputDir = path.join(root, 'output');
    fs.mkdirSync(outputDir);
    const target = path.join(outputDir, 'overseek-wc-plugin.zip');
    const sidecar = path.join(outputDir, 'overseek-wc-plugin.manifest.json');
    fs.writeFileSync(target, 'prior download');
    fs.writeFileSync(sidecar, 'prior manifest');
    const archive = path.join(root, 'verified.zip');
    const build = (extra = '') => {
        execFileSync('python3', ['-c', `
import sys, json, zipfile, pathlib
root, archive, extra = sys.argv[1:]
with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as z:
    for name in json.load(sys.stdin):
        source = pathlib.Path(root) / ('LICENSE' if name == 'overseek-wc-plugin/LICENSE' else name)
        z.writestr(name, source.read_bytes())
    if extra: z.writestr(extra, 'unexpected helper')
`, root, archive, extra], { input: JSON.stringify(sourceReport(root).files) });
        return createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
    };
    const unchanged = () => {
        assert.equal(fs.readFileSync(target, 'utf8'), 'prior download');
        assert.equal(fs.readFileSync(sidecar, 'utf8'), 'prior manifest');
    };
    return { projectRoot: root, outputDir, archive, target, sidecar, build, unchanged };
}

test('verified publication preserves exact bytes, version/exclusions and supports self-copy', t => {
    const f = publishingFixture(t);
    const expectedSha256 = f.build();
    const bytes = fs.readFileSync(f.archive);
    const report = publishVerified({ ...f, expectedSha256 });
    assert.deepEqual(fs.readFileSync(f.target), bytes);
    assert.deepEqual(JSON.parse(fs.readFileSync(f.sidecar)), report);
    assert.equal(report.version, '2.23.1');
    assert.deepEqual(report.excluded, ['tests/']);
    assert.deepEqual(report.files, sourceReport(f.projectRoot).files);
    fs.unlinkSync(f.sidecar);
    assert.deepEqual(publishVerified({ ...f, archive: f.target, expectedSha256 }), report);
    assert.deepEqual(fs.readFileSync(f.target), bytes);
    assert.deepEqual(JSON.parse(fs.readFileSync(f.sidecar)), report);
});

test('wrong expected hash cannot replace an existing download or manifest', t => {
    const f = publishingFixture(t);
    f.build();
    assert.throws(() => publishVerified({ ...f, expectedSha256: '0'.repeat(64) }), /SHA-256 mismatch/);
    f.unchanged();
});

test('correct archive hash still refuses stale runtime source', t => {
    const f = publishingFixture(t);
    const expectedSha256 = f.build();
    fs.appendFileSync(path.join(f.projectRoot, 'overseek-wc-plugin/includes/class-overseek-main.php'), '\n// newer runtime\n');
    assert.throws(() => publishVerified({ ...f, expectedSha256 }), /ZIP differs from current source/);
    f.unchanged();
});

test('correct archive hash cannot authorize extra developer files or directories', t => {
    const f = publishingFixture(t);
    for (const extra of ['overseek-wc-plugin/tests/helper.php', 'overseek-wc-plugin/tests/']) {
        const expectedSha256 = f.build(extra);
        assert.throws(() => publishVerified({ ...f, expectedSha256 }), /Unexpected ZIP entry/);
        f.unchanged();
    }
});
