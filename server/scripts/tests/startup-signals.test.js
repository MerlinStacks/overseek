const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { test } = require('node:test');

test('production startup execs Node so SIGTERM reaches its drain handler', { timeout: 10000 }, async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'overseek-startup-signals-'));
    const fixture = path.join(directory, 'app.cjs');
    fs.writeFileSync(fixture, `process.on('SIGTERM', () => { console.log('DRAINED'); process.exit(0); }); console.log('READY'); setInterval(() => {}, 1000);`);
    fs.writeFileSync(path.join(directory, 'node'), `#!/bin/sh\ncase "$*" in\n  *dist/index.js) exec '${process.execPath}' '${fixture}' ;;\n  *) exit 0 ;;\nesac\n`, { mode: 0o755 });
    const child = spawn('/bin/sh', [path.resolve(__dirname, '../../start.sh')], {
        cwd: directory,
        env: { ...process.env, PATH: `${directory}:/usr/bin:/bin`, DATABASE_URL: 'postgres://unused:unused@127.0.0.1:1/unused', MIGRATION_RECOVERY_MODE: 'hold', APP_URL: '' },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    let timer;
    try {
        const exited = new Promise((resolve, reject) => {
            child.once('error', reject);
            child.once('close', (code, signal) => resolve({ code, signal }));
        });
        await new Promise((resolve, reject) => {
            timer = setTimeout(() => reject(new Error('Fixture startup timed out')), 5000);
            child.stdout.on('data', data => { output += data; if (output.includes('READY')) resolve(); });
            child.once('error', reject);
        });
        child.kill('SIGTERM');
        const result = await exited;
        assert.deepEqual(result, { code: 0, signal: null });
        assert.match(output, /DRAINED/);
    } finally {
        clearTimeout(timer);
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
        fs.rmSync(directory, { recursive: true, force: true });
    }
});
