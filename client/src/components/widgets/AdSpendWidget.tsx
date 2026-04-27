import { WidgetProps } from './WidgetRegistry';
import { Logger } from '../../utils/logger';
import { formatCurrency } from '../../utils/format';
import { TrendingUp } from 'lucide-react';
import { useEffect, useState, useRef, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { WidgetLoadingState, WidgetErrorState } from './WidgetState';
import { widgetCardClass, widgetSubtleTextClass } from './widgetStyles';

interface AdSpendData {
    spend?: number;
    currency?: string;
    roas?: number;
    clicks?: number;
}

export function AdSpendWidget({ className, dateRange }: WidgetProps) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [data, setData] = useState<AdSpendData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const fetchAbortRef = useRef<AbortController | null>(null);

    const fetchData = useCallback(async () => {
        if (!currentAccount || !token) return;

        fetchAbortRef.current?.abort();
        const controller = new AbortController();
        fetchAbortRef.current = controller;
        setLoading(true);

        try {
            const res = await fetch(`/api/analytics/ads-summary?startDate=${dateRange.startDate}&endDate=${dateRange.endDate}`, {
                headers: { 'Authorization': `Bearer ${token}`, 'X-Account-ID': currentAccount.id },
                signal: controller.signal
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const resData = await res.json() as AdSpendData;
            if (controller.signal.aborted) return;
            setData(resData);
            setError(null);
        } catch (err) {
            if (err instanceof DOMException && err.name === 'AbortError') return;
            Logger.error('Failed to fetch ad spend data', { error: err });
            setError('Failed to load ad spend');
        } finally {
            if (!controller.signal.aborted) {
                setLoading(false);
            }
        }
    }, [currentAccount, dateRange.endDate, dateRange.startDate, token]);

    useEffect(() => {
        fetchData();
        return () => {
            fetchAbortRef.current?.abort();
        };
    }, [fetchData]);

    return (
        <div className={`${widgetCardClass} h-full w-full p-6 flex flex-col justify-between hover:-translate-y-0.5 ${className || ''}`}>
            <div className="flex justify-between items-start">
                <div>
                    <h3 className={`${widgetSubtleTextClass} font-medium uppercase tracking-wider`}>Ad Spend</h3>
                    {loading ? (
                        <WidgetLoadingState message="Loading ad metrics..." className="items-start py-2" />
                    ) : error ? (
                        <WidgetErrorState message={error} onRetry={fetchData} className="items-start py-2" />
                    ) : (
                        <p className="text-3xl font-bold text-slate-900 dark:text-white mt-2">
                            {formatCurrency(data?.spend || 0, data?.currency || 'USD')}
                        </p>
                    )}
                </div>
                <div className="p-2.5 bg-gradient-to-br from-blue-400 to-indigo-600 rounded-lg text-white shadow-lg shadow-blue-500/25">
                    <TrendingUp size={20} />
                </div>
            </div>
            {!loading && !error && (
                <div className="mt-4 grid grid-cols-2 gap-2 text-sm border-t border-slate-200 dark:border-slate-700 pt-4">
                    <div>
                        <p className="text-slate-400 dark:text-slate-500 text-xs">ROAS</p>
                        <p className="font-bold text-slate-900 dark:text-white">
                            {data?.roas ? `${data.roas.toFixed(2)}x` : '-'}
                        </p>
                    </div>
                    <div className="text-right">
                        <p className="text-slate-400 dark:text-slate-500 text-xs">Clicks</p>
                        <p className="font-bold text-slate-900 dark:text-white">{(data?.clicks || 0).toLocaleString()}</p>
                    </div>
                </div>
            )}
        </div>
    );
}
