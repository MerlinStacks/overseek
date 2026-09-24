const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const server = path.resolve(__dirname, '../..');

function runStartup(t, overrides = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'overseek-startup-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const log = path.join(dir, 'commands');
    // Only these fakes can run migration/application commands. No real DB or npm.
    const commands = {
        npx: `printf 'npx %s\\n' "$*" >> "$COMMAND_LOG"
printf '%s\\n' 'migration stdout: original diagnostic'
printf '%s\\n' 'migration stderr: original SQL error' 'DETAIL: second diagnostic line' >&2
exit "$MIGRATION_EXIT"`,
        node: `printf 'node %s\\n' "$*" >> "$COMMAND_LOG"
exit "$INSTALL_EXIT"`,
        npm: `printf 'npm %s\\n' "$*" >> "$COMMAND_LOG"
printf 'NODE_OPTIONS=%s\\n' "$NODE_OPTIONS"
exit "$APP_EXIT"`,
        sleep: `printf 'sleep %s\\n' "$*" >> "$COMMAND_LOG"
exit 99`,
    };
    for (const [name, body] of Object.entries(commands)) {
        fs.writeFileSync(path.join(dir, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
    }
    const result = spawnSync('/bin/sh', [path.join(server, 'start.sh')], {
        cwd: server,
        env: {
            PATH: `${dir}:/usr/bin:/bin`,
            DATABASE_URL: 'postgres://fake:fake@invalid.invalid/fake',
            NODE_ENV: 'production',
            COMMAND_LOG: log,
            MIGRATION_EXIT: '0',
            INSTALL_EXIT: '0',
            APP_EXIT: '0',
            ...overrides,
        },
        encoding: 'utf8',
        timeout: 5000,
    });
    assert.ifError(result.error);
    assert.equal(result.signal, null);
    return { ...result, commands: fs.readFileSync(log, 'utf8').trim().split('\n') };
}

for (const [name, env] of [
    ['production', {}],
    ['production with obsolete override', { ALLOW_DB_PUSH_FALLBACK: 'true' }],
    ['development', { NODE_ENV: 'development' }],
    ['unset NODE_ENV with obsolete override', { NODE_ENV: undefined, ALLOW_DB_PUSH_FALLBACK: 'true' }],
]) {
    test(`migration failure fails closed in ${name}`, t => {
        const result = runStartup(t, { ...env, MIGRATION_EXIT: '42' });
        assert.equal(result.status, 42);
        assert.deepEqual(result.commands, ['npx prisma migrate deploy --config ./prisma/prisma.config.ts']);
        assert.match(result.stdout, /migration stdout: original diagnostic/);
        assert.match(result.stderr, /migration stderr: original SQL error\nDETAIL: second diagnostic line\n/);
        assert.match(result.stderr, /exit 42/);
        assert.match(result.stderr, /prisma migrate status --config/);
        assert.match(result.stderr, /docs\/migration-startup-recovery.md/);
        assert.doesNotMatch(result.stdout, /Database ready|Starting Node.js application/);
    });
}

test('successful migration installs the plugin before starting the application', t => {
    const result = runStartup(t);
    assert.equal(result.status, 0);
    assert.deepEqual(result.commands, [
        'npx prisma migrate deploy --config ./prisma/prisma.config.ts',
        `node ${path.join(server, 'scripts/install_plugin_download.js')}`,
        'npm start',
    ]);
    assert.match(result.stdout, /NODE_OPTIONS=--max-old-space-size=6144/);
});

test('plugin installation failure still prevents application startup', t => {
    const result = runStartup(t, { INSTALL_EXIT: '17' });
    assert.equal(result.status, 17);
    assert.equal(result.commands.length, 2);
    assert.match(result.commands[1], /^node .*install_plugin_download\.js$/);
});

test('application exit code and explicit heap configuration are preserved', t => {
    const result = runStartup(t, { APP_EXIT: '23', NODE_OPTIONS: '--max-old-space-size=2048' });
    assert.equal(result.status, 23);
    assert.equal(result.commands.at(-1), 'npm start');
    assert.match(result.stdout, /NODE_OPTIONS=--max-old-space-size=2048/);
});
