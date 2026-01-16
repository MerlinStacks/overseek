# migrate-console-error.ps1
# Migrates console.error to Logger.error in the OverSeek client

param(
    [string]$SrcRoot = "c:\Users\ratte\Desktop\OverSeekv2\client\src"
)

$srcRootDir = [System.IO.DirectoryInfo]$SrcRoot
$files = Get-ChildItem -Path $SrcRoot -Recurse -Include "*.tsx", "*.ts" | 
Where-Object { $_.FullName -notmatch "node_modules" -and $_.Name -ne "logger.ts" }

$modified = 0

foreach ($file in $files) {
    # Read file as lines
    $lines = Get-Content $file.FullName
    $originalLines = $lines.Clone()
    
    $contentStr = $lines -join "`r`n"
    
    # Skip if no console.error
    if ($contentStr -notmatch "console\.error") { 
        continue 
    }
    
    # Calculate correct import path
    $relPath = $file.FullName.Substring($srcRootDir.FullName.Length + 1).Replace("\", "/")
    $parts = $relPath.Split("/")
    $depth = $parts.Count - 1
    
    $prefix = ""
    for ($i = 0; $i -lt $depth; $i++) {
        $prefix += "../"
    }
    
    if ($relPath -match "^utils/") {
        $importPath = "./logger"
    }
    else {
        $importPath = $prefix + "utils/logger"
    }
    
    # Check if Logger is already imported
    $hasLoggerImport = $contentStr -match "import\s*\{\s*Logger\s*\}\s*from"
    
    # Process lines
    $newLines = @()
    $loggerImportAdded = $hasLoggerImport
    
    foreach ($line in $lines) {
        # Add Logger import after first import line (only once)
        if ((-not $loggerImportAdded) -and ($line -match "^import\s+.+\s+from\s+['""]")) {
            $newLines += $line
            $newLines += "import { Logger } from '$importPath';"
            $loggerImportAdded = $true
            continue
        }
        
        # Replace console.error patterns
        $newLine = $line
        $newLine = $newLine -replace "console\.error\('([^']+)',\s*(\w+)\)", "Logger.error('`$1', { error: `$2 })"
        $newLine = $newLine -replace 'console\.error\("([^"]+)",\s*(\w+)\)', "Logger.error('`$1', { error: `$2 })"
        $newLine = $newLine -replace "console\.error\('([^']+)'\)", "Logger.error('`$1')"
        $newLine = $newLine -replace 'console\.error\("([^"]+)"\)', "Logger.error('`$1')"
        $newLine = $newLine -replace "console\.error\((\w+)\)", "Logger.error('An error occurred', { error: `$1 })"
        
        $newLines += $newLine
    }
    
    # Write if changed
    $newContent = $newLines -join "`r`n"
    $originalContent = $originalLines -join "`r`n"
    
    if ($newContent -ne $originalContent) {
        Set-Content -Path $file.FullName -Value ($newLines -join "`r`n")
        $modified++
        Write-Host "OK: $relPath"
    }
}

Write-Host ""
Write-Host "=== Summary ==="  
Write-Host "Modified: $modified files"
