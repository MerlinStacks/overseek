import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { db } from '../db/db';
import { useSettings } from './SettingsContext';
import { useAccount } from './AccountContext';
import axios from 'axios';
import { toast } from 'sonner';

const SyncContext = createContext();

export const useSync = () => useContext(SyncContext);

export const SyncProvider = ({ children }) => {
    const { settings } = useSettings();
    const { activeAccount } = useAccount();

    const [status, setStatus] = useState('idle'); // idle, running, error, complete
    const [progress, setProgress] = useState(0);
    const [task, setTask] = useState('');
    const [logs, setLogs] = useState([]);
    const [lastLiveSync, setLastLiveSync] = useState(null);
    const [lastFullSync, setLastFullSync] = useState(null);

    const pollInterval = useRef(null);

    // 1. Resume Sync on Load (If server is running)
    useEffect(() => {
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
            } catch (e) {
                // ignore
            }
        };
        checkServerStatus();

        return () => stopPolling();
    }, []);

    // 2. Polling
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
                        setProgress(100);
                        setTask('Completed (All Data Synced)');
                        setLastFullSync(new Date());
                        log('Sync Process Fully Completed', 'success');
                        setTimeout(() => setStatus('idle'), 5000);
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

    const stopPolling = () => {
        if (pollInterval.current) {
            clearInterval(pollInterval.current);
            pollInterval.current = null;
        }
    };

    const log = (message, type = 'info') => {
        setLogs(prev => [...prev, { timestamp: new Date(), message, type }]);
    };

    const cancelSync = () => {
        stopPolling();
        setStatus('idle');
        log('UI detached from Sync (Server process continues)', 'warning');
    };

    const startSync = async (forceFull = false, options = {}) => {
        if (status === 'running') return;
        if (!activeAccount) {
            log('No active account selected', 'error');
            return;
        }

        setStatus('running');
        setProgress(0);
        setLogs([]);

        try {
            await axios.post('/api/sync/start', {
                storeUrl: settings.storeUrl,
                consumerKey: settings.consumerKey,
                consumerSecret: settings.consumerSecret,
                authMethod: settings.authMethod, // Pass auth method
                accountId: activeAccount.id,
                options: {
                    products: options.products !== false,
                    orders: options.orders !== false,
                    reviews: options.reviews !== false,
                    customers: options.customers !== false,
                    coupons: options.coupons !== false,
                }
            });
            log('Sync initiated on server...', 'info');
            startPolling();
        } catch (e) {
            setStatus('error');
            log(e.response?.data?.error || e.message, 'error');
            stopPolling();
        }
    };

    // 3. Download from Server (Post-Processing)
    const downloadFromServer = async () => {
        if (!activeAccount) return;
        setTask('Downloading data to local device...');

        const entities = ['products', 'orders', 'reviews', 'customers', 'coupons'];

        for (const entity of entities) {
            try {
                // Fetch from Local Postgres (which was just synced)
                // Use a large limit or paginate. For MVP we use large limit (10k)
                const { data } = await axios.get(`/api/db/${entity}`, {
                    params: {
                        account_id: activeAccount.id,
                        limit: 10000
                    }
                });

                if (data.data && data.data.length > 0) {
                    // Normalize data for Dexie (add account_id if missing)
                    const rows = data.data.map(item => ({
                        ...item,
                        account_id: activeAccount.id,
                        // Ensure ID is unique per account for compound keys
                    }));

                    // Bulk Put (Upsert)
                    await db.table(entity).bulkPut(rows);
                    log(`Downloaded ${rows.length} ${entity}. Sample Account ID: ${rows[0].account_id}`, 'success');
                }
            } catch (e) {
                console.error(`Failed to download ${entity}`, e);
                log(`Failed to download ${entity}: ${e.message}`, 'error');
            }
        }
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
            } catch (e) {
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
