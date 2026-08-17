const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '../../');
const pluginSource = path.join(projectRoot, 'overseek-wc-plugin');
const outputDir = path.join(projectRoot, 'server/uploads/plugins');
const outputPath = path.join(outputDir, 'overseek-wc-plugin.zip');
const tempBuildLayout = path.join(projectRoot, 'server/uploads/temp_build');
const tempPluginDir = path.join(tempBuildLayout, 'overseek-wc-plugin');

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

if (process.argv.includes('--check')) {
    console.log('Required plugin runtime files are present.');
    process.exit(0);
}

fs.rmSync(outputPath, { force: true });
fs.rmSync(tempBuildLayout, { recursive: true, force: true });
fs.mkdirSync(tempBuildLayout, { recursive: true });
fs.mkdirSync(outputDir, { recursive: true });

try {
    console.log(`Copying source to ${tempPluginDir}...`);
    fs.cpSync(pluginSource, tempPluginDir, { recursive: true });

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
        execFileSync('zip', ['-r', outputPath, 'overseek-wc-plugin'], {
            cwd: tempBuildLayout,
            stdio: 'inherit'
        });
    }

    console.log('Plugin packaged successfully.');
} catch (error) {
    console.error('Failed to package plugin:', error);
    process.exit(1);
} finally {
    fs.rmSync(tempBuildLayout, { recursive: true, force: true });
}
