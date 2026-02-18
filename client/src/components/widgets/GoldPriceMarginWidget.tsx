/**
 * Gold Price Margin Widget
 * 
 * Displays a summary of gold-priced products and their profit margins.
 * Links to the full Gold Price Margin Report page.
 */

import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Gem, ArrowRight, TrendingDown, Loader2, AlertTriangle, RefreshCw } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { Logger } from '../../utils/logger';

// Margin thresholds for color coding (aligned with report page)
const MARGIN_THRESHOLD_LOW = 20;
const MARGIN_THRESHOLD_MEDIUM = 40;

interface GoldPriceSummary {
    totalCount: number;
    productCount: number;
    variationCount: number;
    lowestMarginItems: { name: string; margin: number }[];
}

/**
 * Dashboard widget showing gold price product margin summary.
 * Clickable to navigate to full report.
 */
export function GoldPriceMarginWidget() {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const navigate = useNavigate();
    const [summary, setSummary] = useState<GoldPriceSummary | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchSummary = useCallback(async () => {
        if (!currentAccount || !token) return;

        setError(null);
        try {
            const res = await fetch('/api/reports/gold-price/summary', {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'X-Account-ID': currentAccount.id
                }
            });
            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }
            setSummary(await res.json());
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to load';
            Logger.error('Failed to load gold price summary', { error: err });
            setError(message);
        } finally {
            setLoading(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentAccount?.id, token]);

    useEffect(() => {
        fetchSummary();
    }, [fetchSummary]);

    if (loading) {
        return (
            <div className="h-full flex items-center justify-center">
                <Loader2 className="animate-spin text-amber-500" size={20} />
            </div>
        );
    }

    if (error) {
        return (
            <div className="h-full flex flex-col items-center justify-center text-gray-400 p-4">
                <div className="bg-red-50 dark:bg-red-900/20 p-3 rounded-full mb-2">
                    <AlertTriangle className="w-5 h-5 text-red-400" />
                </div>
                <p className="text-sm font-medium text-gray-600 dark:text-gray-300 mb-2">Failed to Load</p>
                <button
                    onClick={() => { setLoading(true); fetchSummary(); }}
                    className="text-xs text-amber-600 hover:text-amber-700 flex items-center gap-1"
                >
                    <RefreshCw size={12} />
                    Retry
                </button>
            </div>
        );
    }

    if (!summary || summary.totalCount === 0) {
        return (
            <div className="h-full flex flex-col items-center justify-center text-gray-400 p-4">
                <div className="bg-amber-50 dark:bg-amber-900/20 p-3 rounded-full mb-2">
                    <Gem className="w-5 h-5 text-amber-400" />
                </div>
                <p className="text-sm font-medium text-gray-600 dark:text-gray-300">No Gold Products</p>
                <p className="text-xs text-center">Enable gold pricing on products to see margin analysis.</p>
            </div>
        );
    }

    return (
        <div
            className="flex flex-col h-full cursor-pointer group"
            onClick={() => navigate('/reports/gold-price-margin')}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && navigate('/reports/gold-price-margin')}
        >
            {/* Header */}
            <div className="flex items-center justify-between mb-3 px-1">
                <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                    <Gem size={16} className="text-amber-500" />
                    Gold Price Margins
                </h3>
                <span className="text-xs font-mono bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 px-2 py-0.5 rounded-full">
                    {summary.totalCount} Items
                </span>
            </div>

            {/* Lowest Margins */}
            <div className="flex-1 overflow-hidden">
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-2 px-1 flex items-center gap-1">
                    <TrendingDown size={12} />
                    Lowest Margins
                </p>
                <div className="space-y-2">
                    {summary.lowestMarginItems.map((item, idx) => (
                        <div
                            key={idx}
                            className="flex items-center justify-between p-2 rounded-lg bg-gray-50 dark:bg-slate-800/50 border border-transparent group-hover:border-amber-200 dark:group-hover:border-amber-500/30 transition-colors"
                        >
                            <span className="text-sm text-gray-800 dark:text-gray-200 truncate flex-1 mr-2">
                                {item.name}
                            </span>
                            <span className={`text-xs font-mono font-bold ${item.margin < MARGIN_THRESHOLD_LOW ? 'text-red-600' :
                                item.margin < MARGIN_THRESHOLD_MEDIUM ? 'text-amber-600' :
                                    'text-green-600'
                                }`}>
                                {item.margin.toFixed(1)}%
                            </span>
                        </div>
                    ))}
                </div>
            </div>

            {/* Footer Link */}
            <div className="mt-3 pt-2 border-t border-gray-100 dark:border-slate-700">
                <span className="flex items-center justify-center gap-1 text-xs font-medium text-amber-600 group-hover:text-amber-700 transition-colors">
                    View Full Report <ArrowRight size={12} className="group-hover:translate-x-0.5 transition-transform" />
                </span>
            </div>
        </div>
    );
}
