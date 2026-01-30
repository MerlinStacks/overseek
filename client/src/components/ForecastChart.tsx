
import React, { useEffect, useState } from 'react';
import { Logger } from '../utils/logger';
import { useAuth } from '../context/AuthContext';
import { useAccount } from '../context/AccountContext';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import { echarts, graphic, type EChartsOption } from '../utils/echarts';
import { Loader2, TrendingUp } from 'lucide-react';


interface ForecastData {
    date: string;
    sales?: number;
    historySales?: number | null;
    forecastSales?: number | null;
    isForecast?: boolean;
}

interface ForecastProps {
    dateRange: { startDate: string, endDate: string };
}

export function ForecastChart({ dateRange }: ForecastProps) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [data, setData] = useState<ForecastData[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        if (currentAccount && token) {
            fetchForecast();
        }
    }, [currentAccount, token, dateRange]);

    async function fetchForecast() {
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
                const history = await historyRes.json();
                const forecast = await forecastRes.json();

                const processed: ForecastData[] = history.map((d: any) => ({
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
                forecast.forEach((d: any) => {
                    if (!processed.find(p => p.date === d.date)) {
                        processed.push({
                            date: d.date,
                            historySales: null,
                            forecastSales: d.sales
                        });
                    }
                });

                setData(processed);
            }

        } catch (error) {
            Logger.error('An error occurred', { error: error });
        } finally {
            setIsLoading(false);
        }
    }

    const getChartOptions = (): EChartsOption => {
        const dates = data.map(d => {
            const str = String(d.date);
            return str.length > 5 ? str.slice(5) : str;
        });
        const historyValues = data.map(d => d.historySales ?? null);
        const forecastValues = data.map(d => d.forecastSales ?? null);

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
                    formatter: (value: number) => `$${value}`
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
                    name: 'Forecast',
                    type: 'line',
                    smooth: true,
                    data: forecastValues,
                    lineStyle: { color: '#a855f7', width: 2, type: 'dashed' },
                    areaStyle: {
                        color: new graphic.LinearGradient(0, 0, 0, 1, [
                            { offset: 0, color: 'rgba(168, 85, 247, 0.8)' },
                            { offset: 1, color: 'rgba(168, 85, 247, 0)' }
                        ])
                    },
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
                </div>
                <div className="bg-purple-100 text-purple-700 px-3 py-1 rounded-full text-xs font-semibold flex items-center gap-1">
                    <TrendingUp size={14} /> AI Powered
                </div>
            </div>

            <div className="w-full" style={{ height: '300px' }}>
                <ReactEChartsCore
                    echarts={echarts}
                    option={getChartOptions()}
                    style={{ height: '100%', width: '100%' }}
                    opts={{ renderer: 'svg' }}
                />

                {/* Legend */}
                <div className="flex justify-center mt-4 gap-6 text-sm">
                    <div className="flex items-center gap-2">
                        <div className="w-3 h-3 bg-blue-500 rounded-full"></div>
                        <span className="text-gray-600">Historical Sales</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="w-3 h-3 bg-purple-500 rounded-full"></div>
                        <span className="text-gray-600">Forecast (Projected)</span>
                    </div>
                </div>
            </div>
        </div>
    );
}
