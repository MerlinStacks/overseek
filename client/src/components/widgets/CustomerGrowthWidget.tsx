import { WidgetProps } from './WidgetRegistry';
import { Users, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

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
            .catch(console.error)
            .finally(() => setLoading(false));
    }, [currentAccount, token, dateRange]);

    return (
        <div className={`bg-white h-full w-full p-4 flex flex-col rounded-xl shadow-sm border border-gray-200 overflow-hidden ${className}`}>
            <div className="flex justify-between items-center mb-2">
                <h3 className="font-semibold text-gray-900">Customer Growth</h3>
                <Users size={18} className="text-gray-400" />
            </div>

            <div className="flex-1 w-full relative">
                {loading ? (
                    <div className="absolute inset-0 flex justify-center items-center"><Loader2 className="animate-spin text-gray-400" /></div>
                ) : data.length === 0 ? (
                    <div className="absolute inset-0 flex justify-center items-center text-gray-400 text-sm">No data available</div>
                ) : (
                    <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                        <AreaChart data={data}>
                            <defs>
                                <linearGradient id="colorCustomers" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.1} />
                                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                                </linearGradient>
                            </defs>
                            <XAxis
                                dataKey="date"
                                // @ts-ignore
                                tickFormatter={(str: any) => {
                                    const d = new Date(String(str));
                                    return isNaN(d.getTime()) ? String(str) : d.toLocaleDateString('en-US', { month: 'short' });
                                }}
                                fontSize={12}
                                tickLine={false}
                                axisLine={false}
                            />
                            <YAxis hide />
                            <Tooltip
                                // @ts-ignore
                                labelFormatter={(label: any) => {
                                    const d = new Date(String(label));
                                    return isNaN(d.getTime()) ? String(label) : d.toLocaleDateString();
                                }}
                                // @ts-ignore
                                formatter={(value: any) => [value, 'New Customers']}
                            />
                            <Area
                                type="monotone"
                                dataKey="newCustomers"
                                stroke="#3b82f6"
                                strokeWidth={2}
                                fillOpacity={1}
                                fill="url(#colorCustomers)"
                            />
                        </AreaChart>
                    </ResponsiveContainer>
                )}
            </div>
        </div>
    );
}
