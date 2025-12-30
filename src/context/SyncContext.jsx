import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { db } from '../db/db';
import { useSettings } from './SettingsContext';
import { useAccount } from './AccountContext';
import axios from 'axios';
import { toast } from 'sonner';

const SyncContext = createContext();

// eslint-disable-next-line react-refresh/only-export-components
export const useSync = () => useContext(SyncContext);


export const SyncProvider = ({ children }) => {
    const { settings } = useSettings();
    const { activeAccount } = useAccount();

    const [status, setStatus] = useState('idle'); // idle, running, error, complete
    const [progress, setProgress] = useState(0);
    const [task, setTask] = useState('Idle');
    const [logs, setLogs] = useState([]);
    const [lastLiveSync, setLastLiveSync] = useState(null);
    const [lastFullSync, setLastFullSync] = useState(null);
    const [syncMode, setSyncMode] = useState('quick'); // 'quick' or 'full'

    const pollInterval = useRef(null);
    const workerRef = useRef(null);

    // 2. Logging Helper
    const log = (message, type = 'info') => {
        setLogs(prev => [...prev, { timestamp: new Date(), message, type }]);
    };

    const stopPolling = () => {
        if (pollInterval.current) {
            clearInterval(pollInterval.current);
            pollInterval.current = null;
        }
    };

    // 3. Polling
    const startPolling = () => {
        if (pollInterval.current) clearInterval(pollInterval.current);

        pollInterval.current = setInterval(async () => {
            try {
                const { data } = await axios.get('/api/sync/status');

                if (data.running) {
                    setProgress(data.progress);
                    setTask(`Syncing ${data.entity} (${data.details || ''})`);
                } else {
                    // Sync Stopped (Finished or Error)
                    stopPolling();
                    if (data.error) {
                        setStatus('error');
                        log(`Server Error: ${data.error}`, 'error');
                    } else if (data.progress === 100) {
                        // Sync Finished Server-Side, now Download
                        log('Server Sync Complete. Downloading...', 'info');
                        await downloadFromServer();

                        setStatus('complete');
                        // The actual 'complete' status and final logging will be handled by the worker's onmessage handler
                        // once the download is done.
                        // For now, we just set status to running for the download phase.
                        setStatus('running');
                        setTask('Downloading data to local device...');
                    } else {
                        // Stopped unexpectedly
                        setStatus('idle');
                    }
                }
            } catch (e) {
                console.warn("Poll Error:", e);
            }
        }, 2000);
    };

    // 1. Resume Sync on Load (If server is running)
    useEffect(() => {
        // Initialize Worker
        workerRef.current = new Worker(new URL('../workers/sync.worker.js', import.meta.url));

        workerRef.current.onmessage = (e) => {
            if (e.data.type === 'LOG') {
                log(e.data.message, e.data.level);
            } else if (e.data.type === 'PROGRESS') {
                setTask(e.data.task);
                setProgress(e.data.percentage);
            } else if (e.data.type === 'COMPLETE') {
                setStatus('complete'); // Simplified from original snippet
                setTask('Idle');
                if (e.data.newSyncTimes) {
                    Object.entries(e.data.newSyncTimes).forEach(([key, val]) => {
                        localStorage.setItem(key, val);
                    });
                    setLastFullSync(new Date());
                    log("Data download complete.", "success");
                }
            } else if (e.data.type === 'ERROR') {
                log(e.data.error, 'error');
                setStatus('error'); // Simplified from original snippet
                setTask('Error');
            }
        };

        const checkServerStatus = async () => {
            if (status === 'running') return;
            try {
                const { data } = await axios.get('/api/sync/status');
                if (data.running) {
                    console.log("Resuming Sync UI attachment...");
                    setStatus('running');
                    setTask(`Syncing ${data.entity}...`);
                    setProgress(data.progress);
                    startPolling();
                }
            } catch {
                // ignore
            }
        };
        checkServerStatus();

        return () => {
            stopPolling();
            if (workerRef.current) {
                workerRef.current.terminate();
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const cancelSync = () => {
        stopPolling();
        setStatus('idle');
        log('UI detached from Sync (Server process continues)', 'warning');
    };

    const startSync = async (options = { forceFull: false }) => {
        if (status.running) return;

        setSyncMode(options.forceFull ? 'full' : 'quick');
        if (!activeAccount) {
            log('No active account selected', 'error');
            return;
        }

        setStatus('running');
        setProgress(0);
        setLogs([]);

        try {
            // Note: We sync ALL entities by default now, incremental handles the filtering.
            await axios.post('/api/sync/start', {
                storeUrl: settings.storeUrl,
                consumerKey: settings.consumerKey,
                consumerSecret: settings.consumerSecret,
                authMethod: settings.authMethod || 'basic', // Default to basic
                accountId: parseInt(activeAccount.id, 10),
                options: {
                    products: options.products ?? true,
                    orders: options.orders ?? true,
                    reviews: options.reviews ?? true,
                    customers: options.customers ?? true,
                    coupons: options.coupons ?? true,
                    forceFull: options.forceFull, // Pass to server
                    autoTaggingRules: activeAccount.features?.autoTaggingRules || []
                }
            });
            log('Sync initiated on server...', 'info');
            startPolling();
        } catch (e) {
            setStatus('error');
            const errorMsg = e.response?.data?.error || e.response?.data?.message || e.message || 'Unknown error';
            const errorDetails = e.response?.data?.details || '';
            log(`Sync Failed: ${errorMsg} ${errorDetails}`, 'error');
            stopPolling();
        }
    };

    // 3. Download from Server (Post-Processing)
    const downloadFromServer = async (account = activeAccount, entitiesToDownload = ['products', 'orders', 'reviews', 'customers', 'coupons']) => {
        if (!account) return;
        setTask('Downloading data to local device...');

        // Gather last sync times for worker
        const lastSyncTimes = {};
        for (const entity of entitiesToDownload) {
            const key = `last_client_sync_${account.id}_${entity}`;
            lastSyncTimes[key] = localStorage.getItem(key);
        }

        // Delegate to Worker
        workerRef.current.postMessage({
            type: 'DOWNLOAD_DB',
            accountId: parseInt(account.id, 10),
            entities: entitiesToDownload,
            lastSyncTimes,
            forceFull: syncMode === 'full'
        });

        // Note: The 'startSync' function handles the Server-side trigger. 
        // This function is for "Client download". 
        // We rely on the Worker onmessage handler (already in useEffect) to handle progress/completion.
    };

    // Background Live Sync (Orders Only) - Kept for Real-Time notifications logic
    useEffect(() => {
        if (!settings.storeUrl || !settings.consumerKey || !activeAccount) return;

        const runSilentSync = async () => {
            if (status !== 'idle') return; // Don't poll if heavy sync is running

            try {
                const accountId = activeAccount.id;
                // Default to 1 day ago if no sync yet
                let lastSync = localStorage.getItem(`last_sync_orders_${accountId}`);
                if (!lastSync) {
                    lastSync = new Date(Date.now() - 86400000).toISOString();
                }

                const config = {
                    params: { after: lastSync, per_page: 20 },
                    headers: {}
                };

                if (settings.authMethod === 'query_string') {
                    config.params.consumer_key = settings.consumerKey;
                    config.params.consumer_secret = settings.consumerSecret;
                } else {
                    const authString = btoa(`${settings.consumerKey}:${settings.consumerSecret}`);
                    config.headers.Authorization = `Basic ${authString}`;
                }

                const res = await axios.get(`${settings.storeUrl}/wp-json/wc/v3/orders`, config);

                if (res.data && res.data.length > 0) {
                    const processed = res.data.map(order => ({
                        ...order,
                        total_tax: order.total_tax || 0,
                        account_id: accountId
                    }));

                    // Update Local Dexie for Automations
                    await db.orders.bulkPut(processed);

                    // Notify
                    const recentOrders = processed.filter(o => {
                        const created = new Date(o.date_created).getTime();
                        return (Date.now() - created) < 20000;
                    });

                    if (recentOrders.length > 0) {
                        recentOrders.forEach(o => {
                            toast.success(`💰 New Order #${o.id}: ${new Intl.NumberFormat('en-US', { style: 'currency', currency: o.currency }).format(o.total)}`);
                        });
                    }

                    const safeNextSync = new Date(Date.now() - 10000).toISOString();
                    localStorage.setItem(`last_sync_orders_${accountId}`, safeNextSync);
                    setLastLiveSync(new Date());
                } else {
                    const safeNextSync = new Date(Date.now() - 10000).toISOString();
                    localStorage.setItem(`last_sync_orders_${accountId}`, safeNextSync);
                    setLastLiveSync(new Date());
                }
            } catch {
                // Silent fail
            }
        };

        const intervalId = setInterval(runSilentSync, 5000); // Poll every 5s
        return () => clearInterval(intervalId);
    }, [settings, status, activeAccount]);

    return (
        <SyncContext.Provider value={{
            status,
            progress,
            task,
            logs,
            startSync,
            cancelSync,
            lastLiveSync,
            lastFullSync
        }}>
            {children}
        </SyncContext.Provider>
    );
};
