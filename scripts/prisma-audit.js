// @ts-check
/**
 * Prisma Schema Hygiene Auditor
 *
 * Checks schema.prisma for multi-tenancy hygiene:
 * 1. Every model (except exempt global tables) must have `accountId`.
 * 2. Every model with `accountId` must have an `Account` relation.
 * 3. Indexes must exist on `accountId`.
 *
 * Run via: node scripts/prisma-audit.js
 * Fail CI: exit(1) on violations.
 */

const fs = require('fs');
const path = require('path');

const SCHEMA_PATH = path.resolve(__dirname, '../server/prisma/schema.prisma');

// Exempt models that are global (not account-scoped)
const EXEMPT_MODELS = new Set([
    'User',
    'RefreshToken',
    'Account',
    'AccountUser',
    'AccountRole',
    'AccountFeature',
]);

function parseModels(content) {
    const modelRegex = /model\s+(\w+)\s*\{([^}]*)\}/sg;
    const models = [];
    let match;
    while ((match = modelRegex.exec(content)) !== null) {
        models.push({
            name: match[1].trim(),
            body: match[2],
            startIndex: match.index
        });
    }
    return models;
}

function audit() {
    if (!fs.existsSync(SCHEMA_PATH)) {
        console.error(`Schema file not found: ${SCHEMA_PATH}`);
        process.exit(1);
    }

    const content = fs.readFileSync(SCHEMA_PATH, 'utf-8');
    const models = parseModels(content);
    const violations = [];

    for (const model of models) {
        if (EXEMPT_MODELS.has(model.name)) continue;

        const hasAccountId = /\s+accountId\s+/.test(model.body);
        if (!hasAccountId) {
            violations.push({
                model: model.name,
                issue: 'Missing `accountId` field'
            });
        } else {
            // Check for Account relation
            if (!/\s+Account\s+/.test(model.body)) {
                violations.push({
                    model: model.name,
                    issue: 'Has `accountId` but missing `Account` relation'
                });
            }
            // Check for index (simple regex for @@index([accountId]))
            if (!/@@index\(\[\s*accountId\s*\]\)/i.test(model.body)) {
                violations.push({
                    model: model.name,
                    issue: 'Missing @@index([accountId])'
                });
            }
        }
    }

    // Also audit for @@map usage consistency (optional warning)
    const mapWarnings = models
        .filter(m => !EXEMPT_MODELS.has(m.name) && !/@@map\("/.test(m.body))
        .map(m => ({ model: m.name, issue: 'Consider adding @@map for table name consistency' }));

    if (violations.length > 0) {
        console.error('\n❌ Prisma Schema Multi-tenancy Violations:\n');
        for (const v of violations) {
            console.error(`  ${v.model}: ${v.issue}`);
        }
    }

    if (mapWarnings.length > 0) {
        console.warn('\n⚠️  Optional @@map Warnings (not blocking):\n');
        for (const w of mapWarnings) {
            console.warn(`  ${w.model}: ${w.issue}`);
        }
    }

    if (violations.length > 0) {
        console.error(`\nFound ${violations.length} schema hygiene violation(s).\n`);
        process.exit(1);
    } else {
        console.log('All models pass schema hygiene audit.');
        process.exit(0);
    }
}

audit();
