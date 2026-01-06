/**
 * useHotCache Hook
 * 
 * Provides cache-first fetching with background refresh for Hot Tier data.
 */

import { useState, useEffect, useCallback } from 'react';
import { useAccount } from '../context/AccountContext';
import { useAuth } from '../context/AuthContext';
import {
    hotTierDB,
    CachedOrder,
    CachedProduct,
    CachedCustomer,
    getLastSyncTime,
    setLastSyncTime,
    pruneTable
} from '../services/db';
import { api } from '../services/api';

interface UseHotCacheOptions {
    forceRefresh?: boolean;
    staleTime?: number; // How old data can be before refetching (ms)
}

const DEFAULT_STALE_TIME = 5 * 60 * 1000; // 5 minutes

/**
 * Hook for caching products with background refresh
 */
export function useHotProducts(options: UseHotCacheOptions = {}) {
    const { currentAccount } = useAccount();
    const { token } = useAuth();
    const [products, setProducts] = useState<CachedProduct[]>([]);
    const [loading, setLoading] = useState(true);
    const [syncing, setSyncing] = useState(false);

    const accountId = currentAccount?.id;
    const { forceRefresh = false, staleTime = DEFAULT_STALE_TIME } = options;

    const syncProducts = useCallback(async () => {
        if (!accountId || !token) return;

        setSyncing(true);
        try {
            const serverProducts = await api.get<any[]>('/api/products', token, accountId);
            const now = Date.now();

            // Transform and store
            const cached: CachedProduct[] = serverProducts.map((p: any) => ({
                id: p.id,
                wooId: p.wooId,
                accountId,
                name: p.name || '',
                sku: p.sku || '',
                data: p,
                syncedAt: now
            }));

            // Bulk upsert
            await hotTierDB.products.bulkPut(cached);
            await setLastSyncTime('products', accountId);
            await pruneTable('products', accountId);

            setProducts(cached);
        } catch (error) {
            console.error('Failed to sync products:', error);
        } finally {
            setSyncing(false);
        }
    }, [accountId, token]);

    useEffect(() => {
        if (!accountId) {
            setLoading(false);
            return;
        }

        const loadProducts = async () => {
            setLoading(true);

            // Try local cache first
            const cachedProducts = await hotTierDB.products
                .where('accountId').equals(accountId)
                .toArray();

            if (cachedProducts.length > 0 && !forceRefresh) {
                setProducts(cachedProducts);
                setLoading(false);

                // Check if stale
                const lastSync = await getLastSyncTime('products', accountId);
                if (!lastSync || Date.now() - lastSync > staleTime) {
                    // Background refresh
                    syncProducts();
                }
            } else {
                // No cache, fetch from server
                await syncProducts();
                setLoading(false);
            }
        };

        loadProducts();
    }, [accountId, forceRefresh, staleTime, syncProducts]);

    return { products, loading, syncing, refresh: syncProducts };
}

/**
 * Hook for caching orders with background refresh
 */
export function useHotOrders(options: UseHotCacheOptions = {}) {
    const { currentAccount } = useAccount();
    const { token } = useAuth();
    const [orders, setOrders] = useState<CachedOrder[]>([]);
    const [loading, setLoading] = useState(true);
    const [syncing, setSyncing] = useState(false);

    const accountId = currentAccount?.id;
    const { forceRefresh = false, staleTime = DEFAULT_STALE_TIME } = options;

    const syncOrders = useCallback(async () => {
        if (!accountId || !token) return;

        setSyncing(true);
        try {
            const serverOrders = await api.get<any[]>('/api/sync/orders/search?limit=1000', token, accountId);
            const now = Date.now();

            const cached: CachedOrder[] = serverOrders.map((o: any) => ({
                id: o.id,
                wooId: o.wooId,
                accountId,
                data: o,
                syncedAt: now
            }));

            await hotTierDB.orders.bulkPut(cached);
            await setLastSyncTime('orders', accountId);
            await pruneTable('orders', accountId);

            setOrders(cached);
        } catch (error) {
            console.error('Failed to sync orders:', error);
        } finally {
            setSyncing(false);
        }
    }, [accountId, token]);

    useEffect(() => {
        if (!accountId) {
            setLoading(false);
            return;
        }

        const loadOrders = async () => {
            setLoading(true);

            const cachedOrders = await hotTierDB.orders
                .where('accountId').equals(accountId)
                .reverse()
                .limit(100)
                .toArray();

            if (cachedOrders.length > 0 && !forceRefresh) {
                setOrders(cachedOrders);
                setLoading(false);

                const lastSync = await getLastSyncTime('orders', accountId);
                if (!lastSync || Date.now() - lastSync > staleTime) {
                    syncOrders();
                }
            } else {
                await syncOrders();
                setLoading(false);
            }
        };

        loadOrders();
    }, [accountId, forceRefresh, staleTime, syncOrders]);

    return { orders, loading, syncing, refresh: syncOrders };
}

/**
 * Hook for caching customers with background refresh
 */
export function useHotCustomers(options: UseHotCacheOptions = {}) {
    const { currentAccount } = useAccount();
    const { token } = useAuth();
    const [customers, setCustomers] = useState<CachedCustomer[]>([]);
    const [loading, setLoading] = useState(true);
    const [syncing, setSyncing] = useState(false);

    const accountId = currentAccount?.id;
    const { forceRefresh = false, staleTime = DEFAULT_STALE_TIME } = options;

    const syncCustomers = useCallback(async () => {
        if (!accountId || !token) return;

        setSyncing(true);
        try {
            const serverCustomers = await api.get<any[]>('/api/customers', token, accountId);
            const now = Date.now();

            const cached: CachedCustomer[] = serverCustomers.map((c: any) => ({
                id: c.id,
                wooId: c.wooId,
                accountId,
                email: c.email || '',
                name: `${c.firstName || ''} ${c.lastName || ''}`.trim(),
                data: c,
                syncedAt: now
            }));

            await hotTierDB.customers.bulkPut(cached);
            await setLastSyncTime('customers', accountId);
            await pruneTable('customers', accountId);

            setCustomers(cached);
        } catch (error) {
            console.error('Failed to sync customers:', error);
        } finally {
            setSyncing(false);
        }
    }, [accountId, token]);

    useEffect(() => {
        if (!accountId) {
            setLoading(false);
            return;
        }

        const loadCustomers = async () => {
            setLoading(true);

            const cachedCustomers = await hotTierDB.customers
                .where('accountId').equals(accountId)
                .toArray();

            if (cachedCustomers.length > 0 && !forceRefresh) {
                setCustomers(cachedCustomers);
                setLoading(false);

                const lastSync = await getLastSyncTime('customers', accountId);
                if (!lastSync || Date.now() - lastSync > staleTime) {
                    syncCustomers();
                }
            } else {
                await syncCustomers();
                setLoading(false);
            }
        };

        loadCustomers();
    }, [accountId, forceRefresh, staleTime, syncCustomers]);

    return { customers, loading, syncing, refresh: syncCustomers };
}

export default {
    useHotProducts,
    useHotOrders,
    useHotCustomers
};
