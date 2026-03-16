import { WidgetProps } from './WidgetRegistry';
import { Logger } from '../../utils/logger';
import { formatCurrency } from '../../utils/format';
import { TrendingUp, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';

export function AdSpendWidget({ className, dateRange }: WidgetProps) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [data, setData] = useState<any>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!currentAccount) return;

        fetch(`/api/analytics/ads-summary?startDate=${dateRange.startDate}&endDate=${dateRange.endDate}`, {
            headers: { 'Authorization': `Bearer ${token}`, 'X-Account-ID': currentAccount.id }
        })
            .then(res => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return res.json();
            })
            .then(resData => setData(resData))
            .catch(e => Logger.error('Failed to fetch ad spend data', { error: e }))
            .finally(() => setLoading(false));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentAccount?.id, token, dateRange]);

    return (
        <div className={`bg-white dark:bg-slate-800/90 h-full w-full p-6 flex flex-col justify-between rounded-2xl shadow-[0_1px_3px_rgba(0,0,0,0.05),0_1px_2px_rgba(0,0,0,0.03)] dark:shadow-[0_1px_3px_rgba(0,0,0,0.2)] border border-slate-200/80 dark:border-slate-700/50 transition-all duration-300 hover:shadow-[0_10px_40px_rgba(0,0,0,0.08)] dark:hover:shadow-[0_10px_40px_rgba(0,0,0,0.3)] hover:-translate-y-0.5 ${className}`}>
            <div className="flex justify-between items-start">
                <div>
                    <h3 className="text-slate-500 dark:text-slate-400 text-sm font-medium uppercase tracking-wider">Ad Spend</h3>
                    {loading ? (
                        <div className="mt-2"><Loader2 className="animate-spin text-slate-400" size={24} /></div>
                    ) : (
                        <p className="text-3xl font-bold text-slate-900 dark:text-white mt-2">
                            {formatCurrency(data?.spend || 0, data?.currency || 'USD')}
                        </p>
                    )}
                </div>
                <div className="p-3 bg-gradient-to-br from-blue-400 to-indigo-600 rounded-xl text-white shadow-lg shadow-blue-500/25">
                    <TrendingUp size={24} />
                </div>
            </div>
            {!loading && (
                <div className="mt-4 grid grid-cols-2 gap-2 text-sm border-t border-slate-200 dark:border-slate-700 pt-4">
                    <div>
                        <p className="text-slate-400 dark:text-slate-500 text-xs">ROAS</p>
                        <p className="font-bold text-slate-900 dark:text-white">
                            {/* ROAS from API or dash if 0 */}
                            {data?.roas ? data.roas.toFixed(2) + 'x' : '-'}
                        </p>
                    </div>
                    <div className="text-right">
                        <p className="text-slate-400 dark:text-slate-500 text-xs">Clicks</p>
                        <p className="font-bold text-slate-900 dark:text-white">{data?.clicks || 0}</p>
                    </div>
                </div>
            )}
        </div>
    );
}
