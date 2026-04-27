import { WidgetProps } from './WidgetRegistry';
import { Logger } from '../../utils/logger';
import { Users } from 'lucide-react';
import { useEffect, useState, useRef, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import { echarts, graphic, type EChartsOption } from '../../utils/echarts';
import { WidgetLoadingState, WidgetEmptyState, WidgetErrorState } from './WidgetState';
import { widgetCardClass, widgetTitleClass, widgetHeaderRowClass, widgetHeaderIconBadgeClass } from './widgetStyles';

interface CustomerGrowthPoint {
    date?: string;
    newCustomers?: number;
}

interface TooltipParam {
    axisValue: string;
    dataIndex: number;
    value: number;
}

export function CustomerGrowthWidget({ className, dateRange }: WidgetProps) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [data, setData] = useState<CustomerGrowthPoint[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const fetchAbortRef = useRef<AbortController | null>(null);

    const fetchGrowth = useCallback(async () => {
        if (!currentAccount || !token) return;

        fetchAbortRef.current?.abort();
        const controller = new AbortController();
        fetchAbortRef.current = controller;
        setLoading(true);
        setError(null);

        try {
            const res = await fetch(`/api/analytics/customer-growth?startDate=${dateRange.startDate}&endDate=${dateRange.endDate}`, {
                headers: { 'Authorization': `Bearer ${token}`, 'X-Account-ID': currentAccount.id },
                signal: controller.signal
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const resData = await res.json();
            if (controller.signal.aborted) return;
            setData(Array.isArray(resData) ? resData : []);
        } catch (err) {
            if (err instanceof DOMException && err.name === 'AbortError') return;
            Logger.error('Failed to fetch customer growth', { error: err });
            setError('Failed to load customer growth');
        } finally {
            if (!controller.signal.aborted) {
                setLoading(false);
            }
        }
    }, [currentAccount, dateRange.endDate, dateRange.startDate, token]);

    useEffect(() => {
        fetchGrowth();
        return () => {
            fetchAbortRef.current?.abort();
        };
    }, [fetchGrowth]);

    const getChartOptions = (): EChartsOption => {
        const dates = data.map((d) => {
            const date = new Date(String(d.date));
            return isNaN(date.getTime()) ? String(d.date) : date.toLocaleDateString('en-US', { month: 'short' });
        });
        const values = data.map((d) => d.newCustomers || 0);

        const isDark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
        const axisColor = isDark ? '#94a3b8' : '#6b7280';

        return {
            grid: { top: 10, right: 10, left: 10, bottom: 30 },
            xAxis: {
                type: 'category',
                data: dates,
                axisLine: { show: false },
                axisTick: { show: false },
                axisLabel: { fontSize: 12, color: axisColor }
            },
            yAxis: {
                type: 'value',
                show: false
            },
            tooltip: {
                trigger: 'axis',
                formatter: (params: unknown) => {
                    if (!Array.isArray(params) || params.length === 0) return '';
                    const points = params as TooltipParam[];
                    const date = new Date(String(data[points[0].dataIndex]?.date));
                    const label = isNaN(date.getTime()) ? points[0].axisValue : date.toLocaleDateString();
                    return `<div style="font-weight:600;margin-bottom:4px">${label}</div><div>New Customers: ${points[0].value}</div>`;
                }
            },
            series: [{
                name: 'New Customers',
                type: 'line',
                smooth: true,
                data: values,
                lineStyle: { color: '#3b82f6', width: 2 },
                areaStyle: {
                    color: new graphic.LinearGradient(0, 0, 0, 1, [
                        { offset: 0, color: 'rgba(59, 130, 246, 0.1)' },
                        { offset: 1, color: 'rgba(59, 130, 246, 0)' }
                    ])
                },
                itemStyle: { color: '#3b82f6' },
                symbol: 'none'
            }]
        };
    };

    return (
        <div className={`${widgetCardClass} h-full w-full p-5 flex flex-col overflow-hidden min-h-[200px] ${className || ''}`} style={{ minHeight: '200px' }}>
            <div className={widgetHeaderRowClass}>
                <h3 className={widgetTitleClass}>Customer Growth</h3>
                <div className={`${widgetHeaderIconBadgeClass} bg-gradient-to-br from-cyan-400 to-blue-500 shadow-blue-500/20`}>
                    <Users size={16} />
                </div>
            </div>

            <div className="flex-1 w-full relative">
                {loading ? (
                    <WidgetLoadingState message="Loading chart..." className="absolute inset-0" />
                ) : error ? (
                    <WidgetErrorState message={error} onRetry={fetchGrowth} className="absolute inset-0" />
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
