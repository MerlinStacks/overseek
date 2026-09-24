const { test } = require('node:test');
const assert = require('node:assert/strict');
const { run } = require('../startup_migrations');

function fixture(outputs, options = {}) {
    const calls = [];
    return { calls, execute: () => run({
        enabled: 'true', log: () => {},
        migrate: async () => {
            calls.push('deploy');
            assert.ok(outputs.length, 'unexpected extra migration attempt');
            const output = outputs.shift();
            return { ok: output === 'ok', output };
        },
        recover: async () => { calls.push('repair'); },
        sleep: async ms => { assert.equal(ms, 5000); calls.push('wait'); },
        ...options,
    }) };
}
test('healthy deployment does not invoke repair', async () => {
    const f = fixture(['ok']);
    await f.execute();
    assert.deepEqual(f.calls, ['deploy']);
});
test('known Prisma failure invokes repair once then verifies deployment', async () => {
    for (const code of ['P3009', 'P3018']) {
        const f = fixture([code, 'ok']);
        await f.execute();
        assert.deepEqual(f.calls, ['deploy', 'repair', 'deploy']);
    }
});
test('transient errors retry without repair and are bounded', async () => {
    for (const code of ['P1001', 'P1002', 'P1017', 'P1008']) {
        const f = fixture([code, code, code, code]);
        await assert.rejects(f.execute(), /startup stopped/);
        assert.deepEqual(f.calls, ['deploy', 'wait', 'deploy', 'wait', 'deploy', 'wait', 'deploy']);
    }
    const f = fixture(['P1001', 'ok']);
    await f.execute();
    assert.deepEqual(f.calls, ['deploy', 'wait', 'deploy']);
});
test('unknown failures and disabled recovery stop without schema changes', async () => {
    for (const [code, enabled] of [['P3005', 'true'], ['P1000', 'true'], ['P3009', 'false']]) {
        const f = fixture([code], { enabled });
        await assert.rejects(f.execute(), /startup stopped/);
        assert.deepEqual(f.calls, ['deploy']);
    }
});
test('rejected repair propagates and never retries deployment', async () => {
    const f = fixture(['P3009'], { recover: async () => { throw new Error('schema mismatch'); } });
    await assert.rejects(f.execute(), /schema mismatch/);
    assert.deepEqual(f.calls, ['deploy']);
});
test('post-repair failure cannot cause a second repair even with transient errors', async () => {
    const f = fixture(['P3009', 'P1001', 'P3018']);
    await assert.rejects(f.execute(), /startup stopped/);
    assert.deepEqual(f.calls, ['deploy', 'repair', 'deploy', 'wait', 'deploy']);
});
test('failed history takes priority over nested transient error logs', async () => {
    const f = fixture(['P3009 previous P1001', 'ok']);
    await f.execute();
    assert.deepEqual(f.calls, ['deploy', 'repair', 'deploy']);
});
test('invalid configuration is rejected before touching the database', async () => {
    const f = fixture([], { enabled: 'yes' });
    await assert.rejects(f.execute(), /must be true or false/);
    assert.deepEqual(f.calls, []);
});
