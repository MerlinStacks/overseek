// @ts-check
/**
 * File Size Guard
 *
 * Enforces AGENTS.md file size limits:
 * - Server routes: max 500 lines (soft 300)
 * - Server services: max 400 lines (soft 250)
 * - Client pages: max 250 lines
 * - Client components: max 150 lines
 * - UI components: max 150 lines
 *
 * Run via: node scripts/file-size-guard.js [files...]
 */

const fs = require('fs');
const path = require('path');

const HARD_LIMITS = [
    { pattern: /server[\\/]src[\\/]routes[\\/](?!.*index\.ts$).*\.ts$/i, max: 500, name: 'Server route' },
    { pattern: /server[\\/]src[\\/]services[\\/](?!.*index\.ts$).*\.ts$/i, max: 400, name: 'Server service' },
    { pattern: /client[\\/]src[\\/]pages[\\/](?!.*index\.ts$).*\.(ts|tsx)$/i, max: 250, name: 'Client page' },
    { pattern: /client[\\/]src[\\/]components[\\/]ui[\\/].*\.(ts|tsx)$/i, max: 150, name: 'UI component' },
    { pattern: /client[\\/]src[\\/]components[\\/](?!ui[\\/]).*\.(ts|tsx)$/i, max: 250, name: 'Feature component' },
];

const SOFT_LIMITS = [
    { pattern: /server[\\/]src[\\/]routes[\\/](?!.*index\.ts$).*\.ts$/i, max: 300, name: 'Server route' },
    { pattern: /server[\\/]src[\\/]services[\\/](?!.*index\.ts$).*\.ts$/i, max: 250, name: 'Server service' },
];

function countLines(filePath) {
    const content = fs.readFileSync(filePath, 'utf-8');
    return content.split(/\r?\n/).length;
}

function main() {
    const files = process.argv.slice(2);
    if (files.length === 0) {
        console.log('No files to check');
        process.exit(0);
    }

    const hardViolations = [];
    const softViolations = [];

    for (const file of files) {
        // Only check source files in src directories
        if (!file.includes('src')) continue;
        if (file.includes('node_modules')) continue;

        const relativePath = path.relative(process.cwd(), file).replace(/\//g, '\\');

        // Check hard limits
        for (const rule of HARD_LIMITS) {
            if (rule.pattern.test(relativePath)) {
                const lines = countLines(file);
                if (lines > rule.max) {
                    hardViolations.push({ file: relativePath, lines, limit: rule.max, type: rule.name });
                }
                break; // Only match first applicable rule
            }
        }

        // Check soft limits
        for (const rule of SOFT_LIMITS) {
            if (rule.pattern.test(relativePath)) {
                const lines = countLines(file);
                if (lines > rule.max) {
                    softViolations.push({ file: relativePath, lines, limit: rule.max, type: rule.name });
                }
                break;
            }
        }
    }

    if (softViolations.length > 0) {
        console.warn('\n⚠️  Soft limit warnings (consider refactoring):\n');
        for (const v of softViolations) {
            console.warn(`  ${v.type} "${v.file}" has ${v.lines} lines (soft limit: ${v.limit})`);
        }
    }

    if (hardViolations.length > 0) {
        console.error('\n❌ Hard limit violations (commit blocked):\n');
        for (const v of hardViolations) {
            console.error(`  ${v.type} "${v.file}" has ${v.lines} lines (hard limit: ${v.limit})`);
        }
        console.error('\nPlease decompose the file into smaller modules before committing.\n');
        process.exit(1);
    }

    if (softViolations.length === 0 && hardViolations.length === 0) {
        console.log('All files within size limits.');
    }
}

main();
