import { useEffect, useState, useMemo } from 'react';
import { Loader2, Package, TrendingUp, AlertCircle, CheckCircle, Clock, ArrowUp, ArrowDown } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { cn } from '../../utils/cn';

interface VelocityItem {
    id: string;
    name: string;
    sku: string;
    image: string | null;
    stock: number;
    soldLast30d: number;
    dailyVelocity: number;
    daysRemaining: number;
}

type SortColumn = 'name' | 'stock' | 'soldLast30d' | 'dailyVelocity' | 'daysRemaining';
type SortDirection = 'asc' | 'desc';

export function StockVelocityReport() {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [isLoading, setIsLoading] = useState(true);
    const [data, setData] = useState<VelocityItem[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [sortColumn, setSortColumn] = useState<SortColumn>('daysRemaining');
    const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

    /**
     * Toggles sort on a column. If same column, flip direction; otherwise, default to ascending.
     */
    const handleSort = (column: SortColumn) => {
        if (sortColumn === column) {
            setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
        } else {
            setSortColumn(column);
            setSortDirection('asc');
        }
    };

    const sortedData = useMemo(() => {
        return [...data].sort((a, b) => {
            let aVal: string | number = a[sortColumn];
            let bVal: string | number = b[sortColumn];

            // String comparison for name
            if (sortColumn === 'name') {
                aVal = (aVal as string).toLowerCase();
                bVal = (bVal as string).toLowerCase();
                if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
                if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
                return 0;
            }

            // Numeric comparison
            const diff = (aVal as number) - (bVal as number);
            return sortDirection === 'asc' ? diff : -diff;
        });
    }, [data, sortColumn, sortDirection]);

    const SortableHeader = ({ column, label, align = 'left' }: { column: SortColumn; label: string; align?: 'left' | 'right' }) => (
        <th
            onClick={() => handleSort(column)}
            className={cn(
                "px-4 py-3 font-semibold text-gray-700 cursor-pointer hover:bg-gray-100 transition-colors select-none",
                align === 'right' && 'text-right'
            )}
        >
            <span className="inline-flex items-center gap-1">
                {label}
                {sortColumn === column && (
                    sortDirection === 'asc'
                        ? <ArrowUp size={14} className="text-blue-600" />
                        : <ArrowDown size={14} className="text-blue-600" />
                )}
            </span>
        </th>
    );

    useEffect(() => {
        if (currentAccount && token) {
            fetchData();
        }
    }, [currentAccount, token]);

    const fetchData = async () => {
        if (!currentAccount || !token) return;
        setIsLoading(true);
        try {
            const res = await fetch('/api/analytics/stock-velocity', {
                headers: { 'Authorization': `Bearer ${token}`, 'X-Account-ID': currentAccount.id }
            });
            if (!res.ok) throw new Error('Failed to fetch data');
            const json = await res.json();
            setData(json);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setIsLoading(false);
        }
    };

    if (isLoading) {
        return (
            <div className="h-96 flex flex-col items-center justify-center text-gray-400">
                <Loader2 className="animate-spin mb-4" size={32} />
                <p>Calculating inventory velocity...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="p-8 text-center text-red-500 bg-red-50 rounded-xl">
                <p className="font-bold">Error loading report</p>
                <p className="text-sm">{error}</p>
            </div>
        );
    }

    if (data.length === 0) {
        return (
            <div className="h-96 flex flex-col items-center justify-center text-gray-400 bg-white rounded-xl border border-gray-200">
                <Package size={48} className="mb-4 text-gray-300" />
                <p className="text-lg font-medium">No stock data available</p>
                <p className="text-sm">Ensure your products have "Manage Stock" enabled.</p>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="bg-white p-6 rounded-xl shadow-xs border border-gray-200">
                <div className="flex justify-between items-center mb-6">
                    <div>
                        <h2 className="text-xl font-bold text-gray-900">Stock Velocity</h2>
                        <p className="text-sm text-gray-500">Predicted days of inventory remaining based on last 30 days performance.</p>
                    </div>
                    <div className="text-right">
                        <span className="text-sm font-medium text-gray-500">Products Tracked</span>
                        <p className="text-2xl font-bold text-gray-900">{data.length}</p>
                    </div>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                        <thead className="bg-gray-50 border-b border-gray-200">
                            <tr>
                                <SortableHeader column="name" label="Product" />
                                <SortableHeader column="stock" label="Stock" align="right" />
                                <SortableHeader column="soldLast30d" label="30d Sales" align="right" />
                                <SortableHeader column="dailyVelocity" label="Velocity" align="right" />
                                <SortableHeader column="daysRemaining" label="Days Left" align="right" />
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {sortedData.map((item) => {
                                let statusColor = "bg-gray-100 text-gray-600";
                                let Icon = Clock;

                                if (item.daysRemaining < 7 && item.daysRemaining > 0) {
                                    statusColor = "bg-red-100 text-red-700";
                                    Icon = AlertCircle;
                                } else if (item.daysRemaining < 21 && item.daysRemaining > 0) {
                                    statusColor = "bg-orange-100 text-orange-700";
                                    Icon = Clock;
                                } else if (item.daysRemaining >= 21 && item.daysRemaining < 999) {
                                    statusColor = "bg-green-100 text-green-700";
                                    Icon = CheckCircle;
                                } else if (item.stock === 0) {
                                    statusColor = "bg-slate-100 text-slate-500";
                                }

                                return (
                                    <tr key={item.id} className="hover:bg-gray-50 transition-colors group">
                                        <td className="px-4 py-3">
                                            <div className="flex items-center gap-3">
                                                <div className="w-10 h-10 rounded-sm bg-gray-100 border border-gray-200 flex items-center justify-center overflow-hidden shrink-0">
                                                    {item.image ? (
                                                        <img src={item.image} alt={item.name} className="w-full h-full object-cover" loading="lazy" />
                                                    ) : (
                                                        <Package size={16} className="text-gray-400" />
                                                    )}
                                                </div>
                                                <div className="min-w-0">
                                                    <p className="font-medium text-gray-900 truncate max-w-[200px] md:max-w-xs">{item.name}</p>
                                                    <p className="text-xs text-gray-500">{item.sku || 'No SKU'}</p>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-4 py-3 text-right font-medium text-gray-700">
                                            {item.stock}
                                        </td>
                                        <td className="px-4 py-3 text-right text-gray-600">
                                            {item.soldLast30d}
                                        </td>
                                        <td className="px-4 py-3 text-right text-gray-600">
                                            {item.dailyVelocity > 0 ? (
                                                <span className="flex items-center justify-end gap-1">
                                                    {item.dailyVelocity} <TrendingUp size={12} className="text-gray-400" />
                                                </span>
                                            ) : '-'}
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            <div className={cn("inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium w-full max-w-[120px] justify-center", statusColor)}>
                                                <Icon size={12} />
                                                {item.daysRemaining >= 999 ? '> 1 Year' : `${item.daysRemaining} Days`}
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
