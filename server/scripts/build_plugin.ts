import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

const projectRoot = path.resolve(__dirname, '../../');
const pluginSource = path.join(projectRoot, 'overseek-wc-plugin');
const outputDir = path.join(projectRoot, 'server/uploads/plugins');
const outputPath = path.join(outputDir, 'overseek-wc-plugin.zip');
// Temp dir for building to ensure correct zip structure
const tempBuildLayout = path.join(projectRoot, 'server/uploads/temp_build');
const tempPluginDir = path.join(tempBuildLayout, 'overseek-wc-plugin');

console.log(`Building plugin from ${pluginSource} to ${outputPath}...`);

if (!fs.existsSync(pluginSource)) {
    console.error(`Plugin source not found at ${pluginSource}`);
    process.exit(1);
}

// Cleanup previous runs
if (fs.existsSync(outputPath)) {
    fs.unlinkSync(outputPath);
}
if (fs.existsSync(tempBuildLayout)) {
    fs.rmSync(tempBuildLayout, { recursive: true, force: true });
}

// Create temp layout: temp_build/overseek-wc-plugin
fs.mkdirSync(tempBuildLayout, { recursive: true });

// Copy source to temp
console.log(`Copying source to ${tempPluginDir}...`);
// Windows copy command
execSync(`xcopy "${pluginSource}" "${tempPluginDir}" /E /I /H /Y /Q`);

if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
}

// Zip logic: Zip the FOLDER inside tempBuildLayout
// By targeting the folder inside temp, Compress-Archive includes the folder itself.
const psCommand = `Get-ChildItem -Path "${tempBuildLayout}" | Compress-Archive -DestinationPath "${outputPath}" -Force`;

try {
    console.log(`Executing: ${psCommand}`);
    execSync(`powershell -Command "${psCommand}"`, { stdio: 'inherit' });
    console.log('Plugin packaged successfully.');
} catch (error) {
    console.error('Failed to package plugin:', error);
    process.exit(1);
} finally {
    // Cleanup temp
    if (fs.existsSync(tempBuildLayout)) {
        fs.rmSync(tempBuildLayout, { recursive: true, force: true });
    }
}
