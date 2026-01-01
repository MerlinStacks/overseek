import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { db } from '../db/db';
import { useSettings } from './SettingsContext';
import { useAccount } from './AccountContext';
import axios from 'axios';
import { toast } from 'sonner';

interface SyncContextType {
    status: 'idle' | 'running' | 'error' | 'complete';
    progress: number;
    task: string;
    logs: LogEntry[];
    startSync: (options?: { forceFull?: boolean, products?: boolean, orders?: boolean, reviews?: boolean, customers?: boolean, coupons?: boolean }) => Promise<void>;
    cancelSync: () => void;
    lastLiveSync: Date | null;
    lastFullSync: Date | null;
}

interface LogEntry {
    timestamp: Date;
    message: string;
    type: 'info' | 'error' | 'success' | 'warning';
}

const SyncContext = createContext<SyncContextType | null>(null);

// eslint-disable-next-line react-refresh/only-export-components
export const useSync = () => {
    const context = useContext(SyncContext);
    if (!context) throw new Error("useSync must be used within SyncProvider");
    return context;
};

export const SyncProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { settings } = useSettings();
    const { activeAccount } = useAccount();

    const [status, setStatus] = useState<'idle' | 'running' | 'error' | 'complete'>('idle');
    const [progress, setProgress] = useState(0);
    const [task, setTask] = useState('Idle');
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [lastLiveSync, setLastLiveSync] = useState<Date | null>(null);
    const [lastFullSync, setLastFullSync] = useState<Date | null>(null);
    const [syncMode, setSyncMode] = useState<'quick' | 'full'>('quick');

    const pollInterval = useRef<NodeJS.Timeout | null>(null);
    const workerRef = useRef<Worker | null>(null);

    // Logging Helper
    const log = (message: string, type: 'info' | 'error' | 'success' | 'warning' = 'info') => {
        setLogs(prev => [...prev, { timestamp: new Date(), message, type }]);
    };

    const stopPolling = () => {
        if (pollInterval.current) {
            clearInterval(pollInterval.current);
            pollInterval.current = null;
        }
    };

    // Polling
    const startPolling = () => {
        if (pollInterval.current) clearInterval(pollInterval.current);

        pollInterval.current = setInterval(async () => {
            try {
                const { data } = await axios.get('/api/sync/status', { withCredentials: true });

                if (data.running) {
                    setProgress(data.progress);
                    setTask(`Syncing ${data.entity} (${data.details || ''})`);
                } else {
                    stopPolling();
                    if (data.error) {
                        setStatus('error');
                        log(`Server Error: ${data.error}`, 'error');
                    } else if (data.progress === 100) {
                        log('Server Sync Complete. Downloading...', 'info');
                        await downloadFromServer();
                        setStatus('running'); // Keep as running during download
                        setTask('Downloading data to local device...');
                    } else {
                        setStatus('idle');
                    }
                }
            } catch (e) {
                console.warn("Poll Error:", e);
            }
        }, 2000);
    };

    // Resume Sync on Load
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
                setStatus('complete');
                setTask('Idle');
                if (e.data.newSyncTimes) {
                    Object.entries(e.data.newSyncTimes).forEach(([key, val]) => {
                        localStorage.setItem(key, val as string);
                    });
                    setLastFullSync(new Date());
                    log("Data download complete.", "success");
                }
            } else if (e.data.type === 'ERROR') {
                log(e.data.error, 'error');
                setStatus('error');
                setTask('Error');
            }
        };

        const checkServerStatus = async () => {
            if (status === 'running') return;
            try {
                const { data } = await axios.get('/api/sync/status', { withCredentials: true });
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

    const startSync = async (options: { forceFull?: boolean, products?: boolean, orders?: boolean, reviews?: boolean, customers?: boolean, coupons?: boolean } = {}) => {
        if (status === 'running') return;

        setSyncMode(options.forceFull ? 'full' : 'quick');
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
                authMethod: settings.authMethod || 'basic',
                accountId: activeAccount.id,
                options: {
                    products: options.products ?? true,
                    orders: options.orders ?? true,
                    reviews: options.reviews ?? true,
                    customers: options.customers ?? true,
                    coupons: options.coupons ?? true,
                    forceFull: options.forceFull,
                    autoTaggingRules: activeAccount.features?.autoTaggingRules || []
                }
            }, { withCredentials: true });
            log('Sync initiated on server...', 'info');
            startPolling();
        } catch (e: any) {
            setStatus('error');
            const errorMsg = e.response?.data?.error || e.response?.data?.message || e.message || 'Unknown error';
            log(`Sync Failed: ${errorMsg}`, 'error');
            stopPolling();
        }
    };

    const downloadFromServer = async (account = activeAccount, entitiesToDownload = ['products', 'orders', 'reviews', 'customers', 'coupons']) => {
        if (!account || !workerRef.current) return;
        setTask('Downloading data to local device...');

        const lastSyncTimes: Record<string, string | null> = {};
        for (const entity of entitiesToDownload) {
            const key = `last_client_sync_${account.id}_${entity}`;
            lastSyncTimes[key] = localStorage.getItem(key);
        }

        workerRef.current.postMessage({
            type: 'DOWNLOAD_DB',
            accountId: account.id,
            entities: entitiesToDownload,
            lastSyncTimes,
            forceFull: syncMode === 'full'
        });
    };

    // Background Live Sync (Orders Only) - REFACTORED to use Proxy
    useEffect(() => {
        // Require active account, but NOT keys in settings necessarily (backend might have them)
        if (!activeAccount) return;

        const runSilentSync = async () => {
            if (status !== 'idle') return;

            try {
                // We send keys if we have them to support migration, 
                // but rely on /latest-orders to handle the auth
                const payload: any = {
                    storeId: activeAccount.id,
                };

                // If settings exist locally, send them as fallback
                if (settings.storeUrl && settings.consumerKey && settings.consumerSecret) {
                    payload.keys = {
                        url: settings.storeUrl,
                        consumerKey: settings.consumerKey,
                        consumerSecret: settings.consumerSecret,
                        authMethod: settings.authMethod
                    }
                }

                const res = await axios.post('/api/sync/latest-orders', payload, { withCredentials: true });

                // Processing logic remains similar but uses the proxied response
                if (res.data && res.data.orders && res.data.orders.length > 0) {
                    const orders = res.data.orders;
                    const processed = orders.map((order: any) => ({
                        ...order,
                        total_tax: order.total_tax || 0,
                        account_id: activeAccount.id
                    }));

                    await db.orders.bulkPut(processed);

                    const recentOrders = processed.filter((o: any) => {
                        const created = new Date(o.date_created).getTime();
                        return (Date.now() - created) < 20000;
                    });

                    if (recentOrders.length > 0) {
                        recentOrders.forEach((o: any) => {
                            toast.success(`💰 New Order #${o.id}: ${new Intl.NumberFormat('en-US', { style: 'currency', currency: o.currency }).format(o.total)}`);
                        });
                    }

                    // Log success logic?
                    setLastLiveSync(new Date());
                } else {
                    setLastLiveSync(new Date());
                }

            } catch (e) {
                // Silent fail
                // console.warn("Live sync failed", e);
            }
        };

        const intervalId = setInterval(runSilentSync, 5000);
        return () => clearInterval(intervalId);
    }, [activeAccount, settings, status]); // Dependencies updated

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
