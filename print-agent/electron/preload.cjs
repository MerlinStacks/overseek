const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('overseekAgent', {
    getStatus: () => ipcRenderer.invoke('agent:get-status'),
    listPrinters: () => ipcRenderer.invoke('agent:list-printers'),
    login: (input) => ipcRenderer.invoke('agent:login', input),
    configure: (input) => ipcRenderer.invoke('agent:configure', input),
    disconnect: () => ipcRenderer.invoke('agent:disconnect'),
    openLogsFolder: () => ipcRenderer.invoke('agent:open-logs-folder'),
    printTestLabel: () => ipcRenderer.invoke('agent:print-test-label'),
    getDiagnostics: () => ipcRenderer.invoke('agent:get-diagnostics'),
    onStatus: (callback) => {
        const listener = (_event, status) => callback(status);
        ipcRenderer.on('agent:status', listener);
        return () => ipcRenderer.removeListener('agent:status', listener);
    },
});
