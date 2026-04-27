import { WidgetProps } from './WidgetRegistry';
import { Logger } from '../../utils/logger';
import { formatCurrency } from '../../utils/format';
import { BarChart3 } from 'lucide-react';
import { useEffect, useState, useRef, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import { echarts, graphic, type EChartsOption, type SeriesOption } from '../../utils/echarts';
import { WidgetLoadingState, WidgetEmptyState, WidgetErrorState } from './WidgetState';
import { widgetCardClass, widgetTitleClass, widgetHeaderRowClass, widgetHeaderIconBadgeClass } from './widgetStyles';

interface SalesChartRow {
    date?: string;
    sales?: number;
}

interface SalesChartPoint {
    date: string;
    sales: number;
    comparisonSales?: number;
}

interface TooltipParam {
    axisValue: string;
    value: number;
    color: string;
    seriesName: string;
}

export function SalesChartWidget({ className, dateRange, comparison }: WidgetProps) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [data, setData] = useState<SalesChartPoint[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const fetchAbortRef = useRef<AbortController | null>(null);

    const fetchData = useCallback(async () => {
        if (!currentAccount || !token) return;

        fetchAbortRef.current?.abort();
        const controller = new AbortController();
        fetchAbortRef.current = controller;
        setLoading(true);
        setError(null);

        try {
            const headers = { 'Authorization': `Bearer ${token}`, 'X-Account-ID': currentAccount.id };
            const currentRequest = fetch(
                `/api/analytics/sales-chart?startDate=${dateRange.startDate}&endDate=${dateRange.endDate}&interval=day`,
                { headers, signal: controller.signal }
            ).then(async (res) => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return res.json() as Promise<SalesChartRow[]>;
            });

            const comparisonRequest = comparison
                ? fetch(
                    `/api/analytics/sales-chart?startDate=${comparison.startDate}&endDate=${comparison.endDate}&interval=day`,
                    { headers, signal: controller.signal }
                ).then(async (res) => {
                    if (!res.ok) throw new Error(`HTTP ${res.status}`);
                    return res.json() as Promise<SalesChartRow[]>;
                })
                : Promise.resolve([]);

            const [currentRaw, comparisonRaw] = await Promise.all([currentRequest, comparisonRequest]);
            if (controller.signal.aborted) return;

            const currentArr = Array.isArray(currentRaw) ? currentRaw : [];
            const comparisonArr = Array.isArray(comparisonRaw) ? comparisonRaw : [];
            const processedData: SalesChartPoint[] = [];
            const maxLength = Math.max(currentArr.length, comparisonArr.length);

            for (let i = 0; i < maxLength; i++) {
                const curr = currentArr[i] || {};
                const comp = comparisonArr[i] || {};
                processedData.push({
                    date: curr.date || `Day ${i + 1}`,
                    sales: curr.sales || 0,
                    comparisonSales: comparison ? (comp.sales || 0) : undefined
                });
            }

            setData(processedData);
        } catch (err) {
            if (err instanceof DOMException && err.name === 'AbortError') return;
            Logger.error('An error occurred', { error: err });
            setError('Failed to load sales trend');
        } finally {
            if (!controller.signal.aborted) {
                setLoading(false);
            }
        }
    }, [comparison, currentAccount, dateRange.endDate, dateRange.startDate, token]);

    useEffect(() => {
        fetchData();
        return () => {
            fetchAbortRef.current?.abort();
        };
    }, [fetchData]);

    const getChartOptions = (): EChartsOption => {
        const dates = data.map((d) => {
            const s = String(d.date);
            if (s.startsWith('Day')) return s;
            const date = new Date(s);
            return isNaN(date.getTime()) ? s : date.toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
        });
        const salesValues = data.map((d) => d.sales);
        const comparisonValues = comparison ? data.map((d) => d.comparisonSales ?? 0) : [];

        const series: SeriesOption[] = [
            {
                name: 'Current Period',
                type: 'line',
                smooth: true,
                data: salesValues,
                lineStyle: { color: '#22c55e', width: 2 },
                areaStyle: {
                    color: new graphic.LinearGradient(0, 0, 0, 1, [
                        { offset: 0, color: 'rgba(34, 197, 94, 0.1)' },
                        { offset: 1, color: 'rgba(34, 197, 94, 0)' }
                    ])
                },
                itemStyle: { color: '#22c55e' },
                symbol: 'none'
            }
        ];

        if (comparison && comparisonValues.length > 0) {
            series.unshift({
                name: 'Comparison',
                type: 'line',
                smooth: true,
                data: comparisonValues,
                lineStyle: { color: '#9ca3af', width: 2, type: 'dashed' },
                areaStyle: {
                    color: new graphic.LinearGradient(0, 0, 0, 1, [
                        { offset: 0, color: 'rgba(156, 163, 175, 0.1)' },
                        { offset: 1, color: 'rgba(156, 163, 175, 0)' }
                    ])
                },
                itemStyle: { color: '#9ca3af' },
                symbol: 'none'
            });
        }

        const isDark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
        const axisColor = isDark ? '#94a3b8' : '#6b7280';
        const splitColor = isDark ? '#334155' : '#f3f4f6';

        return {
            grid: { top: 10, right: 10, left: 40, bottom: 30 },
            xAxis: {
                type: 'category',
                data: dates,
                axisLine: { show: false },
                axisTick: { show: false },
                axisLabel: { fontSize: 10, color: axisColor }
            },
            yAxis: {
                type: 'value',
                axisLine: { show: false },
                axisTick: { show: false },
                axisLabel: {
                    fontSize: 10,
                    color: axisColor,
                    formatter: (value: number) => `$${value}`
                },
                splitLine: { lineStyle: { color: splitColor, type: 'dashed' } }
            },
            tooltip: {
                trigger: 'axis',
                formatter: (params: unknown) => {
                    if (!Array.isArray(params) || params.length === 0) return '';
                    const points = params as TooltipParam[];
                    const date = points[0].axisValue;
                    let html = `<div style="font-weight:600;margin-bottom:4px">${date}</div>`;
                    points.forEach((p) => {
                        const value = formatCurrency(p.value || 0);
                        html += `<div style="display:flex;align-items:center;gap:6px"><span style="width:8px;height:8px;border-radius:50%;background:${p.color}"></span>${p.seriesName}: ${value}</div>`;
                    });
                    return html;
                }
            },
            series
        };
    };

    return (
        <div className={`${widgetCardClass} h-full w-full p-5 flex flex-col overflow-hidden min-h-[300px] ${className || ''}`} style={{ minHeight: '300px' }}>
            <div className={widgetHeaderRowClass}>
                <h3 className={widgetTitleClass}>
                    Sales Trend {currentAccount?.revenueTaxInclusive !== false ? '(Tax Inclusive)' : '(Tax Exclusive)'}
                </h3>
                <div className={`${widgetHeaderIconBadgeClass} bg-gradient-to-br from-blue-400 to-violet-500 shadow-blue-500/20`}>
                    <BarChart3 size={16} />
                </div>
            </div>

            <div className="flex-1 w-full relative">
                {loading ? (
                    <WidgetLoadingState message="Loading chart..." className="absolute inset-0" />
                ) : error ? (
                    <WidgetErrorState message={error} onRetry={fetchData} className="absolute inset-0" />
                ) : data.length === 0 ? (
                    <WidgetEmptyState message="No data available" className="absolute inset-0" />
                ) : (
                    <ReactEChartsCore
                        echarts={echarts}
                        option={getChartOptions()}
                        style={{ height: '100%', width: '100%' }}
                        opts={{ renderer: 'svg' }}
                    />
                )}
            </div>
        </div>
    );
}
