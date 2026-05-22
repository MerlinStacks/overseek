let authToken = '';
let currentApiBase = '';

const byId = (id) => document.getElementById(id);

function setBusy(form, busy) {
    for (const element of form.querySelectorAll('button, input, select')) {
        element.disabled = busy;
    }
}

function renderStatus(status) {
    byId('statusPill').textContent = status.configured ? 'Connected' : 'Not connected';
    byId('statusPill').className = status.configured ? 'pill' : 'pill off';
    byId('apiBase').value = status.apiBase || byId('apiBase').value;
    byId('stationName').value = status.stationName || byId('stationName').value;
    byId('defaultPrinterName').value = status.defaultPrinterName || '';
    byId('stationStatus').textContent = status.configured ? `${status.stationName} (${status.stationId})` : 'Not assigned';
    byId('printerStatus').textContent = status.defaultPrinterName || 'System default';
    byId('lastPollAt').textContent = status.lastPollAt || '-';
    byId('lastJobMessage').textContent = status.lastJobMessage || '-';
    byId('lastPollError').textContent = status.lastPollError || '-';
}

async function refreshStatus() {
    renderStatus(await window.overseekAgent.getStatus());
    await refreshDiagnostics();
}

async function refreshDiagnostics() {
    const diagnostics = await window.overseekAgent.getDiagnostics();
    byId('diagnosticsBox').textContent = JSON.stringify(diagnostics, null, 2);
}

async function loadPrinters() {
    const printers = await window.overseekAgent.listPrinters();
    const select = byId('printerSelect');
    select.innerHTML = '<option value="">System default printer</option>';
    for (const printer of printers) {
        const option = document.createElement('option');
        option.value = printer;
        option.textContent = printer;
        select.appendChild(option);
    }
}

byId('printerSelect').addEventListener('change', () => {
    byId('defaultPrinterName').value = byId('printerSelect').value;
});

byId('loginForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
        setBusy(byId('loginForm'), true);
        const result = await window.overseekAgent.login({
            apiBase: byId('apiBase').value,
            email: byId('email').value,
            password: byId('password').value,
            twoFactorToken: byId('twoFactorToken').value,
        });
        authToken = result.token;
        currentApiBase = result.apiBase;
        const accountSelect = byId('accountId');
        accountSelect.innerHTML = '';
        for (const account of result.accounts || []) {
            const option = document.createElement('option');
            option.value = account.id;
            option.textContent = account.name + (account.domain ? ` (${account.domain})` : '');
            accountSelect.appendChild(option);
        }
        byId('configureBtn').disabled = !accountSelect.value;
    } catch (error) {
        alert(error.message);
    } finally {
        setBusy(byId('loginForm'), false);
    }
});

byId('configureForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
        byId('configureBtn').disabled = true;
        const status = await window.overseekAgent.configure({
            apiBase: currentApiBase || byId('apiBase').value,
            token: authToken,
            accountId: byId('accountId').value,
            stationName: byId('stationName').value,
            defaultPrinterName: byId('defaultPrinterName').value,
        });
        renderStatus(status);
        alert('This computer is assigned and ready to print.');
    } catch (error) {
        alert(error.message);
    } finally {
        byId('configureBtn').disabled = !authToken || !byId('accountId').value;
    }
});

byId('refreshBtn').addEventListener('click', refreshStatus);
byId('openLogsBtn').addEventListener('click', () => window.overseekAgent.openLogsFolder());
byId('testPrintBtn').addEventListener('click', async () => {
    try {
        byId('testPrintBtn').disabled = true;
        renderStatus(await window.overseekAgent.printTestLabel());
        await refreshDiagnostics();
        alert('Test label sent to printer.');
    } catch (error) {
        alert(error.message);
    } finally {
        byId('testPrintBtn').disabled = false;
    }
});
byId('disconnectBtn').addEventListener('click', async () => {
    if (!confirm('Disconnect this computer from OverSeek printing?')) return;
    renderStatus(await window.overseekAgent.disconnect());
});

window.overseekAgent.onStatus(renderStatus);
refreshStatus().catch((error) => alert(error.message));
loadPrinters().catch(() => {});
