/**
 * useOrders Hook
 *
 * Manages orders data fetching, filtering, pagination, and actions.
 * Extracted from OrdersPage.tsx for maintainability.
 */

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useAccount } from '../context/AccountContext';
import { useDebouncedValue } from './useDebouncedValue';
import { Logger } from '../utils/logger';
import { printPicklist } from '../utils/printPicklist';

export interface Order {
    id: number;
    status: string;
    total: number;
    currency: string;
    date_created: string;
    customer_id?: number;
    tags?: string[];
    billing: {
        first_name: string;
        last_name: string;
        email: string;
    };
    line_items: Array<{
        name: string;
        quantity: number;
    }>;
}

interface OrderAttribution {
    lastTouchSource: string;
}

export function useOrders() {
    const [searchParams, setSearchParams] = useSearchParams();
    const { token } = useAuth();
    const { currentAccount } = useAccount();

    // Initialize from URL
    const tagsFromUrl = searchParams.get('tags');
    const searchFromUrl = searchParams.get('q');
    const statusFromUrl = searchParams.get('status');

    // Core state
    const [orders, setOrders] = useState<Order[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSyncing, setIsSyncing] = useState(false);
    const [searchQuery, setSearchQuery] = useState(searchFromUrl || '');
    const [page, setPage] = useState(1);
    const [limit, setLimit] = useState(20);
    const [totalPages, setTotalPages] = useState(1);
    const [selectedOrderId, setSelectedOrderId] = useState<number | null>(null);

    // Tag filtering
    const [availableTags, setAvailableTags] = useState<string[]>([]);
    const [tagColors, setTagColors] = useState<Record<string, string>>({});
    const [selectedTags, setSelectedTags] = useState<string[]>(
        tagsFromUrl ? tagsFromUrl.split(',').filter(Boolean) : []
    );
    const [showTagDropdown, setShowTagDropdown] = useState(false);
    const [attributions, setAttributions] = useState<Record<number, OrderAttribution | null>>({});

    // Status filter
    const [selectedStatus, setSelectedStatus] = useState(statusFromUrl || 'all');
    const [statusCountsKey, setStatusCountsKey] = useState(0);

    // Picklist state
    const [picklistStatus, setPicklistStatus] = useState('processing');
    const [isGeneratingPicklist, setIsGeneratingPicklist] = useState(false);

    const debouncedSearch = useDebouncedValue(searchQuery, 400);

    // Sync filter state to URL
    useEffect(() => {
        const params: Record<string, string> = {};
        if (selectedTags.length > 0) params.tags = selectedTags.join(',');
        if (debouncedSearch) params.q = debouncedSearch;
        if (selectedStatus && selectedStatus !== 'all') params.status = selectedStatus;
        setSearchParams(params, { replace: true });
    }, [selectedTags, debouncedSearch, selectedStatus, setSearchParams]);

    // Fetch available tags
    useEffect(() => {
        if (!currentAccount || !token) return;
        fetch('/api/sync/orders/tags', {
            headers: { 'Authorization': `Bearer ${token}`, 'X-Account-ID': currentAccount.id }
        })
            .then(res => res.json())
            .then(data => { setAvailableTags(data.tags || []); setTagColors(data.tagColors || {}); })
            .catch(() => { setAvailableTags([]); setTagColors({}); });
    }, [currentAccount, token]);

    // Fetch orders
    const fetchOrders = useCallback(async () => {
        if (!currentAccount || !token) return;
        setIsLoading(true);
        try {
            const params = new URLSearchParams();
            params.append('page', page.toString());
            params.append('limit', limit.toString());
            if (searchQuery) params.append('q', searchQuery);
            if (selectedTags.length > 0) params.append('tags', selectedTags.join(','));
            if (selectedStatus && selectedStatus !== 'all') params.append('status', selectedStatus);

            const res = await fetch(`/api/sync/orders/search?${params}`, {
                headers: { 'Authorization': `Bearer ${token}`, 'X-Account-ID': currentAccount.id }
            });
            if (!res.ok) throw new Error('Failed to fetch orders');

            const data = await res.json();
            setOrders(data.orders || data);
            setTotalPages(data.totalPages || 1);
        } catch (err) {
            Logger.error('Failed to fetch orders', { error: err });
        } finally {
            setIsLoading(false);
        }
    }, [currentAccount, token, page, limit, searchQuery, selectedTags, selectedStatus]);

    useEffect(() => { fetchOrders(); }, [fetchOrders]);

    // Reset page on filter change
    useEffect(() => { setPage(1); }, [debouncedSearch, selectedTags, selectedStatus]);

    // Fetch attributions for visible orders in a single batch call
    useEffect(() => {
        if (!orders.length || !token || !currentAccount) return;

        const fetchAttributions = async () => {
            // Only fetch for orders we haven't fetched yet
            const uncachedIds = orders
                .filter(o => attributions[o.id] === undefined)
                .map(o => o.id);

            if (uncachedIds.length === 0) return;

            try {
                const res = await fetch('/api/orders/batch-attributions', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`,
                        'X-Account-ID': currentAccount.id
                    },
                    body: JSON.stringify({ orderIds: uncachedIds })
                });

                if (res.ok) {
                    const data = await res.json();
                    const batchResult: Record<number, OrderAttribution | null> = {};
                    for (const [id, attr] of Object.entries(data.attributions)) {
                        batchResult[Number(id)] = attr as OrderAttribution | null;
                    }
                    setAttributions(prev => ({ ...prev, ...batchResult }));
                }
            } catch {
                // Mark all as null on failure so we don't retry
                const fallback: Record<number, null> = {};
                uncachedIds.forEach(id => { fallback[id] = null; });
                setAttributions(prev => ({ ...prev, ...fallback }));
            }
        };

        fetchAttributions();
    }, [orders, token, currentAccount]);

    const handleSync = useCallback(async () => {
        if (!currentAccount || !token) return;
        setIsSyncing(true);
        try {
            const res = await fetch('/api/sync/manual', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`, 'X-Account-ID': currentAccount.id },
                body: JSON.stringify({ accountId: currentAccount.id, types: ['orders'] })
            });
            if (!res.ok) throw new Error('Sync failed');
            const result = await res.json();
            alert(`Sync started! Status: ${result.status}`);
            setTimeout(fetchOrders, 2000);
        } catch (err) {
            Logger.error('Sync failed', { error: err });
            alert('Sync failed. Check backend logs.');
        } finally {
            setIsSyncing(false);
        }
    }, [currentAccount, token, fetchOrders]);

    const handleGeneratePicklist = useCallback(async () => {
        if (!currentAccount || !token) return;
        setIsGeneratingPicklist(true);
        try {
            const params = new URLSearchParams({ status: picklistStatus, limit: '100' });
            const res = await fetch(`/api/inventory/picklist?${params}`, {
                headers: { 'Authorization': `Bearer ${token}`, 'X-Account-ID': currentAccount.id }
            });
            if (res.ok) {
                const data = await res.json();
                if (data.length === 0) alert('No items found for the selected status.');
                else printPicklist(data);
            } else {
                alert('Failed to generate picklist');
            }
        } catch (error) {
            Logger.error('Error generating picklist', { error });
            alert('Error generating picklist');
        } finally {
            setIsGeneratingPicklist(false);
        }
    }, [currentAccount, token, picklistStatus]);

    const removeTag = useCallback(async (orderId: number, tag: string) => {
        if (!currentAccount || !token) return;
        try {
            const res = await fetch(`/api/orders/${orderId}/tags/${encodeURIComponent(tag)}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}`, 'X-Account-ID': currentAccount.id }
            });
            if (res.ok) {
                setOrders(prev => prev.map(order =>
                    order.id === orderId ? { ...order, tags: (order.tags || []).filter(t => t !== tag) } : order
                ));
            }
        } catch (err) {
            Logger.error('Failed to remove tag', { error: err });
        }
    }, [currentAccount, token]);

    return {
        // State
        orders, isLoading, isSyncing, searchQuery, setSearchQuery,
        page, setPage, limit, setLimit, totalPages,
        selectedOrderId, setSelectedOrderId,
        availableTags, tagColors, selectedTags, setSelectedTags,
        showTagDropdown, setShowTagDropdown, attributions,
        selectedStatus, setSelectedStatus, statusCountsKey,
        picklistStatus, setPicklistStatus, isGeneratingPicklist,
        currentAccount,

        // Actions
        handleSync, handleGeneratePicklist, removeTag
    };
}
