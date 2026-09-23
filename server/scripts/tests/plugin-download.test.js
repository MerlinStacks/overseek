const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { installPluginDownload, RELEASE } = require('../install_plugin_download');
const root = path.resolve(__dirname, '../../..');
const names = ['overseek-wc-plugin.zip', 'overseek-wc-plugin.manifest.json'];

function fixture(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'overseek-download-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const packageDir = path.join(dir, 'image');
    const uploadsDir = path.join(dir, 'uploads');
    const plugins = path.join(uploadsDir, 'plugins');
    fs.mkdirSync(packageDir);
    fs.mkdirSync(plugins, { recursive: true });
    for (const name of names) fs.copyFileSync(path.join(root, 'server/uploads/plugins', name), path.join(packageDir, name));
    fs.writeFileSync(path.join(uploadsDir, 'customer.png'), 'customer upload');
    fs.writeFileSync(path.join(plugins, 'other-plugin.zip'), 'unrelated download');
    const run = options => installPluginDownload({ packageDir, uploadsDir, required: true, ...options });
    const unchangedCustomers = () => {
        assert.equal(fs.readFileSync(path.join(uploadsDir, 'customer.png'), 'utf8'), 'customer upload');
        assert.equal(fs.readFileSync(path.join(plugins, 'other-plugin.zip'), 'utf8'), 'unrelated download');
    };
    return { dir, packageDir, uploadsDir, plugins, run, unchangedCustomers };
}

test('valid image installs both files; identical restart leaves them untouched', t => {
    const f = fixture(t);
    assert.deepEqual(f.run(), { version: '2.23.0', sha256: RELEASE.zip, updated: names });
    const before = names.map(name => fs.statSync(path.join(f.plugins, name)));
    assert.deepEqual(f.run().updated, []);
    names.forEach((name, i) => {
        assert.deepEqual(fs.readFileSync(path.join(f.plugins, name)), fs.readFileSync(path.join(f.packageDir, name)));
        const after = fs.statSync(path.join(f.plugins, name));
        assert.equal(after.ino, before[i].ino);
        assert.equal(after.mtimeMs, before[i].mtimeMs);
    });
    f.unchangedCustomers();
    assert.deepEqual(fs.readdirSync(f.plugins).sort(), [...names, 'other-plugin.zip'].sort());
});

test('stale persistent volume and partial prior install converge without touching user uploads', t => {
    const f = fixture(t);
    names.forEach(name => fs.writeFileSync(path.join(f.plugins, name), 'old 2.22.0'));
    assert.deepEqual(f.run().updated, names);
    fs.writeFileSync(path.join(f.plugins, names[1]), 'stale sidecar');
    assert.deepEqual(f.run().updated, [names[1]]);
    f.unchangedCustomers();
});

test('tampered ZIP or version manifest fails before replacing either existing file', t => {
    const f = fixture(t);
    names.forEach(name => fs.writeFileSync(path.join(f.plugins, name), 'prior verified download'));
    for (const name of names) {
        const file = path.join(f.packageDir, name);
        const original = fs.readFileSync(file);
        fs.writeFileSync(file, name.endsWith('.json') ? JSON.stringify({ version: '2.22.0', sha256: RELEASE.zip }) : 'tampered zip');
        assert.throws(() => f.run(), /SHA-256 mismatch/);
        names.forEach(target => assert.equal(fs.readFileSync(path.join(f.plugins, target), 'utf8'), 'prior verified download'));
        fs.writeFileSync(file, original);
    }
    f.unchangedCustomers();
});

test('missing package skips only local development; incomplete/production package fails closed', t => {
    const f = fixture(t);
    fs.unlinkSync(path.join(f.packageDir, names[0]));
    assert.throws(() => f.run({ required: false }), /missing or incomplete/);
    fs.unlinkSync(path.join(f.packageDir, names[1]));
    assert.throws(() => f.run(), /missing or incomplete/);
    assert.equal(f.run({ required: false }).skipped, true);
    assert.deepEqual(fs.readdirSync(f.plugins), ['other-plugin.zip']);
    f.unchangedCustomers();
    const env = { NODE_ENV: process.env.NODE_ENV, OVERSEEK_REQUIRE_PLUGIN_DOWNLOAD: process.env.OVERSEEK_REQUIRE_PLUGIN_DOWNLOAD };
    try {
        process.env.NODE_ENV = 'development';
        process.env.OVERSEEK_REQUIRE_PLUGIN_DOWNLOAD = '1';
        assert.throws(() => f.run({ required: undefined }), /missing or incomplete/);
        delete process.env.OVERSEEK_REQUIRE_PLUGIN_DOWNLOAD;
        process.env.NODE_ENV = 'production';
        assert.throws(() => f.run({ required: undefined }), /missing or incomplete/);
    } finally {
        for (const [key, value] of Object.entries(env)) {
            if (value === undefined) delete process.env[key]; else process.env[key] = value;
        }
    }
});

test('fresh volume creates only the plugin download directory and two files', t => {
    const f = fixture(t);
    const uploadsDir = path.join(f.dir, 'fresh-volume');
    assert.deepEqual(f.run({ uploadsDir }).updated, names);
    assert.deepEqual(fs.readdirSync(uploadsDir), ['plugins']);
    assert.deepEqual(fs.readdirSync(path.join(uploadsDir, 'plugins')).sort(), [...names].sort());
});

test('source and destination symlinks are rejected, including dangling targets and ancestors', t => {
    const f = fixture(t);
    const outside = path.join(f.dir, 'outside');
    fs.mkdirSync(outside);
    const sourceAlias = path.join(f.dir, 'source-alias');
    fs.symlinkSync(f.packageDir, sourceAlias);
    assert.throws(() => f.run({ packageDir: sourceAlias }), /Unsafe download directory/);
    const uploadAlias = path.join(f.dir, 'upload-alias');
    fs.symlinkSync(f.uploadsDir, uploadAlias);
    assert.throws(() => f.run({ uploadsDir: uploadAlias }), /Unsafe download directory/);
    for (const name of names) {
        const file = path.join(f.plugins, name);
        fs.symlinkSync(path.join(outside, name), file);
        assert.throws(() => f.run(), /Unsafe download file/);
        assert.deepEqual(fs.readdirSync(outside), []);
        fs.unlinkSync(file);
    }
    fs.unlinkSync(path.join(f.packageDir, names[0]));
    fs.symlinkSync(path.join(outside, 'absent'), path.join(f.packageDir, names[0]));
    assert.throws(() => f.run(), /Unsafe download file/);
    f.unchangedCustomers();
});

test('Docker context exceptions and production COPY/startup wiring are narrowly scoped (static)', () => {
    const ignore = fs.readFileSync(path.join(root, '.dockerignore'), 'utf8');
    const rules = ignore.split('\n').map(s => s.trim()).filter(s => s && !s.startsWith('#'));
    // Evaluate these simple path/glob rules against each path and its ancestors.
    // This is a static regression check, not a Docker build/context execution.
    const included = file => {
        const parts = file.split('/');
        const paths = parts.map((_, i) => parts.slice(0, i + 1).join('/'));
        let allowed = true;
        for (const rule of rules) {
            const negated = rule.startsWith('!');
            const pattern = (negated ? rule.slice(1) : rule).replace(/\/$/, '');
            if (paths.some(p => path.matchesGlob(p, pattern))) allowed = negated;
        }
        return allowed;
    };
    names.forEach(name => assert.equal(included(`server/uploads/plugins/${name}`), true));
    for (const file of ['uploads/customer.png', 'client/uploads/customer.png', 'server/uploads/customer.png',
        'server/uploads/invoices/order.pdf', 'server/uploads/plugins/user.zip', 'server/uploads/plugins/private/secret.json']) {
        assert.equal(included(file), false, file);
    }
    const docker = fs.readFileSync(path.join(root, 'server/Dockerfile'), 'utf8').split('AS production')[1];
    names.forEach(name => assert.ok(docker.includes(`COPY server/uploads/plugins/${name} /opt/overseek/plugin-download/${name}`)));
    assert.ok(docker.includes('COPY server/scripts/install_plugin_download.js ./server/scripts/install_plugin_download.js'));
    assert.ok(docker.includes('ENV OVERSEEK_REQUIRE_PLUGIN_DOWNLOAD=1'));
    const start = fs.readFileSync(path.join(root, 'server/start.sh'), 'utf8');
    assert.ok(start.indexOf('install_plugin_download.js') > start.indexOf('[Startup] Database ready.'));
    assert.ok(start.indexOf('install_plugin_download.js') < start.indexOf('exec npm start'));
    const installer = fs.readFileSync(path.join(root, 'server/scripts/install_plugin_download.js'), 'utf8');
    const imports = [...installer.matchAll(/require\('([^']+)'\)/g)].map(match => match[1]);
    assert.ok(imports.every(name => name.startsWith('node:')));
    assert.ok(!installer.includes('child_process'));
});
