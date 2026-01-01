import { detectAuth, AuthMethod } from './client.js';
import { syncEntity, updateSyncState, getSyncState, EntityType } from './engine.js';
import { db } from '../db/index.js';

export interface SyncOptions {
    forceFull?: boolean;
    products?: boolean;
    orders?: boolean;
    reviews?: boolean;
    customers?: boolean;
    coupons?: boolean;
}

interface SyncStatus {
    running: boolean;
    progress: number;
    entity: string;
    details: string;
    error: string | null;
}

let currentStatus: SyncStatus = {
    running: false,
    progress: 0,
    entity: '',
    details: '',
    error: null
};

export const getStatus = () => currentStatus;

export const startSync = async (
    config: { storeUrl: string; consumerKey: string; consumerSecret: string; authMethod?: AuthMethod; accountId: number; options: SyncOptions }
) => {
    if (currentStatus.running) return;

    currentStatus = {
        running: true,
        progress: 0,
        entity: 'Initializing',
        details: 'Connecting...',
        error: null
    };

    try {
        const api = await detectAuth(config.storeUrl, config.consumerKey, config.consumerSecret, config.authMethod);

        const tasks: { key: EntityType; name: string }[] = [
            { key: 'products', name: 'Products' },
            { key: 'orders', name: 'Orders' },
            { key: 'reviews', name: 'Reviews' },
            { key: 'customers', name: 'Customers' },
            { key: 'coupons', name: 'Coupons' }
        ];

        const activeTasks = tasks.filter(t => config.options[t.key as keyof SyncOptions]);

        for (const task of activeTasks) {
            currentStatus.entity = task.name;
            currentStatus.progress = 0;

            let lastSynced = undefined;
            if (!config.options.forceFull) {
                const date = await getSyncState(config.accountId, task.key);
                if (date) lastSynced = date;
            }

            currentStatus.details = lastSynced ? `Checking updates since ${lastSynced.toLocaleTimeString()}...` : 'Performing Full Sync...';

            await syncEntity(api, task.key, config.accountId, (page, total) => {
                currentStatus.progress = Math.round((page / total) * 100);
                currentStatus.details = `Page ${page} of ${total}`;
            }, lastSynced);

            await updateSyncState(config.accountId, task.key, new Date());
        }

        currentStatus.running = false;
        currentStatus.entity = 'Complete';
        currentStatus.progress = 100;
        currentStatus.details = 'Finished Successfully';

    } catch (err: any) {
        console.error("Sync Error:", err);
        currentStatus.running = false;
        currentStatus.error = err.message || 'Unknown Error';
        currentStatus.details = `Failed at ${currentStatus.entity}`;
    }
};
