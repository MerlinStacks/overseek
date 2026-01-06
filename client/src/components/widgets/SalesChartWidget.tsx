import { WidgetProps } from './WidgetRegistry';
import { BarChart3, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

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

                let processedData: any[] = [];
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

                // Merge Data for Recharts
                // We map by index to overlay them roughly
                // X - Axis will show Current Period Dates
                const maxLength = Math.max(currentArr.length, comparisonArr.length);

                for (let i = 0; i < maxLength; i++) {
                    const curr = currentArr[i] || {};
                    const comp = comparisonArr[i] || {};

                    processedData.push({
                        date: curr.date || `Day ${i + 1}`, // Use current date for X-axis label
                        sales: curr.sales || 0,
                        comparisonSales: comparison ? (comp.sales || 0) : undefined,
                        comparisonDate: comp.date // Store for tooltip maybe?
                    });
                }

                setData(processedData);

            } catch (err) {
                console.error(err);
            } finally {
                setLoading(false);
            }
        };

        fetchData();

    }, [currentAccount, token, dateRange, comparison]);

    return (
    return (
        <div className={`bg-white h-full w-full p-4 flex flex-col rounded-xl shadow-sm border border-gray-200 overflow-hidden min-h-[300px] ${className}`}>
            <div className="flex justify-between items-center mb-2">
                <h3 className="font-semibold text-gray-900">Sales Trend</h3>
                <BarChart3 size={18} className="text-gray-400" />
            </div>

            <div className="flex-1 w-full relative">
                {loading ? (
                    <div className="absolute inset-0 flex justify-center items-center"><Loader2 className="animate-spin text-gray-400" /></div>
                ) : data.length === 0 ? (
                    <div className="absolute inset-0 flex justify-center items-center text-gray-400 text-sm">No data available</div>
                ) : (
                    <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                        <AreaChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                            <defs>
                                <linearGradient id="colorSales" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#22c55e" stopOpacity={0.1} />
                                    <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                                </linearGradient>
                                <linearGradient id="colorComp" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#9ca3af" stopOpacity={0.1} />
                                    <stop offset="95%" stopColor="#9ca3af" stopOpacity={0} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                            <XAxis
                                dataKey="date"
                                tickFormatter={(value: any) => {
                                    // If strict "Day X" string, keep it. Else format date.
                                    const s = String(value);
                                    if (s.startsWith('Day')) return s;
                                    const d = new Date(s);
                                    return isNaN(d.getTime()) ? s : d.toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
                                }}
                                fontSize={10}
                                tickLine={false}
                                axisLine={false}
                                minTickGap={30}
                            />
                            <YAxis
                                fontSize={10}
                                tickLine={false}
                                axisLine={false}
                                tickFormatter={(value: any) => `$${value}`}
                            />
                            <Tooltip
                                labelFormatter={(label: string | number) => {
                                    const str = String(label);
                                    if (str.startsWith('Day')) return str;
                                    const d = new Date(str);
                                    return isNaN(d.getTime()) ? str : d.toLocaleDateString();
                                }}
                                formatter={(value: any, name: any) => [
                                    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value) || 0),
                                    name === 'sales' ? 'Current Period' : 'Comparison'
                                ]}
                            />
                            {/* Comparison Layer (Gray) */}
                            {comparison && (
                                <Area
                                    type="monotone"
                                    dataKey="comparisonSales"
                                    stroke="#9ca3af"
                                    strokeWidth={2}
                                    strokeDasharray="4 4"
                                    fillOpacity={1}
                                    fill="url(#colorComp)"
                                    name="comparisonSales"
                                />
                            )}

                            {/* Current Layer (Green) */}
                            <Area
                                type="monotone"
                                dataKey="sales"
                                stroke="#22c55e"
                                strokeWidth={2}
                                fillOpacity={1}
                                fill="url(#colorSales)"
                                name="sales"
                            />
                        </AreaChart>
                    </ResponsiveContainer>
                )}
            </div>
        </div>
    );
}
