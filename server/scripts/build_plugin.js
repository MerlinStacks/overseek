const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { manifest } = require('./plugin_manifest');

const projectRoot = path.resolve(__dirname, '../../');
const pluginSource = path.join(projectRoot, 'overseek-wc-plugin');
const outputFlag = process.argv.indexOf('--output-dir');
if (outputFlag !== -1 && !process.argv[outputFlag + 1]) throw new Error('--output-dir requires a path');
const outputDir = outputFlag === -1 ? path.join(projectRoot, 'server/uploads/plugins') : path.resolve(process.argv[outputFlag + 1]);
const outputPath = path.join(outputDir, 'overseek-wc-plugin.zip');

if (process.argv.includes('--publish-verified')) {
    try {
        const value = flag => {
            const index = process.argv.indexOf(flag);
            const result = index === -1 ? '' : process.argv[index + 1];
            if (!result || result.startsWith('--')) throw new Error(`${flag} requires a value`);
            return result;
        };
        if (process.argv.includes('--check') || process.argv.includes('--lint')) {
            throw new Error('Verified publication does not rebuild/lint; use package checks before publication');
        }
        const { publishVerified } = require('./publish_verified_plugin');
        const report = publishVerified({ projectRoot, outputDir,
            archive: path.resolve(value('--publish-verified')), expectedSha256: value('--expected-sha256') });
        console.log(`Published verified plugin ${report.version}: ${outputPath}`);
        console.log(`${Object.keys(report.files).length} files, ${report.bytes} bytes; SHA-256 ${report.sha256}`);
    } catch (error) {
        console.error('Verified publication failed:', error.message);
        process.exitCode = 1;
    }
    return;
}

console.log(`Building plugin from ${pluginSource} to ${outputPath}...`);

if (!fs.existsSync(pluginSource)) {
    console.error(`Plugin source not found at ${pluginSource}`);
    process.exit(1);
}

const requiredRuntimeFiles = [
    'overseek-integration.php',
    'includes/class-overseek-main.php',
    'includes/class-overseek-review-moderation.php',
    'includes/class-overseek-review-renderer.php',
    'includes/class-overseek-reviews.php',
    'includes/class-overseek-review-form.php',
];
const missingRuntimeFiles = requiredRuntimeFiles.filter((relativePath) => !fs.existsSync(path.join(pluginSource, relativePath)));
if (missingRuntimeFiles.length > 0) {
    console.error(`Required plugin runtime files are missing: ${missingRuntimeFiles.join(', ')}`);
    process.exit(1);
}

const reviewFormSource = fs.readFileSync(path.join(pluginSource, 'includes/class-overseek-review-form.php'), 'utf8');
if (/\breadonly\s*\(/.test(reviewFormSource)) {
    console.error('Unsupported readonly() helper found in the review form; use wp_readonly() instead.');
    process.exit(1);
}

if (process.argv.includes('--check')) {
    console.log('Required plugin runtime files are present.');
    process.exit(0);
}

fs.mkdirSync(outputDir, { recursive: true });
const tempBuildLayout = fs.mkdtempSync(path.join(outputDir, '.overseek-plugin-'));
const tempPluginDir = path.join(tempBuildLayout, 'overseek-wc-plugin');

try {
    console.log(`Copying source to ${tempPluginDir}...`);
    const { included, excluded } = manifest(pluginSource);
    for (const file of [
        'uninstall.php', 'README.md', 'blocks/delivery-estimate/block.json',
        'blocks/delivery-estimate/editor.js', 'assets/js/delivery-estimate.js',
        'assets/css/delivery-estimate.css', 'includes/class-overseek-delivery-control.php',
        'includes/class-overseek-delivery-engine.php', 'includes/class-overseek-receipt-api.php',
    ]) {
        if (!included.includes(file)) throw new Error(`Required release runtime file missing: ${file}`);
    }
    for (const relative of included) {
        const target = path.join(tempPluginDir, relative);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(path.join(pluginSource, relative), target);
    }
    fs.copyFileSync(path.join(projectRoot, 'LICENSE'), path.join(tempPluginDir, 'LICENSE'));
    included.push('LICENSE');
    included.sort();
    const source = fs.readFileSync(path.join(tempPluginDir, 'overseek-integration.php'), 'utf8');
    const version = source.match(/\* Version:\s+(\S+)/)?.[1];
    if (!version || !source.includes(`define('OVERSEEK_WC_VERSION', '${version}')`) ||
        !fs.readFileSync(path.join(tempPluginDir, 'README.md'), 'utf8').includes(`Current version: **${version}**`)) {
        throw new Error('Plugin header, constant and README versions must agree');
    }
    for (const file of included.filter(file => file.endsWith('.asset.php'))) {
        const metadata = fs.readFileSync(path.join(tempPluginDir, file), 'utf8');
        if (!metadata.includes(`OVERSEEK_WC_VERSION : '${version}'`)) {
            throw new Error(`Asset version metadata must match the plugin: ${file}`);
        }
    }
    if (process.argv.includes('--lint')) {
        for (const file of included.filter(file => file.endsWith('.php'))) {
            execFileSync('php', ['-l', path.join(tempPluginDir, file)], { stdio: 'pipe' });
        }
        console.log('All packaged PHP files passed php -l.');
    }
    // Start fresh: zip otherwise retains removed files from a previous archive.
    fs.rmSync(outputPath, { force: true });

    if (process.platform === 'win32') {
        execFileSync('powershell', [
            '-NoProfile',
            '-Command',
            `Compress-Archive -Path ${JSON.stringify(tempPluginDir)} -DestinationPath ${JSON.stringify(outputPath)} -Force`
        ], { stdio: 'inherit' });
    } else {
        try {
            execFileSync('zip', ['-v'], { stdio: 'ignore' });
        } catch {
            throw new Error('The "zip" command is required to build the WordPress plugin on non-Windows platforms. Install zip or run the build in an image that includes it.');
        }
        execFileSync('zip', ['-qr', outputPath, 'overseek-wc-plugin'], {
            cwd: tempBuildLayout,
            stdio: 'inherit'
        });
    }

    // Python's standard ZIP reader verifies CRC, exact entries and file contents on all platforms.
    const expected = Object.fromEntries(included.map(file => [
        `overseek-wc-plugin/${file}`, crypto.createHash('sha256').update(fs.readFileSync(path.join(tempPluginDir, file))).digest('hex')
    ]));
    execFileSync(process.platform === 'win32' ? 'python' : 'python3', ['-c',
        'import sys,json,zipfile,hashlib; z=zipfile.ZipFile(sys.argv[1]); expected=json.load(sys.stdin); names=[n for n in z.namelist() if not n.endswith("/")]; assert len(names)==len(set(names)); assert set(names)==set(expected), "ZIP manifest mismatch"; assert z.testzip() is None; assert all(hashlib.sha256(z.read(n)).hexdigest()==h for n,h in expected.items()), "ZIP content mismatch"',
        outputPath], { input: JSON.stringify(expected), stdio: ['pipe', 'inherit', 'inherit'] });
    const bytes = fs.readFileSync(outputPath);
    const report = { version, bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), files: expected, excluded };
    fs.writeFileSync(path.join(outputDir, 'overseek-wc-plugin.manifest.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(`Verified ${included.length} files, ${bytes.length} bytes; SHA-256 ${report.sha256}`);

    console.log('Plugin packaged successfully.');
} catch (error) {
    fs.rmSync(outputPath, { force: true });
    fs.rmSync(path.join(outputDir, 'overseek-wc-plugin.manifest.json'), { force: true });
    console.error('Failed to package plugin:', error);
    process.exitCode = 1;
} finally {
    fs.rmSync(tempBuildLayout, { recursive: true, force: true });
}
