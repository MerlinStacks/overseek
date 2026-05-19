#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { execFile } = require('child_process');

const ENV_PATH = path.join(__dirname, '.env');
loadEnv(ENV_PATH);

const AGENT_VERSION = process.env.PRINT_AGENT_VERSION || '0.1.0';
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 5000);
const UI_PORT = Number(process.env.PRINT_AGENT_UI_PORT || 8787);

let API_BASE = process.env.OVERSEEK_API_BASE || 'http://localhost:3000';
let STATION_ID = process.env.PRINT_STATION_ID || '';
let STATION_TOKEN = process.env.PRINT_STATION_TOKEN || '';
let STATION_NAME = process.env.PRINT_STATION_NAME || os.hostname();
let DEFAULT_PRINTER_NAME = process.env.DEFAULT_PRINTER_NAME || '';
let DOWNLOAD_DIR = path.resolve(__dirname, process.env.DOWNLOAD_DIR || './downloads');
let lastPollAt = null;
let lastPollError = '';
let lastJobMessage = '';
let isPolling = false;

fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

function hasStationConfig() {
    return Boolean(STATION_ID && STATION_TOKEN);
}

async function poll() {
    if (isPolling) return;
    isPolling = true;
    try {
        if (!hasStationConfig()) return;
        lastPollAt = new Date().toISOString();
        const res = await fetch(`${API_BASE}/api/shipping/print-agent/jobs`, {
            headers: stationHeaders(),
        });
        if (!res.ok) throw new Error(`Job poll failed: ${res.status} ${await res.text()}`);
        const payload = await res.json();
        lastPollError = '';
        for (const job of payload.jobs || []) {
            await handleJob(job);
        }
    } catch (error) {
        lastPollError = error.message;
        console.error('[print-agent] Poll failed:', error.message);
    } finally {
        isPolling = false;
        setTimeout(poll, POLL_INTERVAL_MS);
    }
}

async function handleJob(job) {
    try {
        if (!job.labelDownloadPath && !job.labelFilePath) throw new Error('Label download path missing');
        const filePath = await downloadLabel(job);
        await printFile(filePath, job.printerName || DEFAULT_PRINTER_NAME);
        await report(job.id, 'printed');
        lastJobMessage = `Printed job ${job.id}`;
        console.log(`[print-agent] Printed job ${job.id}`);
    } catch (error) {
        await report(job.id, 'failed', error.message);
        lastJobMessage = `Failed job ${job.id}: ${error.message}`;
        console.error(`[print-agent] Failed job ${job.id}:`, error.message);
    }
}

async function downloadLabel(job) {
    const source = String(job.labelDownloadPath || job.labelFilePath);
    const url = source.startsWith('http') ? source : `${API_BASE}${source.startsWith('/') ? '' : '/'}${source}`;
    const res = await fetch(url, { headers: stationHeaders() });
    if (!res.ok) throw new Error(`Label download failed: ${res.status}`);
    const arrayBuffer = await res.arrayBuffer();
    const filePath = path.join(DOWNLOAD_DIR, `${job.id}.pdf`);
    fs.writeFileSync(filePath, Buffer.from(arrayBuffer));
    return filePath;
}

function printFile(filePath, printerName) {
    const platform = os.platform();
    if (platform === 'win32') {
        return execPromise('powershell.exe', [
            '-NoProfile',
            '-Command',
            printerName
                ? `Start-Process -FilePath '${escapePowerShell(filePath)}' -Verb PrintTo -ArgumentList '${escapePowerShell(printerName)}' -WindowStyle Hidden`
                : `Start-Process -FilePath '${escapePowerShell(filePath)}' -Verb Print -WindowStyle Hidden`,
        ]);
    }
    const args = printerName ? ['-d', printerName, filePath] : [filePath];
    return execPromise('lp', args);
}

async function report(jobId, status, errorMessage) {
    const res = await fetch(`${API_BASE}/api/shipping/print-agent/jobs/${jobId}/result`, {
        method: 'POST',
        headers: { ...stationHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, errorMessage }),
    });
    if (!res.ok) throw new Error(`Result report failed: ${res.status} ${await res.text()}`);
}

function stationHeaders() {
    return {
        'x-print-station-id': STATION_ID,
        'x-print-station-token': STATION_TOKEN,
        'x-print-agent-version': AGENT_VERSION,
    };
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

function loadEnv(filePath) {
    if (!fs.existsSync(filePath)) return;
    const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const index = trimmed.indexOf('=');
        if (index === -1) continue;
        const key = trimmed.slice(0, index).trim();
        const value = trimmed.slice(index + 1).trim();
        if (!process.env[key]) process.env[key] = value;
    }
}

function saveConfig(next) {
    API_BASE = next.apiBase || API_BASE;
    STATION_ID = next.stationId || '';
    STATION_TOKEN = next.stationToken || '';
    STATION_NAME = next.stationName || STATION_NAME || os.hostname();
    DEFAULT_PRINTER_NAME = next.defaultPrinterName || '';
    DOWNLOAD_DIR = path.resolve(__dirname, next.downloadDir || './downloads');
    fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

    const values = {
        OVERSEEK_API_BASE: API_BASE,
        PRINT_STATION_ID: STATION_ID,
        PRINT_STATION_TOKEN: STATION_TOKEN,
        PRINT_STATION_NAME: STATION_NAME,
        PRINT_AGENT_VERSION: AGENT_VERSION,
        POLL_INTERVAL_MS,
        DOWNLOAD_DIR: path.relative(__dirname, DOWNLOAD_DIR) || '.',
        DEFAULT_PRINTER_NAME,
        PRINT_AGENT_UI_PORT: UI_PORT,
    };
    const contents = Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n') + '\n';
    fs.writeFileSync(ENV_PATH, contents, 'ascii');
}

function clearStationConfig() {
    saveConfig({
        apiBase: API_BASE,
        stationId: '',
        stationToken: '',
        stationName: STATION_NAME,
        defaultPrinterName: DEFAULT_PRINTER_NAME,
        downloadDir: path.relative(__dirname, DOWNLOAD_DIR) || './downloads',
    });
}

function localStatus() {
    return {
        configured: hasStationConfig(),
        apiBase: API_BASE,
        stationId: STATION_ID,
        stationName: STATION_NAME,
        defaultPrinterName: DEFAULT_PRINTER_NAME,
        agentVersion: AGENT_VERSION,
        pollIntervalMs: POLL_INTERVAL_MS,
        downloadDir: DOWNLOAD_DIR,
        lastPollAt,
        lastPollError,
        lastJobMessage,
        uiUrl: `http://localhost:${UI_PORT}`,
    };
}

async function listPrinters() {
    try {
        if (os.platform() === 'win32') {
            const output = await execPromise('powershell.exe', ['-NoProfile', '-Command', 'Get-Printer | Select-Object -ExpandProperty Name']);
            return output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
        }
        const output = await execPromise('lpstat', ['-a']);
        return output.split(/\r?\n/).map((line) => line.trim().split(/\s+/)[0]).filter(Boolean);
    } catch (error) {
        return [];
    }
}

async function readJson(request) {
    return new Promise((resolve, reject) => {
        let body = '';
        request.on('data', (chunk) => {
            body += chunk;
            if (body.length > 1024 * 1024) {
                reject(new Error('Request body too large'));
                request.destroy();
            }
        });
        request.on('end', () => {
            try {
                resolve(body ? JSON.parse(body) : {});
            } catch (error) {
                reject(new Error('Invalid JSON'));
            }
        });
        request.on('error', reject);
    });
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

async function handleLocalApi(request, response, pathname) {
    if (request.method === 'GET' && pathname === '/api/status') {
        return sendJson(response, 200, localStatus());
    }

    if (request.method === 'GET' && pathname === '/api/printers') {
        return sendJson(response, 200, { printers: await listPrinters() });
    }

    if (request.method === 'POST' && pathname === '/api/login') {
        const body = await readJson(request);
        const apiBase = normalizeApiBase(body.apiBase || API_BASE);
        const login = await overseekFetch(apiBase, '/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: body.email, password: body.password, token: body.twoFactorToken || undefined }),
        });
        const accounts = await overseekFetch(apiBase, '/api/accounts', {
            headers: { Authorization: `Bearer ${login.token}` },
        });
        return sendJson(response, 200, { token: login.token, apiBase, accounts });
    }

    if (request.method === 'POST' && pathname === '/api/configure') {
        const body = await readJson(request);
        const apiBase = normalizeApiBase(body.apiBase || API_BASE);
        const stationName = String(body.stationName || os.hostname()).trim();
        const defaultPrinterName = String(body.defaultPrinterName || '').trim();
        if (!body.token || !body.accountId) throw new Error('Login token and account are required');
        if (!stationName) throw new Error('Station name is required');

        const created = await overseekFetch(apiBase, '/api/shipping/print-stations', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${body.token}`,
                'Content-Type': 'application/json',
                'x-account-id': body.accountId,
            },
            body: JSON.stringify({ name: stationName, defaultPrinterName: defaultPrinterName || undefined }),
        });

        saveConfig({
            apiBase,
            stationId: created.printStation.id,
            stationToken: created.token,
            stationName,
            defaultPrinterName,
            downloadDir: './downloads',
        });

        return sendJson(response, 200, { status: localStatus() });
    }

    if (request.method === 'POST' && pathname === '/api/disconnect') {
        clearStationConfig();
        return sendJson(response, 200, { status: localStatus() });
    }

    return sendJson(response, 404, { error: 'Not found' });
}

function normalizeApiBase(value) {
    const apiBase = String(value || '').trim().replace(/\/+$/, '');
    if (!apiBase.startsWith('http://') && !apiBase.startsWith('https://')) {
        throw new Error('OverSeek URL must start with http:// or https://');
    }
    return apiBase;
}

function sendJson(response, status, payload) {
    response.writeHead(status, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(payload));
}

function sendHtml(response) {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(renderUi());
}

function startUi() {
    const server = http.createServer(async (request, response) => {
        try {
            const url = new URL(request.url || '/', `http://localhost:${UI_PORT}`);
            if (url.pathname.startsWith('/api/')) {
                await handleLocalApi(request, response, url.pathname);
                return;
            }
            sendHtml(response);
        } catch (error) {
            sendJson(response, 400, { error: error.message });
        }
    });

    server.listen(UI_PORT, '127.0.0.1', () => {
        console.log(`[print-agent] UI available at http://localhost:${UI_PORT}`);
    });
}

function renderUi() {
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>OverSeek Print Agent</title>
  <style>
    :root { color-scheme: light dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; min-height: 100vh; background: linear-gradient(135deg, #eef2ff, #f8fafc 45%, #e0f2fe); color: #0f172a; }
    main { max-width: 920px; margin: 0 auto; padding: 32px 18px; }
    .hero { display: grid; gap: 12px; margin-bottom: 20px; }
    h1 { margin: 0; font-size: clamp(30px, 5vw, 52px); letter-spacing: -0.05em; }
    p { color: #475569; line-height: 1.55; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; }
    .card { background: rgba(255,255,255,0.82); border: 1px solid rgba(148,163,184,0.35); border-radius: 22px; padding: 20px; box-shadow: 0 20px 60px rgba(15,23,42,0.11); backdrop-filter: blur(18px); }
    label { display: grid; gap: 6px; margin: 12px 0; font-weight: 700; font-size: 13px; color: #334155; }
    input, select { width: 100%; box-sizing: border-box; border: 1px solid #cbd5e1; border-radius: 12px; padding: 12px; font: inherit; background: white; color: #0f172a; }
    button { border: 0; border-radius: 12px; padding: 12px 14px; font-weight: 800; cursor: pointer; background: #4f46e5; color: white; }
    button.secondary { background: #0f172a; }
    button.danger { background: #dc2626; }
    button:disabled { opacity: 0.55; cursor: not-allowed; }
    .row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
    .pill { display: inline-flex; align-items: center; border-radius: 999px; padding: 6px 10px; font-weight: 800; font-size: 12px; background: #e0e7ff; color: #3730a3; }
    .pill.off { background: #fee2e2; color: #991b1b; }
    pre { overflow: auto; white-space: pre-wrap; background: #020617; color: #dbeafe; border-radius: 14px; padding: 14px; }
    .muted { color: #64748b; font-size: 13px; }
    @media (prefers-color-scheme: dark) { body { background: linear-gradient(135deg, #020617, #111827 45%, #172554); color: #e5e7eb; } .card { background: rgba(15,23,42,0.82); border-color: rgba(71,85,105,0.6); } p, .muted { color: #94a3b8; } label { color: #cbd5e1; } input, select { background: #020617; border-color: #334155; color: #e5e7eb; } }
  </style>
</head>
<body>
  <main>
    <section class="hero">
      <span class="pill" id="statusPill">Loading</span>
      <h1>OverSeek Print Agent</h1>
      <p>Connect this computer to an OverSeek account, choose a printer, and keep label printing running in the background.</p>
    </section>
    <section class="grid">
      <div class="card">
        <h2>1. Login</h2>
        <label>OverSeek URL <input id="apiBase" value="${escapeHtml(API_BASE)}" placeholder="https://your-overseek-url"></label>
        <label>Email <input id="email" type="email" autocomplete="username"></label>
        <label>Password <input id="password" type="password" autocomplete="current-password"></label>
        <label>2FA code, if enabled <input id="twoFactorToken" inputmode="numeric"></label>
        <button id="loginBtn">Login and Load Accounts</button>
      </div>
      <div class="card">
        <h2>2. Assign Station</h2>
        <label>Account <select id="accountId"><option value="">Login first</option></select></label>
        <label>Station name <input id="stationName" value="${escapeHtml(STATION_NAME)}"></label>
        <label>Printer <select id="printerSelect"><option value="">System default printer</option></select></label>
        <label>Or printer name <input id="defaultPrinterName" value="${escapeHtml(DEFAULT_PRINTER_NAME)}" placeholder="Exact printer name"></label>
        <button id="configureBtn" disabled>Assign This Computer</button>
      </div>
      <div class="card">
        <h2>Status</h2>
        <pre id="statusBox">Loading...</pre>
        <div class="row">
          <button class="secondary" id="refreshBtn">Refresh</button>
          <button class="danger" id="disconnectBtn">Disconnect</button>
        </div>
        <p class="muted">The login token is only held in this browser page while assigning the station. The agent stores the print station token after setup.</p>
      </div>
    </section>
  </main>
  <script>
    let authToken = '';
    let currentApiBase = '';
    const byId = (id) => document.getElementById(id);

    async function api(path, options) {
      const res = await fetch(path, options);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Request failed');
      return data;
    }

    async function refreshStatus() {
      const status = await api('/api/status');
      byId('statusBox').textContent = JSON.stringify(status, null, 2);
      byId('statusPill').textContent = status.configured ? 'Connected' : 'Not connected';
      byId('statusPill').className = status.configured ? 'pill' : 'pill off';
      byId('apiBase').value = status.apiBase || byId('apiBase').value;
      byId('stationName').value = status.stationName || byId('stationName').value;
      byId('defaultPrinterName').value = status.defaultPrinterName || '';
    }

    async function loadPrinters() {
      const data = await api('/api/printers');
      const select = byId('printerSelect');
      select.innerHTML = '<option value="">System default printer</option>';
      for (const printer of data.printers || []) {
        const option = document.createElement('option');
        option.value = printer;
        option.textContent = printer;
        select.appendChild(option);
      }
    }

    byId('printerSelect').addEventListener('change', () => {
      byId('defaultPrinterName').value = byId('printerSelect').value;
    });

    byId('loginBtn').addEventListener('click', async () => {
      try {
        byId('loginBtn').disabled = true;
        const data = await api('/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            apiBase: byId('apiBase').value,
            email: byId('email').value,
            password: byId('password').value,
            twoFactorToken: byId('twoFactorToken').value,
          }),
        });
        authToken = data.token;
        currentApiBase = data.apiBase;
        const select = byId('accountId');
        select.innerHTML = '';
        for (const account of data.accounts || []) {
          const option = document.createElement('option');
          option.value = account.id;
          option.textContent = account.name + (account.domain ? ' (' + account.domain + ')' : '');
          select.appendChild(option);
        }
        byId('configureBtn').disabled = !select.value;
      } catch (error) {
        alert(error.message);
      } finally {
        byId('loginBtn').disabled = false;
      }
    });

    byId('configureBtn').addEventListener('click', async () => {
      try {
        byId('configureBtn').disabled = true;
        await api('/api/configure', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            apiBase: currentApiBase || byId('apiBase').value,
            token: authToken,
            accountId: byId('accountId').value,
            stationName: byId('stationName').value,
            defaultPrinterName: byId('defaultPrinterName').value,
          }),
        });
        await refreshStatus();
        alert('Print agent assigned and running.');
      } catch (error) {
        alert(error.message);
      } finally {
        byId('configureBtn').disabled = !authToken || !byId('accountId').value;
      }
    });

    byId('disconnectBtn').addEventListener('click', async () => {
      if (!confirm('Disconnect this print agent from OverSeek?')) return;
      await api('/api/disconnect', { method: 'POST' });
      await refreshStatus();
    });

    byId('refreshBtn').addEventListener('click', refreshStatus);
    refreshStatus().catch((error) => byId('statusBox').textContent = error.message);
    loadPrinters().catch(() => {});
  </script>
</body>
</html>`;
}

function escapeHtml(value) {
    return String(value).replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));
}

console.log(`[print-agent] Starting against ${API_BASE}`);
if (!hasStationConfig()) {
    console.log('[print-agent] No station assigned yet. Open the local UI to connect this computer.');
}
startUi();
poll();
