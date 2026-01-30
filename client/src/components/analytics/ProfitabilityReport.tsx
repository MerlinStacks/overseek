import { useEffect, useState, useMemo } from 'react';
import { Loader2, ArrowUp, ArrowDown } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { cn } from '../../utils/cn';
import { format } from 'date-fns';

interface ProfitItem {
    orderId: string;
    orderNumber: string;
    date: string;
    productId: number;
    variationId: number;
    name: string;
    sku: string;
    quantity: number;
    revenue: number;
    cogsUnit: number;
    cost: number;
    profit: number;
    margin: number;
}

interface ProfitSummary {
    revenue: number;
    cost: number;
    profit: number;
    margin: number;
}

interface ProfitabilityReportProps {
    startDate: string;
    endDate: string;
}

type SortColumn = 'date' | 'name' | 'revenue' | 'cost' | 'profit' | 'margin';
type SortDirection = 'asc' | 'desc';

export function ProfitabilityReport({ startDate, endDate }: ProfitabilityReportProps) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [isLoading, setIsLoading] = useState(true);
    const [data, setData] = useState<ProfitItem[]>([]);
    const [summary, setSummary] = useState<ProfitSummary | null>(null);
    const [error, setError] = useState<string | null>(null);

    const [sortColumn, setSortColumn] = useState<SortColumn>('date');
    const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

    useEffect(() => {
        if (currentAccount && token) {
            fetchData();
        }
    }, [currentAccount, token, startDate, endDate]);

    const fetchData = async () => {
        if (!currentAccount || !token) return;
        setIsLoading(true);
        try {
            const res = await fetch(`/api/analytics/profitability?startDate=${startDate}&endDate=${endDate}`, {
                headers: { 'Authorization': `Bearer ${token}`, 'X-Account-ID': currentAccount.id }
            });
            if (!res.ok) throw new Error('Failed to fetch profitability data');
            const json = await res.json();
            setData(json.breakdown);
            setSummary(json.summary);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setIsLoading(false);
        }
    };

    const handleSort = (column: SortColumn) => {
        if (sortColumn === column) {
            setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
        } else {
            setSortColumn(column);
            setSortDirection('desc');
        }
    };

    const sortedData = useMemo(() => {
        return [...data].sort((a, b) => {
            let aVal: string | number = a[sortColumn];
            let bVal: string | number = b[sortColumn];

            if (sortColumn === 'date') {
                aVal = new Date(a.date).getTime();
                bVal = new Date(b.date).getTime();
            } else if (sortColumn === 'name') {
                aVal = (aVal as string).toLowerCase();
                bVal = (bVal as string).toLowerCase();
            }

            if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
            if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
            return 0;
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

    if (isLoading) {
        return (
            <div className="h-96 flex flex-col items-center justify-center text-gray-400">
                <Loader2 className="animate-spin mb-4" size={32} />
                <p>Calculating profitability...</p>
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

    return (
        <div className="space-y-6">
            {/* Summary Cards */}
            {summary && (
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div className="bg-white p-4 rounded-xl shadow-xs border border-gray-200">
                        <p className="text-sm text-gray-500 mb-1">Total Revenue</p>
                        <p className="text-2xl font-bold text-gray-900">${summary.revenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                    </div>
                    <div className="bg-white p-4 rounded-xl shadow-xs border border-gray-200">
                        <p className="text-sm text-gray-500 mb-1">Total Cost (COGS)</p>
                        <p className="text-2xl font-bold text-gray-900">${summary.cost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                    </div>
                    <div className="bg-white p-4 rounded-xl shadow-xs border border-gray-200">
                        <p className="text-sm text-gray-500 mb-1">Gross Profit</p>
                        <p className={cn("text-2xl font-bold", summary.profit >= 0 ? "text-green-600" : "text-red-600")}>
                            ${summary.profit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </p>
                    </div>
                    <div className="bg-white p-4 rounded-xl shadow-xs border border-gray-200">
                        <p className="text-sm text-gray-500 mb-1">Overall Margin</p>
                        <p className={cn("text-2xl font-bold", summary.margin >= 20 ? "text-green-600" : summary.margin > 0 ? "text-yellow-600" : "text-red-600")}>
                            {summary.margin.toFixed(1)}%
                        </p>
                    </div>
                </div>
            )}

            <div className="bg-white p-6 rounded-xl shadow-xs border border-gray-200">
                <div className="flex justify-between items-center mb-6">
                    <div>
                        <h2 className="text-xl font-bold text-gray-900">Profitability Breakdown</h2>
                        <p className="text-sm text-gray-500">Gross profit analysis per sold item.</p>
                    </div>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                        <thead className="bg-gray-50 border-b border-gray-200">
                            <tr>
                                <SortableHeader column="date" label="Date" />
                                <SortableHeader column="name" label="Product" />
                                <th className="px-4 py-3 font-semibold text-gray-700 text-right">Qty</th>
                                <SortableHeader column="revenue" label="Revenue" align="right" />
                                <SortableHeader column="cost" label="COGS" align="right" />
                                <SortableHeader column="profit" label="Profit" align="right" />
                                <SortableHeader column="margin" label="Margin %" align="right" />
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {sortedData.map((item, idx) => {
                                const marginColor = item.margin >= 30 ? "text-green-600" : item.margin >= 10 ? "text-yellow-600" : "text-red-600";
                                const profitColor = item.profit >= 0 ? "text-gray-900" : "text-red-600";

                                return (
                                    <tr key={`${item.orderId}-${item.variationId || item.productId}-${idx}`} className="hover:bg-gray-50 transition-colors">
                                        <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                                            {format(new Date(item.date), 'MMM d, HH:mm')}
                                            <div className="text-xs text-blue-600">#{item.orderNumber}</div>
                                        </td>
                                        <td className="px-4 py-3">
                                            <p className="font-medium text-gray-900 truncate max-w-[200px] md:max-w-xs">{item.name}</p>
                                            <p className="text-xs text-gray-500">{item.sku || 'No SKU'}</p>
                                        </td>
                                        <td className="px-4 py-3 text-right text-gray-700">{item.quantity}</td>
                                        <td className="px-4 py-3 text-right text-gray-900 font-medium">
                                            ${item.revenue.toFixed(2)}
                                        </td>
                                        <td className="px-4 py-3 text-right text-gray-500">
                                            ${item.cost.toFixed(2)}
                                            <div className="text-xs text-gray-400">(${item.cogsUnit.toFixed(2)} ea)</div>
                                        </td>
                                        <td className={cn("px-4 py-3 text-right font-medium", profitColor)}>
                                            ${item.profit.toFixed(2)}
                                        </td>
                                        <td className={cn("px-4 py-3 text-right font-bold", marginColor)}>
                                            {item.margin.toFixed(1)}%
                                        </td>
                                    </tr>
                                );
                            })}
                            {sortedData.length === 0 && (
                                <tr>
                                    <td colSpan={7} className="px-4 py-12 text-center text-gray-500">
                                        No sales found in this period.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
