const assert = require('node:assert/strict');
const { mkdtempSync, writeFileSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

const startup = path.resolve(__dirname, '../../start.sh');
const migrationError = 'mock migration failure: P3009 requires migration repair';
const migrate = `node ${path.resolve(__dirname, '../startup_migrations.js')}`;
const push = 'npx prisma db push --config ./prisma/prisma.config.ts';
const installer = `node ${path.resolve(__dirname, '../install_plugin_download.js')}`;

// Run the real shell script with fake external commands, never Prisma or a DB.
function runStartup(overrides = {}) {
    const directory = mkdtempSync(path.join(tmpdir(), 'startup-rollback-'));
    const log = path.join(directory, 'commands.log');
    const commands = {
        npx: `case "$*" in
  'prisma migrate deploy --config ./prisma/prisma.config.ts')
    if [ "$MIGRATE_STATUS" != 0 ]; then
      printf '%s\\n' '${migrationError}' >&2
    fi
    exit "$MIGRATE_STATUS" ;;
  'prisma db push --config ./prisma/prisma.config.ts') exit "$PUSH_STATUS" ;;
  *) exit 97 ;;
esac`,
        node: `case "$*" in
  */startup_migrations.js)
    if [ "$MIGRATE_STATUS" != 0 ]; then printf '%s\\n' '${migrationError}' >&2; fi
    exit "$MIGRATE_STATUS" ;;
  *) exit "$INSTALL_STATUS" ;;
esac`,
        npm: '[ "$*" = start ] || exit 98\nexit 0',
        sleep: 'exit 0',
    };
    try {
        writeFileSync(log, '');
        for (const [name, body] of Object.entries(commands)) {
            writeFileSync(path.join(directory, name),
                `#!/bin/sh\nprintf '%s\\n' "${name} $*" >> "$COMMAND_LOG"\n${body}\n`,
                { mode: 0o755 });
        }
        const result = spawnSync('/bin/sh', [startup], {
            cwd: directory,
            encoding: 'utf8',
            timeout: 5000,
            env: {
                PATH: `${directory}:/usr/bin:/bin`,
                COMMAND_LOG: log,
                NODE_ENV: 'production',
                ALLOW_DB_PUSH_FALLBACK: '',
                DATABASE_URL: 'postgres://unused:unused@127.0.0.1:1/unused',
                MIGRATE_STATUS: '0',
                PUSH_STATUS: '0',
                INSTALL_STATUS: '0',
                ...overrides,
            },
        });
        assert.ifError(result.error);
        assert.equal(result.signal, null, 'startup must finish within the timeout');
        return { ...result, commands: readFileSync(log, 'utf8').trim().split('\n') };
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
}

test('successful migrations install the plugin before normal application startup', () => {
    const result = runStartup();
    assert.equal(result.status, 0);
    assert.deepEqual(result.commands, [migrate, installer, 'npm start']);
});

test('explicit recovery hold starts existing schema without running pending migrations or db push', () => {
    const result = runStartup({ MIGRATION_RECOVERY_MODE: 'hold', MIGRATE_STATUS: '1' });
    assert.equal(result.status, 0);
    assert.deepEqual(result.commands, [installer, 'npm start']);
    assert.match(result.stdout, /RECOVERY HOLD/);
});

test('invalid recovery mode cannot silently bypass migrations', () => {
    const result = runStartup({ MIGRATION_RECOVERY_MODE: 'typo' });
    assert.equal(result.status, 1);
    assert.deepEqual(result.commands, ['']);
});

test('production migration failure without an override exits before fallback or app', () => {
    const result = runStartup({ MIGRATE_STATUS: '1' });
    assert.equal(result.status, 1);
    assert.deepEqual(result.commands, [migrate]);
    assert.ok(result.stderr.includes(migrationError));
});

test('legacy production override cannot bypass failed migration recovery', () => {
    const result = runStartup({ MIGRATE_STATUS: '1', ALLOW_DB_PUSH_FALLBACK: 'true' });
    assert.equal(result.status, 1);
    assert.deepEqual(result.commands, [migrate]);
});

test('failure preserves migration stderr and never falls back to schema push', () => {
    for (const env of [
        { NODE_ENV: 'production', ALLOW_DB_PUSH_FALLBACK: 'true' },
        { NODE_ENV: 'development' },
    ]) {
        const result = runStartup({ MIGRATE_STATUS: '1', ...env });
        assert.equal(result.status, 1);
        assert.ok(result.stderr.includes(migrationError));
        assert.ok(!result.commands.includes(push));
        assert.ok(result.commands.every(command => !command.includes('--accept-data-loss')));
    }
});

test('failed recovery never installs or starts the app', () => {
    const result = runStartup({
        MIGRATE_STATUS: '1', PUSH_STATUS: '1', ALLOW_DB_PUSH_FALLBACK: 'true',
    });
    assert.equal(result.status, 1);
    assert.deepEqual(result.commands, [migrate]);
    assert.ok(result.stderr.includes(migrationError));
});

test('installer failure prevents application startup after successful migrations', () => {
    for (const migrateStatus of ['0', '1']) {
        const result = runStartup({
            MIGRATE_STATUS: migrateStatus,
            ALLOW_DB_PUSH_FALLBACK: 'true',
            INSTALL_STATUS: '7',
        });
        assert.equal(result.status, migrateStatus === '0' ? 7 : 1);
        assert.deepEqual(result.commands,
            migrateStatus === '0' ? [migrate, installer] : [migrate]);
    }
});
