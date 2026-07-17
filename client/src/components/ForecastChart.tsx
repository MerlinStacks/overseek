
import { useEffect, useState, useCallback } from 'react';
import { Logger } from '../utils/logger';
import { useAuth } from '../context/AuthContext';
import { useAccount } from '../context/AccountContext';
import ReactEChartsCore from 'echarts-for-react/esm/core';
import { echarts, graphic, type EChartsOption } from '../utils/echarts';
import { AlertTriangle, Loader2, TrendingUp } from 'lucide-react';
import { formatCurrency } from '../utils/format';


interface ForecastData {
    date: string;
    sales?: number;
    historySales?: number | null;
    forecastSales?: number | null;
    forecastLower?: number | null;
    forecastUpper?: number | null;
    isForecast?: boolean;
}

interface SalesHistoryRow {
    date: string;
    sales: number;
}

interface ForecastRow {
    date: string;
    sales: number;
    lower?: number;
    upper?: number;
}

interface ForecastApiResponse {
    forecast?: ForecastRow[];
    confidence?: 'high' | 'medium' | 'low';
    warning?: string;
    metadata?: {
        method?: string;
        backtestAccuracy?: number | null;
        dataThrough?: string | null;
    };
}

interface ForecastProps {
    dateRange: { startDate: string, endDate: string };
}

export function ForecastChart({ dateRange }: ForecastProps) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [data, setData] = useState<ForecastData[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [warning, setWarning] = useState<string | null>(null);
    const [confidence, setConfidence] = useState<'high' | 'medium' | 'low' | null>(null);
    const [metadata, setMetadata] = useState<ForecastApiResponse['metadata'] | null>(null);

    const fetchForecast = useCallback(async () => {
        setIsLoading(true);
        try {
            // First get actual history
            const historyRes = await fetch(
                `/api/analytics/sales-chart?startDate=${dateRange.startDate}&endDate=${dateRange.endDate}&interval=day`,
                { headers: { 'Authorization': `Bearer ${token}`, 'X-Account-ID': currentAccount?.id || '' } }
            );

            // Then get forecast
            const forecastRes = await fetch(
                `/api/analytics/forecast?days=30`,
                { headers: { 'Authorization': `Bearer ${token}`, 'X-Account-ID': currentAccount?.id || '' } }
            );

            if (historyRes.ok && forecastRes.ok) {
                const history: SalesHistoryRow[] = await historyRes.json();
                const rawForecast: ForecastRow[] | ForecastApiResponse = await forecastRes.json();
                const forecast = Array.isArray(rawForecast)
                    ? rawForecast
                    : Array.isArray(rawForecast.forecast)
                        ? rawForecast.forecast
                        : [];
                const forecastWarning = Array.isArray(rawForecast) ? null : (rawForecast.warning || null);
                const forecastConfidence = Array.isArray(rawForecast) ? null : (rawForecast.confidence || null);
                const forecastMetadata = Array.isArray(rawForecast) ? null : (rawForecast.metadata || null);

                const processed: ForecastData[] = history.map((d) => ({
                    date: d.date,
                    historySales: d.sales,
                    forecastSales: null
                }));

                // Stitch the lines: last history point = first forecast point
                if (processed.length > 0 && forecast.length > 0) {
                    const lastHistory = processed[processed.length - 1];
                    lastHistory.forecastSales = lastHistory.historySales;
                }

                // Add the rest of the forecast
                forecast.forEach((d) => {
                    if (!processed.find(p => p.date === d.date)) {
                        processed.push({
                            date: d.date,
                            historySales: null,
                            forecastSales: d.sales,
                            forecastLower: d.lower ?? null,
                            forecastUpper: d.upper ?? null
                        });
                    }
                });

                setData(processed);
                setWarning(forecastWarning);
                setConfidence(forecastConfidence);
                setMetadata(forecastMetadata);
            } else {
                setData([]);
                setWarning(null);
                setConfidence(null);
                setMetadata(null);
            }

        } catch (error) {
            Logger.error('An error occurred', { error: error });
            setWarning(null);
            setConfidence(null);
            setMetadata(null);
        } finally {
            setIsLoading(false);
        }
    }, [dateRange.startDate, dateRange.endDate, token, currentAccount?.id]);

    const confidenceBadgeClass = confidence === 'high'
        ? 'bg-emerald-100 text-emerald-700'
        : confidence === 'medium'
            ? 'bg-amber-100 text-amber-700'
            : confidence === 'low'
                ? 'bg-rose-100 text-rose-700'
                : 'bg-purple-100 text-purple-700';

    const confidenceLabel = confidence
        ? `${confidence.charAt(0).toUpperCase()}${confidence.slice(1)} Confidence`
        : 'Sales Forecast';
    const methodLabel = metadata?.method === 'weekday-ewma-yoy-ensemble'
        ? 'Weekday + recent trend + prior-year ensemble'
        : metadata?.method === 'unavailable'
            ? 'Forecast unavailable'
            : 'Weekday + recent trend ensemble';

    useEffect(() => {
        if (currentAccount && token) {
            fetchForecast();
        }
    }, [currentAccount, token, dateRange, fetchForecast]);

    const getChartOptions = (): EChartsOption => {
        const dates = data.map(d => {
            const str = String(d.date);
            return str.length > 5 ? str.slice(5) : str;
        });
        const historyValues = data.map(d => d.historySales ?? null);
        const forecastValues = data.map(d => d.forecastSales ?? null);
        const forecastLowerValues = data.map(d => d.forecastLower ?? null);
        const forecastRangeValues = data.map(d => (
            d.forecastLower != null && d.forecastUpper != null
                ? Math.max(0, d.forecastUpper - d.forecastLower)
                : null
        ));
        const currency = currentAccount?.currency || 'USD';

        return {
            grid: { top: 10, right: 30, left: 50, bottom: 30 },
            xAxis: {
                type: 'category',
                data: dates,
                axisLabel: { fontSize: 12, color: '#6b7280' }
            },
            yAxis: {
                type: 'value',
                axisLabel: {
                    fontSize: 12,
                    color: '#6b7280',
                    formatter: (value: number) => formatCurrency(value, currency, {
                        minimumFractionDigits: 0,
                        maximumFractionDigits: 0
                    })
                },
                splitLine: { lineStyle: { color: '#f3f4f6', type: 'dashed' } }
            },
            tooltip: {
                trigger: 'axis'
            },
            series: [
                {
                    name: 'Sales',
                    type: 'line',
                    smooth: true,
                    data: historyValues,
                    lineStyle: { color: '#3b82f6', width: 2 },
                    areaStyle: {
                        color: new graphic.LinearGradient(0, 0, 0, 1, [
                            { offset: 0, color: 'rgba(59, 130, 246, 0.8)' },
                            { offset: 1, color: 'rgba(59, 130, 246, 0)' }
                        ])
                    },
                    itemStyle: { color: '#3b82f6' },
                    symbol: 'none',
                    connectNulls: false
                },
                {
                    name: 'Forecast range baseline',
                    type: 'line',
                    data: forecastLowerValues,
                    stack: 'forecast-range',
                    lineStyle: { opacity: 0 },
                    areaStyle: { opacity: 0 },
                    symbol: 'none',
                    connectNulls: false,
                    tooltip: { show: false }
                },
                {
                    name: 'Likely range',
                    type: 'line',
                    data: forecastRangeValues,
                    stack: 'forecast-range',
                    lineStyle: { opacity: 0 },
                    areaStyle: { color: 'rgba(168, 85, 247, 0.18)' },
                    symbol: 'none',
                    connectNulls: false,
                    tooltip: { show: false }
                },
                {
                    name: 'Forecast',
                    type: 'line',
                    smooth: true,
                    data: forecastValues,
                    lineStyle: { color: '#a855f7', width: 2, type: 'dashed' },
                    itemStyle: { color: '#a855f7' },
                    symbol: 'none',
                    connectNulls: false
                }
            ]
        };
    };

    if (isLoading) return <div className="h-64 flex items-center justify-center"><Loader2 className="animate-spin" /></div>;

    return (
        <div className="bg-white p-6 rounded-xl shadow-xs border border-gray-200">
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h3 className="text-lg font-bold text-gray-900">Sales Forecast</h3>
                    <p className="text-sm text-gray-500">Predicted sales for the next 30 days based on recent trends</p>
                    {metadata && (
                        <p className="mt-1 text-xs text-gray-400">
                            {methodLabel}
                            {metadata.backtestAccuracy != null && ` | ${metadata.backtestAccuracy}% backtest accuracy`}
                            {metadata.dataThrough && ` | Data through ${metadata.dataThrough}`}
                        </p>
                    )}
                </div>
                <div className={`px-3 py-1 rounded-full text-xs font-semibold flex items-center gap-1 ${confidenceBadgeClass}`}>
                    <TrendingUp size={14} /> {confidenceLabel}
                </div>
            </div>

            {warning && (
                <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 flex items-start gap-2">
                    <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                    <span>{warning}</span>
                </div>
            )}

            <div className="w-full">
                <div style={{ height: '300px' }}>
                <ReactEChartsCore
                    echarts={echarts}
                    option={getChartOptions()}
                    style={{ height: '100%', width: '100%' }}
                    opts={{ renderer: 'svg' }}
                />
                </div>

                {/* Legend */}
                <div className="flex flex-wrap justify-center mt-4 gap-x-6 gap-y-2 text-sm">
                    <div className="flex items-center gap-2">
                        <div className="w-3 h-3 bg-blue-500 rounded-full"></div>
                        <span className="text-gray-600">Historical Sales</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="w-3 h-3 bg-purple-500 rounded-full"></div>
                        <span className="text-gray-600">Forecast (Projected)</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="w-3 h-3 bg-purple-200 rounded-full"></div>
                        <span className="text-gray-600">Likely Range</span>
                    </div>
                </div>
            </div>
        </div>
    );
}
