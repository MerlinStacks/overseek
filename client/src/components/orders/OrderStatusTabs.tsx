/**
 * OrderStatusTabs - A modern horizontal tab filter for order statuses.
 * 
 * Why: Replaces the basic dropdown with a premium horizontal pill/tab filter
 * matching the WooCommerce-style "All | Processing | Completed | ..." design
 * but with OverSeek's glassmorphism aesthetic.
 */

import { useEffect, useState, useMemo } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { ORDER_STATUS_CONFIG, getStatusConfig } from '../../utils/orderStatus';
import { Loader2 } from 'lucide-react';

interface StatusCounts {
    total: number;
    counts: Record<string, number>;
}

interface OrderStatusTabsProps {
    selectedStatus: string;
    onStatusChange: (status: string) => void;
}

/** Ordered list of statuses to display in the tabs */
const TAB_STATUSES = [
    'all',
    'pending',
    'processing',
    'on-hold',
    'completed',
    'cancelled',
    'refunded',
    'failed'
] as const;

export function OrderStatusTabs({ selectedStatus, onStatusChange }: OrderStatusTabsProps) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [statusCounts, setStatusCounts] = useState<StatusCounts | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        if (!currentAccount || !token) return;

        const fetchCounts = async () => {
            try {
                const res = await fetch('/api/sync/orders/status-counts', {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'X-Account-ID': currentAccount.id
                    }
                });

                if (res.ok) {
                    const data = await res.json();
                    setStatusCounts(data);
                }
            } catch {
                // Silent fail - tabs still work without counts
            } finally {
                setIsLoading(false);
            }
        };

        fetchCounts();
    }, [currentAccount, token]);

    const tabs = useMemo(() => {
        return TAB_STATUSES.map(status => {
            if (status === 'all') {
                return {
                    value: 'all',
                    label: 'All',
                    count: statusCounts?.total ?? null,
                    color: 'gray'
                };
            }

            const config = getStatusConfig(status);
            return {
                value: status,
                label: config.label,
                count: statusCounts?.counts[status] ?? null,
                color: status
            };
        });
    }, [statusCounts]);

    const getTabStyles = (status: string, isActive: boolean) => {
        const baseStyles = 'group relative flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg transition-all duration-200 cursor-pointer select-none whitespace-nowrap';

        if (isActive) {
            // Active state - filled with status color
            const colorMap: Record<string, string> = {
                all: 'bg-slate-800 text-white shadow-md',
                pending: 'bg-amber-500 text-white shadow-md shadow-amber-200/50',
                processing: 'bg-blue-500 text-white shadow-md shadow-blue-200/50',
                'on-hold': 'bg-orange-500 text-white shadow-md shadow-orange-200/50',
                completed: 'bg-emerald-500 text-white shadow-md shadow-emerald-200/50',
                cancelled: 'bg-red-500 text-white shadow-md shadow-red-200/50',
                refunded: 'bg-purple-500 text-white shadow-md shadow-purple-200/50',
                failed: 'bg-red-600 text-white shadow-md shadow-red-200/50'
            };
            return `${baseStyles} ${colorMap[status] || colorMap.all}`;
        }

        // Inactive state - subtle with hover effect
        return `${baseStyles} text-gray-600 hover:text-gray-900 hover:bg-gray-100`;
    };

    const getCountStyles = (status: string, isActive: boolean) => {
        if (isActive) {
            return 'bg-white/25 text-white/90 text-xs px-1.5 py-0.5 rounded-md font-medium tabular-nums';
        }

        // Inactive - subtle badge
        return 'bg-gray-200/70 text-gray-500 text-xs px-1.5 py-0.5 rounded-md font-medium tabular-nums group-hover:bg-gray-300/70';
    };

    if (isLoading) {
        return (
            <div className="flex items-center gap-2 px-4 py-3 bg-white/60 backdrop-blur-sm rounded-xl border border-gray-200/60 shadow-sm">
                <Loader2 size={16} className="animate-spin text-gray-400" />
                <span className="text-sm text-gray-500">Loading statuses...</span>
            </div>
        );
    }

    return (
        <div className="bg-white/60 backdrop-blur-sm rounded-xl border border-gray-200/60 shadow-sm overflow-hidden">
            <div className="flex items-center gap-1 p-1.5 overflow-x-auto scrollbar-thin scrollbar-thumb-gray-300" role="tablist">
                {tabs.map((tab) => {
                    const isActive = selectedStatus === tab.value;
                    return (
                        <button
                            key={tab.value}
                            role="tab"
                            aria-selected={isActive}
                            onClick={() => onStatusChange(tab.value)}
                            className={getTabStyles(tab.value, isActive)}
                        >
                            <span>{tab.label}</span>
                            {tab.count !== null && (
                                <span className={getCountStyles(tab.value, isActive)}>
                                    {tab.count.toLocaleString()}
                                </span>
                            )}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
