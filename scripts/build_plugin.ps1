$ErrorActionPreference = "Stop"

$workspaceRoot = "c:\Users\ratte\Desktop\OverSeekv2"
$pluginSource = Join-Path $workspaceRoot "overseek-wc-plugin"
$distDir = Join-Path $workspaceRoot "dist"
$tempDir = Join-Path $distDir "temp_build"
$pluginRoot = Join-Path $tempDir "overseek-wc-plugin"
$zipPath = Join-Path $workspaceRoot "overseek-wc-plugin.zip"

Write-Host "Building OverSeek WooCommerce Plugin..."

# 1. Clean up previous builds
if (Test-Path $distDir) { Remove-Item -Recurse -Force $distDir }
if (Test-Path $zipPath) { Remove-Item -Force $zipPath }

# 2. Create directory structure
New-Item -ItemType Directory -Force -Path $pluginRoot | Out-Null

# 3. Copy files
Write-Host "Copying files..."
Copy-Item (Join-Path $pluginSource "overseek-integration.php") -Destination $pluginRoot
Copy-Item -Recurse (Join-Path $pluginSource "includes") -Destination $pluginRoot

# 4. Create Zip Archive
Write-Host "Creating archive at $zipPath..."
Compress-Archive -Path "$pluginRoot" -DestinationPath $zipPath

# 5. Cleanup
Remove-Item -Recurse -Force $distDir

Write-Host "Build Complete! Plugin archive is located at: $zipPath"
