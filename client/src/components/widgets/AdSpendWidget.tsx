import { WidgetProps } from './WidgetRegistry';
import { Logger } from '../../utils/logger';
import { formatCurrency } from '../../utils/format';
import { TrendingUp, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';

export function AdSpendWidget({ className }: WidgetProps) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [data, setData] = useState<any>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!currentAccount) return;

        fetch('/api/analytics/ads-summary', {
            headers: { 'Authorization': `Bearer ${token}`, 'X-Account-ID': currentAccount.id }
        })
            .then(res => res.json())
            .then(resData => setData(resData))
            .catch(e => Logger.error('Failed to fetch ad spend data', { error: e }))
            .finally(() => setLoading(false));
    }, [currentAccount, token]);

    return (
        <div className={`bg-white h-full w-full p-6 flex flex-col justify-between rounded-xl shadow-xs border border-gray-200 ${className}`}>
            <div className="flex justify-between items-start">
                <div>
                    <h3 className="text-gray-500 text-sm font-medium uppercase tracking-wider">Ad Spend (30d)</h3>
                    {loading ? (
                        <div className="mt-2"><Loader2 className="animate-spin text-gray-400" size={24} /></div>
                    ) : (
                        <p className="text-3xl font-bold text-gray-900 mt-2">
                            {formatCurrency(data?.spend || 0, data?.currency || 'USD')}
                        </p>
                    )}
                </div>
                <div className="p-3 bg-blue-50 rounded-lg text-blue-600">
                    <TrendingUp size={24} />
                </div>
            </div>
            {!loading && (
                <div className="mt-4 grid grid-cols-2 gap-2 text-sm border-t pt-4">
                    <div>
                        <p className="text-gray-400 text-xs">ROAS</p>
                        <p className="font-bold text-gray-900">
                            {/* ROAS from API or dash if 0 */}
                            {data?.roas ? data.roas.toFixed(2) + 'x' : '-'}
                        </p>
                    </div>
                    <div className="text-right">
                        <p className="text-gray-400 text-xs">Clicks</p>
                        <p className="font-bold text-gray-900">{data?.clicks || 0}</p>
                    </div>
                </div>
            )}
        </div>
    );
}
