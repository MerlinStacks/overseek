import { WidgetProps } from './WidgetRegistry';
import { Logger } from '../../utils/logger';
import { Users, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import { echarts, graphic, type EChartsOption } from '../../utils/echarts';


export function CustomerGrowthWidget({ className, dateRange }: WidgetProps) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [data, setData] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!currentAccount) return;

        fetch(`/api/analytics/customer-growth?startDate=${dateRange.startDate}&endDate=${dateRange.endDate}`, {
            headers: { 'Authorization': `Bearer ${token}`, 'X-Account-ID': currentAccount.id }
        })
            .then(res => res.json())
            .then(resData => setData(Array.isArray(resData) ? resData : []))
            .catch(e => Logger.error('Failed to fetch customer growth', { error: e }))
            .finally(() => setLoading(false));
    }, [currentAccount, token, dateRange]);

    const getChartOptions = (): EChartsOption => {
        const dates = data.map(d => {
            const date = new Date(String(d.date));
            return isNaN(date.getTime()) ? String(d.date) : date.toLocaleDateString('en-US', { month: 'short' });
        });
        const values = data.map(d => d.newCustomers || 0);

        return {
            grid: { top: 10, right: 10, left: 10, bottom: 30 },
            xAxis: {
                type: 'category',
                data: dates,
                axisLine: { show: false },
                axisTick: { show: false },
                axisLabel: { fontSize: 12, color: '#6b7280' }
            },
            yAxis: {
                type: 'value',
                show: false
            },
            tooltip: {
                trigger: 'axis',
                formatter: (params: any) => {
                    if (!Array.isArray(params) || params.length === 0) return '';
                    const date = new Date(String(data[params[0].dataIndex]?.date));
                    const label = isNaN(date.getTime()) ? params[0].axisValue : date.toLocaleDateString();
                    return `<div style="font-weight:600;margin-bottom:4px">${label}</div><div>New Customers: ${params[0].value}</div>`;
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
        <div className={`bg-white dark:bg-slate-800/90 h-full w-full p-5 flex flex-col rounded-2xl shadow-[0_1px_3px_rgba(0,0,0,0.05),0_1px_2px_rgba(0,0,0,0.03)] dark:shadow-[0_1px_3px_rgba(0,0,0,0.2)] border border-slate-200/80 dark:border-slate-700/50 overflow-hidden min-h-[200px] transition-all duration-300 hover:shadow-[0_10px_40px_rgba(0,0,0,0.08)] dark:hover:shadow-[0_10px_40px_rgba(0,0,0,0.3)] ${className}`} style={{ minHeight: '200px' }}>
            <div className="flex justify-between items-center mb-3">
                <h3 className="font-semibold text-slate-900 dark:text-white">Customer Growth</h3>
                <div className="p-2 bg-gradient-to-br from-cyan-400 to-blue-500 rounded-lg text-white shadow-md shadow-blue-500/20">
                    <Users size={16} />
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
