import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

const projectRoot = path.resolve(__dirname, '../../');
const pluginSource = path.join(projectRoot, 'overseek-wc-plugin');
const outputDir = path.join(projectRoot, 'server/uploads/plugins');
const outputPath = path.join(outputDir, 'overseek-wc-plugin.zip');

console.log(`Building plugin from ${pluginSource} to ${outputPath}...`);

if (!fs.existsSync(pluginSource)) {
    console.error(`Plugin source not found at ${pluginSource}`);
    process.exit(1);
}

if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
}

// PowerShell command to zip. 
// Using absolute paths prevents ambiguity.
const psCommand = `Compress-Archive -Path "${pluginSource}" -DestinationPath "${outputPath}" -Force`;

try {
    console.log(`Executing: ${psCommand}`);
    execSync(`powershell -Command "${psCommand}"`, { stdio: 'inherit' });
    console.log('Plugin packaged successfully.');
} catch (error) {
    console.error('Failed to package plugin:', error);
    process.exit(1);
}
