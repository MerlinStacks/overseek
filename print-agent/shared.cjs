const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');

function createStationHeaders(stationId, stationToken, agentVersion) {
    return {
        'x-print-station-id': stationId,
        'x-print-station-token': stationToken,
        'x-print-agent-version': agentVersion,
    };
}

async function downloadLabel(job, options) {
    fs.mkdirSync(options.downloadDir, { recursive: true });
    const source = String(job.labelDownloadPath || job.labelFilePath);
    let url;
    if (source.startsWith('https://')) {
        url = source;
    } else if (source.startsWith('http://')) {
        throw new Error('HTTP (non-HTTPS) label URLs are not allowed');
    } else {
        url = `${options.apiBase}${source.startsWith('/') ? '' : '/'}${source}`;
    }
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 30000);
    const res = await fetch(url, { headers: options.headers, signal: controller.signal });
    if (!res.ok) throw new Error(`Label download failed: ${res.status}`);
    const filePath = path.join(options.downloadDir, `${job.id}.pdf`);
    fs.writeFileSync(filePath, Buffer.from(await res.arrayBuffer()));
    return filePath;
}

function printFile(filePath, printerName) {
    if (os.platform() === 'win32') {
        const encoded = Buffer.from(
            printerName
                ? `Start-Process -FilePath '${escapePowerShell(filePath)}' -Verb PrintTo -ArgumentList '${escapePowerShell(printerName)}' -WindowStyle Hidden`
                : `Start-Process -FilePath '${escapePowerShell(filePath)}' -Verb Print -WindowStyle Hidden`
        ).toString('base64');
        return execPromise('powershell.exe', ['-NoProfile', '-EncodedCommand', encoded]);
    }
    return execPromise('lp', printerName ? ['-d', printerName, filePath] : [filePath]);
}

async function overseekFetch(apiBase, urlPath, options = {}) {
    const res = await fetch(`${apiBase}${urlPath}`, options);
    const text = await res.text();
    let payload = null;
    try {
        payload = text ? JSON.parse(text) : null;
    } catch {
        payload = { error: text };
    }
    if (!res.ok) throw new Error(payload?.error || `Request failed with ${res.status}`);
    return payload;
}

function normalizeApiBase(value, label = 'OverSeek URL') {
    const apiBase = String(value || '').trim().replace(/\/+$/, '');
    if (!apiBase.startsWith('http://') && !apiBase.startsWith('https://')) {
        throw new Error(`${label} must start with http:// or https://`);
    }
    return apiBase;
}

async function listPrinters() {
    try {
        if (os.platform() === 'win32') {
            const output = await execPromise('powershell.exe', ['-NoProfile', '-Command', 'Get-Printer | Select-Object -ExpandProperty Name']);
            return output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
        }
        const output = await execPromise('lpstat', ['-a']);
        return output.split(/\r?\n/).map((line) => line.trim().split(/\s+/)[0]).filter(Boolean);
    } catch {
        return [];
    }
}

function execPromise(command, args) {
    return new Promise((resolve, reject) => {
        execFile(command, args, (error, stdout, stderr) => {
            if (error) reject(new Error(stderr || stdout || error.message));
            else resolve(stdout);
        });
    });
}

function escapePowerShell(value) {
    return String(value).replace(/'/g, "''");
}

module.exports = {
    createStationHeaders,
    downloadLabel,
    listPrinters,
    normalizeApiBase,
    overseekFetch,
    printFile,
};
