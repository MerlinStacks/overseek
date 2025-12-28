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
    const [progress, setProgress] = useState(0); // 0 to 100
    const [task, setTask] = useState(''); // e.g., "Syncing Products"
    const [logs, setLogs] = useState([]); // Array of log messages/errors
    const [lastLiveSync, setLastLiveSync] = useState(null); // Timestamp of last successful poll

    const workerRef = useRef(null);

    // Cancel sync if account changes
    useEffect(() => {
        if (status === 'running') {
            cancelSync();
        }
        setLogs([]);
        setProgress(0);
        setStatus('idle');
    }, [activeAccount]);

    // Cleanup worker on unmount
    useEffect(() => {
        return () => {
            if (workerRef.current) {
                workerRef.current.terminate();
            }
        };
    }, []);

    const log = (message, type = 'info') => {
        setLogs(prev => [...prev, { timestamp: new Date(), message, type }]);
    };

    const cancelSync = () => {
        if (workerRef.current) {
            workerRef.current.terminate();
            workerRef.current = null;
        }
        setStatus('idle');
        setProgress(0);
        setTask('');
        log('Sync cancelled by user', 'warning');
    };

    const startSync = async (forceFull = false, options = {}) => {
        if (status === 'running') return;
        if (!activeAccount) {
            log('No active account selected', 'error');
            return;
        }

        // Default options
        const shouldSync = {
            products: options.products !== false,
            orders: options.orders !== false,
            taxes: options.taxes !== false,
            customers: options.customers !== false,
            reviews: options.reviews !== false,
        };

        setStatus('running');
        setProgress(0);
        setLogs([]);

        // Terminate existing worker if any
        if (workerRef.current) {
            workerRef.current.terminate();
        }

        const accountId = activeAccount.id;
        const mode = forceFull ? 'Full' : 'Delta';
        log(`Starting ${mode} sync for ${activeAccount.name}...`);

        // Prepare Last Sync Times
        const lastSyncTimes = {
            products: localStorage.getItem(`last_sync_products_${accountId}`),
            orders: localStorage.getItem(`last_sync_orders_${accountId}`),
            customers: localStorage.getItem(`last_sync_customers_${accountId}`),
            reviews: localStorage.getItem(`last_sync_reviews_${accountId}`)
        };

        // Initialize Worker
        try {
            workerRef.current = new Worker(new URL('../workers/sync.worker.js', import.meta.url), { type: 'module' });

            workerRef.current.onmessage = (e) => {
                const msg = e.data;

                if (msg.type === 'LOG') {
                    log(msg.message, msg.level);
                } else if (msg.type === 'PROGRESS') {
                    setTask(msg.task);
                    setProgress(msg.percentage);
                } else if (msg.type === 'COMPLETE') {
                    setStatus('complete');
                    log('Sync completed successfully', 'success');

                    // Update LocalStorage with new timestamps
                    if (msg.newSyncTimes) {
                        if (shouldSync.products) localStorage.setItem(`last_sync_products_${accountId}`, msg.newSyncTimes.products);
                        if (shouldSync.orders) localStorage.setItem(`last_sync_orders_${accountId}`, msg.newSyncTimes.orders);
                        if (shouldSync.customers) localStorage.setItem(`last_sync_customers_${accountId}`, msg.newSyncTimes.customers);
                        if (shouldSync.reviews) localStorage.setItem(`last_sync_reviews_${accountId}`, msg.newSyncTimes.reviews);
                    }

                    setTimeout(() => setStatus('idle'), 5000);
                    workerRef.current.terminate();
                    workerRef.current = null;
                } else if (msg.type === 'ERROR') {
                    setStatus('error');
                    log(msg.error, 'error');
                    workerRef.current.terminate();
                    workerRef.current = null;
                }
            };

            workerRef.current.onerror = (err) => {
                setStatus('error');
                log(`Worker Error: ${err.message}`, 'error');
                console.error(err);
            };

            // Start the Worker
            workerRef.current.postMessage({
                type: 'START',
                config: {
                    storeUrl: settings.storeUrl,
                    consumerKey: settings.consumerKey,
                    consumerSecret: settings.consumerSecret
                },
                accountId,
                options: shouldSync,
                lastSyncTimes,
                forceFull
            });

        } catch (e) {
            setStatus('error');
            log(`Failed to start worker: ${e.message}`, 'error');
            console.error(e);
        }
    };

    // Background Live Sync (Orders Only)
    useEffect(() => {
        if (!settings.storeUrl || !settings.consumerKey || !activeAccount) return;

        const runSilentSync = async () => {
            if (status !== 'idle') return; // Don't poll if heavy sync is running

            try {
                const accountId = activeAccount.id;
                // Default to 1 day ago if no sync yet, to ensure we catch recent activity
                let lastSync = localStorage.getItem(`last_sync_orders_${accountId}`);
                if (!lastSync) {
                    lastSync = new Date(Date.now() - 86400000).toISOString();
                }

                const authString = btoa(`${settings.consumerKey}:${settings.consumerSecret}`);
                const res = await axios.get(`${settings.storeUrl}/wp-json/wc/v3/orders`, {
                    params: { after: lastSync, per_page: 20 },
                    headers: { Authorization: `Basic ${authString}` }
                });

                if (res.data && res.data.length > 0) {
                    const processed = res.data.map(order => ({
                        ...order,
                        total_tax: order.total_tax || 0,
                        account_id: accountId
                    }));
                    await db.orders.bulkPut(processed);

                    // Notify for NEW orders (compare against DB or just notify for batch)
                    // For simplicity, if we pulled data in a live sync, it's likely new or updated.
                    // We can check if the order creation time is very recent to distinguish "new" vs "update"
                    const recentOrders = processed.filter(o => {
                        const created = new Date(o.date_created).getTime();
                        const now = Date.now();
                        return (now - created) < 20000; // Created in last 20s
                    });

                    if (recentOrders.length > 0) {
                        recentOrders.forEach(o => {
                            toast.success(`💰 New Order #${o.id}: ${new Intl.NumberFormat('en-US', { style: 'currency', currency: o.currency }).format(o.total)}`, {
                                duration: 5000,
                            });
                        });
                    }

                    // Update timestamp (With 10s overlap buffer for safety)
                    const safeNextSync = new Date(Date.now() - 10000).toISOString();
                    localStorage.setItem(`last_sync_orders_${accountId}`, safeNextSync);

                    setLastLiveSync(new Date());
                    console.log(`Live Sync: Fetched ${res.data.length} orders.`);
                } else {
                    // Update timestamp even if empty, to advance the window
                    const safeNextSync = new Date(Date.now() - 10000).toISOString();
                    localStorage.setItem(`last_sync_orders_${accountId}`, safeNextSync);
                    setLastLiveSync(new Date());
                }
            } catch (e) {
                // Silent fail
                console.error("Live Sync Fail", e);
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
            lastLiveSync
        }}>
            {children}
        </SyncContext.Provider>
    );
};
