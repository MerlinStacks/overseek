const { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage, shell, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');

const AGENT_VERSION = app.getVersion();
const POLL_INTERVAL_MS = 5000;

let mainWindow = null;
let tray = null;
let pollTimer = null;
let isPolling = false;
let lastPollAt = null;
let lastPollError = '';
let lastJobMessage = '';

function configPath() {
    return path.join(app.getPath('userData'), 'config.json');
}

function downloadsDir() {
    return path.join(app.getPath('userData'), 'downloads');
}

function defaultConfig() {
    return {
        apiBase: '',
        stationId: '',
        stationToken: '',
        stationTokenEncrypted: '',
        stationName: os.hostname(),
        defaultPrinterName: '',
    };
}

function loadConfig() {
    try {
        if (!fs.existsSync(configPath())) return defaultConfig();
        const parsed = { ...defaultConfig(), ...JSON.parse(fs.readFileSync(configPath(), 'utf8')) };
        if (parsed.stationTokenEncrypted) {
            parsed.stationToken = decryptSecret(parsed.stationTokenEncrypted);
        } else if (parsed.stationToken) {
            setImmediate(() => saveConfig({ stationToken: parsed.stationToken }));
        }
        return parsed;
    } catch {
        return defaultConfig();
    }
}

function saveConfig(config) {
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    const current = fs.existsSync(configPath())
        ? { ...defaultConfig(), ...JSON.parse(fs.readFileSync(configPath(), 'utf8')) }
        : defaultConfig();
    const next = { ...current, ...config };
    if (Object.prototype.hasOwnProperty.call(config, 'stationToken')) {
        next.stationTokenEncrypted = config.stationToken ? encryptSecret(config.stationToken) : '';
        delete next.stationToken;
    }
    fs.writeFileSync(configPath(), JSON.stringify(next, null, 2), 'utf8');
    updateTray();
}

function encryptSecret(value) {
    if (!value) return '';
    if (!safeStorage.isEncryptionAvailable()) return Buffer.from(String(value), 'utf8').toString('base64');
    return safeStorage.encryptString(String(value)).toString('base64');
}

function decryptSecret(value) {
    if (!value) return '';
    try {
        const buffer = Buffer.from(String(value), 'base64');
        if (!safeStorage.isEncryptionAvailable()) return buffer.toString('utf8');
        return safeStorage.decryptString(buffer);
    } catch {
        return '';
    }
}

function hasStationConfig(config = loadConfig()) {
    return Boolean(config.apiBase && config.stationId && config.stationToken);
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 980,
        height: 720,
        minWidth: 760,
        minHeight: 560,
        title: 'OverSeek Print Agent',
        show: false,
        webPreferences: {
            preload: path.join(__dirname, 'preload.cjs'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });

    mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
    mainWindow.once('ready-to-show', () => mainWindow.show());
    mainWindow.on('close', (event) => {
        if (!app.isQuitting) {
            event.preventDefault();
            mainWindow.hide();
        }
    });
}

function createTray() {
    tray = new Tray(createTrayImage(hasStationConfig()));
    tray.setToolTip('OverSeek Print Agent');
    tray.on('click', showWindow);
    updateTray();
}

function createTrayImage(connected) {
    const color = connected ? '#4f46e5' : '#dc2626';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="${color}"/><path d="M9 10h14v5H9zM8 16h16v8H8zM11 5h10v5H11zM11 20h10v2H11z" fill="white"/></svg>`;
    return nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`);
}

function updateTray() {
    if (!tray) return;
    const config = loadConfig();
    tray.setImage(createTrayImage(hasStationConfig(config)));
    tray.setContextMenu(Menu.buildFromTemplate([
        { label: hasStationConfig(config) ? 'Connected' : 'Not connected', enabled: false },
        { label: 'Open OverSeek Print Agent', click: showWindow },
        { label: 'Open Logs Folder', click: () => shell.openPath(app.getPath('userData')) },
        { type: 'separator' },
        { label: 'Disconnect Station', enabled: hasStationConfig(config), click: disconnectStation },
        { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } },
    ]));
}

function showWindow() {
    if (!mainWindow) createWindow();
    mainWindow.show();
    mainWindow.focus();
}

function status() {
    const config = loadConfig();
    return {
        configured: hasStationConfig(config),
        apiBase: config.apiBase,
        stationId: config.stationId,
        stationName: config.stationName,
        defaultPrinterName: config.defaultPrinterName,
        agentVersion: AGENT_VERSION,
        lastPollAt,
        lastPollError,
        lastJobMessage,
        configPath: configPath(),
        logsPath: path.join(app.getPath('userData'), 'agent.log'),
        encryptionAvailable: safeStorage.isEncryptionAvailable(),
    };
}

function emitStatus() {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('agent:status', status());
    }
}

async function poll() {
    if (isPolling) return schedulePoll();
    const config = loadConfig();
    if (!hasStationConfig(config)) return schedulePoll();

    isPolling = true;
    try {
        lastPollAt = new Date().toISOString();
        const res = await fetch(`${config.apiBase}/api/shipping/print-agent/jobs`, { headers: stationHeaders(config) });
        if (!res.ok) throw new Error(`Job poll failed: ${res.status} ${await res.text()}`);
        const payload = await res.json();
        lastPollError = '';
        for (const job of payload.jobs || []) {
            await handleJob(job, config);
        }
    } catch (error) {
        lastPollError = error.message;
        log(`Poll failed: ${error.message}`);
    } finally {
        isPolling = false;
        emitStatus();
        schedulePoll();
    }
}

function schedulePoll() {
    clearTimeout(pollTimer);
    pollTimer = setTimeout(poll, POLL_INTERVAL_MS);
}

async function handleJob(job, config) {
    try {
        if (!job.labelDownloadPath && !job.labelFilePath) throw new Error('Label download path missing');
        const filePath = await downloadLabel(job, config);
        await printFile(filePath, job.printerName || config.defaultPrinterName);
        await report(job.id, 'printed', undefined, config);
        lastJobMessage = `Printed job ${job.id}`;
        log(lastJobMessage);
    } catch (error) {
        await report(job.id, 'failed', error.message, config);
        lastJobMessage = `Failed job ${job.id}: ${error.message}`;
        log(lastJobMessage);
    }
}

async function downloadLabel(job, config) {
    fs.mkdirSync(downloadsDir(), { recursive: true });
    const source = String(job.labelDownloadPath || job.labelFilePath);
    const url = source.startsWith('http') ? source : `${config.apiBase}${source.startsWith('/') ? '' : '/'}${source}`;
    const res = await fetch(url, { headers: stationHeaders(config) });
    if (!res.ok) throw new Error(`Label download failed: ${res.status}`);
    const filePath = path.join(downloadsDir(), `${job.id}.pdf`);
    fs.writeFileSync(filePath, Buffer.from(await res.arrayBuffer()));
    return filePath;
}

function printFile(filePath, printerName) {
    if (os.platform() === 'win32') {
        const command = printerName
            ? `Start-Process -FilePath '${escapePowerShell(filePath)}' -Verb PrintTo -ArgumentList '${escapePowerShell(printerName)}' -WindowStyle Hidden`
            : `Start-Process -FilePath '${escapePowerShell(filePath)}' -Verb Print -WindowStyle Hidden`;
        return execPromise('powershell.exe', ['-NoProfile', '-Command', command]);
    }
    return execPromise('lp', printerName ? ['-d', printerName, filePath] : [filePath]);
}

async function report(jobId, statusValue, errorMessage, config) {
    const res = await fetch(`${config.apiBase}/api/shipping/print-agent/jobs/${jobId}/result`, {
        method: 'POST',
        headers: { ...stationHeaders(config), 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: statusValue, errorMessage }),
    });
    if (!res.ok) throw new Error(`Result report failed: ${res.status} ${await res.text()}`);
}

function stationHeaders(config) {
    return {
        'x-print-station-id': config.stationId,
        'x-print-station-token': config.stationToken,
        'x-print-agent-version': AGENT_VERSION,
    };
}

function disconnectStation() {
    saveConfig({ stationId: '', stationToken: '' });
    lastPollError = '';
    lastJobMessage = 'Station disconnected';
    emitStatus();
}

async function printTestLabel() {
    const config = loadConfig();
    const filePath = path.join(app.getPath('userData'), 'test-label.pdf');
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    fs.writeFileSync(filePath, createTestPdf(), 'binary');
    await printFile(filePath, config.defaultPrinterName);
    lastJobMessage = `Printed test label to ${config.defaultPrinterName || 'system default printer'}`;
    log(lastJobMessage);
    emitStatus();
    return status();
}

function createTestPdf() {
    const lines = [
        '%PDF-1.4',
        '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
        '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
        '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 288 432] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj',
        '4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj',
    ];
    const text = [
        'BT',
        '/F1 24 Tf',
        '36 350 Td',
        '(OverSeek Test Label) Tj',
        '/F1 12 Tf',
        '0 -34 Td',
        `(${new Date().toISOString()}) Tj`,
        '0 -26 Td',
        '(If you can read this, the print agent can reach this printer.) Tj',
        'ET',
    ].join('\n');
    lines.push(`5 0 obj << /Length ${text.length} >> stream\n${text}\nendstream endobj`);
    const offsets = [];
    let pdf = '';
    for (const line of lines) {
        offsets.push(pdf.length);
        pdf += `${line}\n`;
    }
    const xrefOffset = pdf.length;
    pdf += `xref\n0 ${offsets.length + 1}\n0000000000 65535 f \n`;
    for (const offset of offsets) {
        pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
    }
    pdf += `trailer << /Size ${offsets.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
    return pdf;
}

function recentLogs() {
    const logPath = path.join(app.getPath('userData'), 'agent.log');
    if (!fs.existsSync(logPath)) return [];
    return fs.readFileSync(logPath, 'utf8').split(/\r?\n/).filter(Boolean).slice(-80);
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

function normalizeApiBase(value) {
    const apiBase = String(value || '').trim().replace(/\/+$/, '');
    if (!apiBase.startsWith('http://') && !apiBase.startsWith('https://')) {
        throw new Error('OverSeek address must start with http:// or https://');
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

function log(message) {
    const line = `[${new Date().toISOString()}] ${message}\n`;
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    fs.appendFileSync(path.join(app.getPath('userData'), 'agent.log'), line, 'utf8');
}

ipcMain.handle('agent:get-status', () => status());
ipcMain.handle('agent:list-printers', () => listPrinters());
ipcMain.handle('agent:disconnect', () => {
    disconnectStation();
    return status();
});
ipcMain.handle('agent:open-logs-folder', () => shell.openPath(app.getPath('userData')));
ipcMain.handle('agent:print-test-label', () => printTestLabel());
ipcMain.handle('agent:get-diagnostics', () => ({ status: status(), recentLogs: recentLogs() }));
ipcMain.handle('agent:login', async (_event, input) => {
    const apiBase = normalizeApiBase(input.apiBase);
    const login = await overseekFetch(apiBase, '/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: input.email, password: input.password, token: input.twoFactorToken || undefined }),
    });
    const accounts = await overseekFetch(apiBase, '/api/accounts', {
        headers: { Authorization: `Bearer ${login.token}` },
    });
    saveConfig({ apiBase });
    return { apiBase, token: login.token, accounts };
});
ipcMain.handle('agent:configure', async (_event, input) => {
    const apiBase = normalizeApiBase(input.apiBase);
    const stationName = String(input.stationName || os.hostname()).trim();
    const defaultPrinterName = String(input.defaultPrinterName || '').trim();
    if (!input.token || !input.accountId) throw new Error('Login and account selection are required');
    if (!stationName) throw new Error('Station name is required');

    const created = await overseekFetch(apiBase, '/api/shipping/print-stations', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${input.token}`,
            'Content-Type': 'application/json',
            'x-account-id': input.accountId,
        },
        body: JSON.stringify({ name: stationName, defaultPrinterName: defaultPrinterName || undefined }),
    });

    saveConfig({
        apiBase,
        stationId: created.printStation.id,
        stationToken: created.token,
        stationName,
        defaultPrinterName,
    });
    lastJobMessage = 'Station connected';
    emitStatus();
    return status();
});

app.whenReady().then(() => {
    app.setLoginItemSettings({ openAtLogin: true });
    createTray();
    createWindow();
    poll();

    if (process.env.PRINT_AGENT_SMOKE_TEST === '1') {
        setTimeout(() => {
            app.isQuitting = true;
            app.quit();
        }, 2500);
    }
});

app.on('activate', showWindow);
app.on('window-all-closed', (event) => event.preventDefault());
