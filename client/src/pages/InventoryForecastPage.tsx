import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useAccount } from '../context/AccountContext';
import { Link } from 'react-router-dom';
import {
    AlertTriangle, TrendingUp, TrendingDown, Minus,
    Loader2, Package, RefreshCw, ChevronDown, ChevronUp,
    ArrowUpRight, Info
} from 'lucide-react';

// Types matching backend
type StockoutRisk = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
type TrendDirection = 'up' | 'down' | 'stable';

interface SkuForecast {
    id: string;
    wooId: number;
    name: string;
    sku: string | null;
    image: string | null;
    currentStock: number;
    dailyDemand: number;
    forecastedDemand: number;
    daysUntilStockout: number;
    stockoutRisk: StockoutRisk;
    confidence: number;
    seasonalityFactor: number;
    trendDirection: TrendDirection;
    trendPercent: number;
    recommendedReorderQty: number;
    supplierLeadTime: number | null;
    reorderPoint: number;
}

interface StockoutAlerts {
    critical: SkuForecast[];
    high: SkuForecast[];
    medium: SkuForecast[];
    summary: {
        totalAtRisk: number;
        criticalCount: number;
        highCount: number;
        mediumCount: number;
    };
}

type SortField = 'name' | 'daysUntilStockout' | 'dailyDemand' | 'currentStock' | 'confidence';
type SortOrder = 'asc' | 'desc';

export function InventoryForecastPage() {
    const { token } = useAuth();
    const { currentAccount } = useAccount();

    const [forecasts, setForecasts] = useState<SkuForecast[]>([]);
    const [alerts, setAlerts] = useState<StockoutAlerts | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Sorting
    const [sortField, setSortField] = useState<SortField>('daysUntilStockout');
    const [sortOrder, setSortOrder] = useState<SortOrder>('asc');

    // Filter
    const [riskFilter, setRiskFilter] = useState<StockoutRisk | 'ALL'>('ALL');

    useEffect(() => {
        if (currentAccount && token) {
            fetchData();
        }
    }, [currentAccount, token]);

    async function fetchData() {
        if (!currentAccount || !token) return;
        setIsLoading(true);
        setError(null);

        try {
            const headers = {
                'Authorization': `Bearer ${token}`,
                'X-Account-ID': currentAccount.id
            };

            // Parallel fetch
            const [forecastRes, alertRes] = await Promise.all([
                fetch('/api/analytics/inventory/sku-forecasts?days=30', { headers }),
                fetch('/api/analytics/inventory/stockout-alerts?threshold=30', { headers })
            ]);

            if (forecastRes.ok) {
                const data = await forecastRes.json();
                setForecasts(data);
            } else {
                throw new Error('Failed to fetch forecasts');
            }

            if (alertRes.ok) {
                const data = await alertRes.json();
                setAlerts(data);
            }
        } catch (err: any) {
            setError(err.message || 'Failed to load forecast data');
        } finally {
            setIsLoading(false);
        }
    }

    // Sorting handler
    function handleSort(field: SortField) {
        if (sortField === field) {
            setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
        } else {
            setSortField(field);
            setSortOrder('asc');
        }
    }

    // Apply filters and sorting
    const filteredForecasts = forecasts
        .filter(f => riskFilter === 'ALL' || f.stockoutRisk === riskFilter)
        .sort((a, b) => {
            let comparison = 0;
            switch (sortField) {
                case 'name':
                    comparison = a.name.localeCompare(b.name);
                    break;
                case 'daysUntilStockout':
                    comparison = a.daysUntilStockout - b.daysUntilStockout;
                    break;
                case 'dailyDemand':
                    comparison = a.dailyDemand - b.dailyDemand;
                    break;
                case 'currentStock':
                    comparison = a.currentStock - b.currentStock;
                    break;
                case 'confidence':
                    comparison = a.confidence - b.confidence;
                    break;
            }
            return sortOrder === 'asc' ? comparison : -comparison;
        });

    // Risk badge styling
    function getRiskBadgeClass(risk: StockoutRisk): string {
        switch (risk) {
            case 'CRITICAL': return 'bg-red-100 text-red-800 border-red-200';
            case 'HIGH': return 'bg-orange-100 text-orange-800 border-orange-200';
            case 'MEDIUM': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
            case 'LOW': return 'bg-green-100 text-green-800 border-green-200';
        }
    }

    // Trend icon
    function TrendIcon({ direction, percent }: { direction: TrendDirection; percent: number }) {
        if (direction === 'up') {
            return (
                <span className="flex items-center gap-1 text-green-600 text-xs font-medium">
                    <TrendingUp size={14} /> +{percent}%
                </span>
            );
        } else if (direction === 'down') {
            return (
                <span className="flex items-center gap-1 text-red-600 text-xs font-medium">
                    <TrendingDown size={14} /> {percent}%
                </span>
            );
        }
        return (
            <span className="flex items-center gap-1 text-gray-500 text-xs font-medium">
                <Minus size={14} /> Stable
            </span>
        );
    }

    // Sortable header
    function SortableHeader({ field, label }: { field: SortField; label: string }) {
        const isActive = sortField === field;
        return (
            <th
                className="px-4 py-3 text-left cursor-pointer hover:bg-gray-100 transition-colors select-none"
                onClick={() => handleSort(field)}
            >
                <div className="flex items-center gap-1">
                    <span>{label}</span>
                    {isActive && (sortOrder === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}
                </div>
            </th>
        );
    }

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-96">
                <Loader2 className="animate-spin text-blue-600" size={32} />
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex flex-col items-center justify-center h-96 gap-4">
                <AlertTriangle className="text-red-500" size={48} />
                <p className="text-gray-600">{error}</p>
                <button
                    onClick={fetchData}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                    <RefreshCw size={16} /> Retry
                </button>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex justify-between items-end border-b pb-4">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">Inventory Forecasts</h1>
                    <p className="text-sm text-gray-500">AI-powered demand prediction & stockout alerts</p>
                </div>
                <button
                    onClick={fetchData}
                    className="flex items-center gap-2 px-3 py-2 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors"
                >
                    <RefreshCw size={16} /> Refresh
                </button>
            </div>

            {/* Critical Alert Banner */}
            {alerts && alerts.summary.criticalCount > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-4">
                    <div className="flex items-start gap-3">
                        <AlertTriangle className="text-red-600 flex-shrink-0 mt-0.5" size={20} />
                        <div>
                            <h3 className="font-semibold text-red-800">
                                {alerts.summary.criticalCount} product{alerts.summary.criticalCount > 1 ? 's' : ''} at critical risk
                            </h3>
                            <p className="text-sm text-red-700 mt-1">
                                These products may stock out before your next reorder arrives.
                            </p>
                            <div className="mt-3 flex flex-wrap gap-2">
                                {alerts.critical.slice(0, 5).map(p => (
                                    <Link
                                        key={p.id}
                                        to={`/inventory/product/${p.id}`}
                                        className="inline-flex items-center gap-1 px-2 py-1 bg-white border border-red-200 rounded-lg text-sm text-red-800 hover:bg-red-100 transition-colors"
                                    >
                                        {p.name.slice(0, 30)}{p.name.length > 30 ? '...' : ''}
                                        <ArrowUpRight size={12} />
                                    </Link>
                                ))}
                                {alerts.critical.length > 5 && (
                                    <span className="text-sm text-red-600 self-center">
                                        +{alerts.critical.length - 5} more
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Stats Cards */}
            <div className="grid grid-cols-4 gap-4">
                <StatCard
                    label="Total Products"
                    value={forecasts.length}
                    color="blue"
                />
                <StatCard
                    label="Critical Risk"
                    value={alerts?.summary.criticalCount || 0}
                    color="red"
                />
                <StatCard
                    label="High Risk"
                    value={alerts?.summary.highCount || 0}
                    color="orange"
                />
                <StatCard
                    label="Avg Confidence"
                    value={forecasts.length > 0
                        ? Math.round(forecasts.reduce((sum, f) => sum + f.confidence, 0) / forecasts.length)
                        : 0
                    }
                    suffix="%"
                    color="purple"
                />
            </div>

            {/* Filter Bar */}
            <div className="flex items-center gap-4">
                <span className="text-sm text-gray-600">Filter by risk:</span>
                <div className="flex gap-2">
                    {(['ALL', 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const).map(risk => (
                        <button
                            key={risk}
                            onClick={() => setRiskFilter(risk)}
                            className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-colors ${riskFilter === risk
                                    ? 'bg-blue-600 text-white border-blue-600'
                                    : 'bg-white text-gray-600 border-gray-300 hover:border-gray-400'
                                }`}
                        >
                            {risk}
                        </button>
                    ))}
                </div>
                <div className="ml-auto flex items-center gap-1 text-xs text-gray-500">
                    <Info size={12} />
                    Showing {filteredForecasts.length} of {forecasts.length} products
                </div>
            </div>

            {/* Forecast Table */}
            <div className="bg-white rounded-xl shadow-xs border border-gray-200 overflow-hidden">
                <table className="w-full text-left border-collapse">
                    <thead>
                        <tr className="bg-gray-50 border-b border-gray-200 text-xs uppercase text-gray-500 font-semibold">
                            <th className="px-4 py-3 w-12">Image</th>
                            <SortableHeader field="name" label="Product" />
                            <th className="px-4 py-3">SKU</th>
                            <SortableHeader field="currentStock" label="Stock" />
                            <SortableHeader field="dailyDemand" label="Daily Demand" />
                            <SortableHeader field="daysUntilStockout" label="Days Left" />
                            <th className="px-4 py-3">Risk</th>
                            <th className="px-4 py-3">Trend</th>
                            <SortableHeader field="confidence" label="Confidence" />
                            <th className="px-4 py-3">Reorder Qty</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {filteredForecasts.length === 0 ? (
                            <tr>
                                <td colSpan={10} className="p-12 text-center text-gray-500">
                                    <Package size={48} className="mx-auto text-gray-300 mb-2" />
                                    <p>No products match the current filters.</p>
                                </td>
                            </tr>
                        ) : (
                            filteredForecasts.map(forecast => (
                                <tr key={forecast.id} className="hover:bg-gray-50 transition-colors">
                                    {/* Image */}
                                    <td className="px-4 py-3">
                                        <div className="w-10 h-10 bg-gray-100 rounded-lg overflow-hidden border border-gray-200">
                                            {forecast.image ? (
                                                <img
                                                    src={forecast.image}
                                                    alt=""
                                                    className="w-full h-full object-cover"
                                                    loading="lazy"
                                                />
                                            ) : (
                                                <div className="w-full h-full flex items-center justify-center text-gray-400">
                                                    <Package size={16} />
                                                </div>
                                            )}
                                        </div>
                                    </td>

                                    {/* Name */}
                                    <td className="px-4 py-3">
                                        <Link
                                            to={`/inventory/product/${forecast.id}`}
                                            className="font-medium text-gray-900 hover:text-blue-600 transition-colors"
                                        >
                                            {forecast.name}
                                        </Link>
                                    </td>

                                    {/* SKU */}
                                    <td className="px-4 py-3 text-sm font-mono text-gray-500">
                                        {forecast.sku || '-'}
                                    </td>

                                    {/* Current Stock */}
                                    <td className="px-4 py-3">
                                        <span className={`font-bold ${forecast.currentStock === 0 ? 'text-red-600' :
                                                forecast.currentStock <= forecast.reorderPoint ? 'text-orange-600' :
                                                    'text-gray-900'
                                            }`}>
                                            {forecast.currentStock}
                                        </span>
                                    </td>

                                    {/* Daily Demand */}
                                    <td className="px-4 py-3 text-sm text-gray-700">
                                        {forecast.dailyDemand.toFixed(1)}/day
                                    </td>

                                    {/* Days Until Stockout */}
                                    <td className="px-4 py-3">
                                        <span className={`font-bold ${forecast.daysUntilStockout <= 7 ? 'text-red-600' :
                                                forecast.daysUntilStockout <= 14 ? 'text-orange-600' :
                                                    forecast.daysUntilStockout <= 30 ? 'text-yellow-600' :
                                                        'text-green-600'
                                            }`}>
                                            {forecast.daysUntilStockout >= 999 ? '∞' : `${forecast.daysUntilStockout}d`}
                                        </span>
                                    </td>

                                    {/* Risk Badge */}
                                    <td className="px-4 py-3">
                                        <span className={`px-2 py-1 text-xs font-medium rounded-full border ${getRiskBadgeClass(forecast.stockoutRisk)}`}>
                                            {forecast.stockoutRisk}
                                        </span>
                                    </td>

                                    {/* Trend */}
                                    <td className="px-4 py-3">
                                        <TrendIcon direction={forecast.trendDirection} percent={forecast.trendPercent} />
                                    </td>

                                    {/* Confidence */}
                                    <td className="px-4 py-3">
                                        <div className="flex items-center gap-2">
                                            <div className="w-16 h-2 bg-gray-200 rounded-full overflow-hidden">
                                                <div
                                                    className={`h-full rounded-full ${forecast.confidence >= 70 ? 'bg-green-500' :
                                                            forecast.confidence >= 50 ? 'bg-yellow-500' :
                                                                'bg-red-500'
                                                        }`}
                                                    style={{ width: `${forecast.confidence}%` }}
                                                />
                                            </div>
                                            <span className="text-xs text-gray-500">{forecast.confidence}%</span>
                                        </div>
                                    </td>

                                    {/* Reorder Qty */}
                                    <td className="px-4 py-3">
                                        <span className="text-sm font-medium text-blue-600">
                                            {forecast.recommendedReorderQty > 0 ? forecast.recommendedReorderQty : '-'}
                                        </span>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

// Stat card component
function StatCard({ label, value, suffix = '', color }: {
    label: string;
    value: number;
    suffix?: string;
    color: 'blue' | 'red' | 'orange' | 'purple';
}) {
    const colorClasses = {
        blue: 'bg-blue-50 text-blue-700 border-blue-200',
        red: 'bg-red-50 text-red-700 border-red-200',
        orange: 'bg-orange-50 text-orange-700 border-orange-200',
        purple: 'bg-purple-50 text-purple-700 border-purple-200'
    };

    return (
        <div className={`p-4 rounded-xl border ${colorClasses[color]}`}>
            <p className="text-xs font-medium opacity-75">{label}</p>
            <p className="text-2xl font-bold mt-1">{value}{suffix}</p>
        </div>
    );
}
