#!/usr/bin/env node
/** Fail-closed startup: bounded transient retries and one reviewed repair. */
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { automaticRepair } = require('./repair_migration_history');

function deploy() {
    const result = spawnSync(process.execPath, [require.resolve('prisma/build/index.js'),
        'migrate', 'deploy', '--config', './prisma/prisma.config.ts'], {
        cwd: path.resolve(__dirname, '..'), env: process.env, encoding: 'utf8',
        maxBuffer: 8 * 1024 * 1024,
    });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    return { ok: result.status === 0 && !result.error,
        output: `${result.stdout || ''}\n${result.stderr || ''}` };
}

async function run({ migrate = deploy, recover = automaticRepair,
    sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
    enabled = process.env.MIGRATION_AUTO_REPAIR || 'true', log = console.log } = {}) {
    if (!['true', 'false'].includes(enabled)) throw new Error('MIGRATION_AUTO_REPAIR must be true or false.');
    let repaired = false;
    let transientRetries = 0;
    for (;;) {
        const result = await migrate();
        if (result.ok) {
            log('[Startup] Migrations applied via migrate deploy.');
            return;
        }
        // Failed history wins over transient text embedded in an old error log.
        const historyFailure = /\bP(?:3009|3018)\b/.test(result.output);
        if (!historyFailure && /\bP(?:1001|1002|1017|1008)\b/.test(result.output) && transientRetries < 3) {
            transientRetries++;
            log(`[Startup] Temporary database failure; retry ${transientRetries}/3 in 5s.`);
            await sleep(5000);
            continue;
        }
        if (historyFailure && enabled === 'true' && !repaired) {
            repaired = true;
            log('[Startup] Checking eligibility for pinned September 2026 history repair.');
            await recover();
            log('[Startup] Repair committed; verifying with migrate deploy.');
            continue;
        }
        throw new Error('Migration deployment failed; application startup stopped. Review migration logs and docs/migration-history-repair.md.');
    }
}

if (require.main === module) run().catch(error => {
    // Connection errors may contain connection details; print SQLSTATE only.
    console.error(`[Startup] ${error.code ? `Database recovery failed (${error.code}).` : error.message}`);
    console.error('[Startup] Startup stopped. See docs/migration-history-repair.md for supported recovery cases and manual hold mode.');
    process.exitCode = 1;
});
module.exports = { run };
