import { WidgetProps } from './WidgetRegistry';
import { Logger } from '../../utils/logger';
import { formatCurrency } from '../../utils/format';
import { BarChart3, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import { echarts, graphic, type EChartsOption, type SeriesOption } from '../../utils/echarts';


export function SalesChartWidget({ className, dateRange, comparison }: WidgetProps) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [data, setData] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!currentAccount) return;

        const fetchData = async () => {
            setLoading(true);
            try {
                // Fetch Current
                const currentRes = await fetch(`/api/analytics/sales-chart?startDate=${dateRange.startDate}&endDate=${dateRange.endDate}&interval=day`, {
                    headers: { 'Authorization': `Bearer ${token}`, 'X-Account-ID': currentAccount.id }
                });
                const currentRaw = await currentRes.json();

                const processedData: any[] = [];
                const currentArr = Array.isArray(currentRaw) ? currentRaw : [];

                // Fetch Comparison if needed
                let comparisonArr: any[] = [];
                if (comparison) {
                    const compRes = await fetch(`/api/analytics/sales-chart?startDate=${comparison.startDate}&endDate=${comparison.endDate}&interval=day`, {
                        headers: { 'Authorization': `Bearer ${token}`, 'X-Account-ID': currentAccount.id }
                    });
                    comparisonArr = await compRes.json();
                    if (!Array.isArray(comparisonArr)) comparisonArr = [];
                }

                // Merge Data
                const maxLength = Math.max(currentArr.length, comparisonArr.length);

                for (let i = 0; i < maxLength; i++) {
                    const curr = currentArr[i] || {};
                    const comp = comparisonArr[i] || {};

                    processedData.push({
                        date: curr.date || `Day ${i + 1}`,
                        sales: curr.sales || 0,
                        comparisonSales: comparison ? (comp.sales || 0) : undefined,
                    });
                }

                setData(processedData);

            } catch (err) {
                Logger.error('An error occurred', { error: err });
            } finally {
                setLoading(false);
            }
        };

        fetchData();

    }, [currentAccount, token, dateRange, comparison]);

    const getChartOptions = (): EChartsOption => {
        const dates = data.map(d => {
            const s = String(d.date);
            if (s.startsWith('Day')) return s;
            const date = new Date(s);
            return isNaN(date.getTime()) ? s : date.toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
        });
        const salesValues = data.map(d => d.sales);
        const comparisonValues = comparison ? data.map(d => d.comparisonSales ?? 0) : [];

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

        return {
            grid: { top: 10, right: 10, left: 40, bottom: 30 },
            xAxis: {
                type: 'category',
                data: dates,
                axisLine: { show: false },
                axisTick: { show: false },
                axisLabel: { fontSize: 10, color: '#6b7280' }
            },
            yAxis: {
                type: 'value',
                axisLine: { show: false },
                axisTick: { show: false },
                axisLabel: {
                    fontSize: 10,
                    color: '#6b7280',
                    formatter: (value: number) => `$${value}`
                },
                splitLine: { lineStyle: { color: '#f3f4f6', type: 'dashed' } }
            },
            tooltip: {
                trigger: 'axis',
                formatter: (params: any) => {
                    if (!Array.isArray(params) || params.length === 0) return '';
                    const date = params[0].axisValue;
                    let html = `<div style="font-weight:600;margin-bottom:4px">${date}</div>`;
                    params.forEach((p: any) => {
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
        <div className={`bg-white dark:bg-slate-800/90 h-full w-full p-5 flex flex-col rounded-2xl shadow-[0_1px_3px_rgba(0,0,0,0.05),0_1px_2px_rgba(0,0,0,0.03)] dark:shadow-[0_1px_3px_rgba(0,0,0,0.2)] border border-slate-200/80 dark:border-slate-700/50 overflow-hidden min-h-[300px] transition-all duration-300 hover:shadow-[0_10px_40px_rgba(0,0,0,0.08)] dark:hover:shadow-[0_10px_40px_rgba(0,0,0,0.3)] ${className}`} style={{ minHeight: '300px' }}>
            <div className="flex justify-between items-center mb-3">
                <h3 className="font-semibold text-slate-900 dark:text-white">
                    Sales Trend {currentAccount?.revenueTaxInclusive !== false ? '(Tax Inclusive)' : '(Tax Exclusive)'}
                </h3>
                <div className="p-2 bg-gradient-to-br from-blue-400 to-violet-500 rounded-lg text-white shadow-md shadow-blue-500/20">
                    <BarChart3 size={16} />
                </div>
            </div>

            <div className="flex-1 w-full relative">
                {loading ? (
                    <div className="absolute inset-0 flex justify-center items-center"><Loader2 className="animate-spin text-slate-400" /></div>
                ) : data.length === 0 ? (
                    <div className="absolute inset-0 flex justify-center items-center text-slate-400 dark:text-slate-500 text-sm">No data available</div>
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
