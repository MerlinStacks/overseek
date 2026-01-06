import React, { useState, useEffect } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useAccount } from '../../context/AccountContext';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../services/api';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card';
import { DollarSign, TrendingUp, ShoppingCart, Globe, Monitor, Smartphone, Tablet } from 'lucide-react';

interface RevenueData {
    totalRevenue: number;
    orderCount: number;
    aov: number;
    byFirstTouch: { source: string; revenue: number }[];
    byLastTouch: { source: string; revenue: number }[];
    byCountry: { country: string; revenue: number }[];
    byDevice: { device: string; revenue: number }[];
}

export const RevenuePage: React.FC = () => {
    const [days, setDays] = useState(30);
    const { currentAccount } = useAccount();
    const { token } = useAuth();
    const [data, setData] = useState<RevenueData | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchData = async () => {
            if (!currentAccount || !token) return;
            setLoading(true);
            try {
                const result = await api.get<RevenueData>(`/api/tracking/revenue?days=${days}`, token, currentAccount.id);
                setData(result);
            } catch (error) {
                console.error('Failed to fetch revenue:', error);
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, [currentAccount, token, days]);

    const getDeviceIcon = (device: string) => {
        switch (device) {
            case 'mobile': return <Smartphone className="w-4 h-4" />;
            case 'tablet': return <Tablet className="w-4 h-4" />;
            default: return <Monitor className="w-4 h-4" />;
        }
    };

    if (loading) {
        return (
            <div className="p-6 flex items-center justify-center h-64">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
        );
    }

    if (!data) {
        return <div className="p-6 text-gray-500">No data available</div>;
    }

    return (
        <div className="p-6 space-y-6">
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold text-gray-900">Revenue Analytics</h1>
                <DateRangeFilter value={days} onChange={setDays} />
            </div>

            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card className="border-0 shadow-sm">
                    <CardContent className="p-6">
                        <div className="flex items-center gap-3">
                            <div className="p-3 bg-green-100 rounded-xl">
                                <DollarSign className="w-6 h-6 text-green-600" />
                            </div>
                            <div>
                                <p className="text-sm text-gray-500">Total Revenue</p>
                                <p className="text-2xl font-bold text-gray-900">${data.totalRevenue.toLocaleString()}</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
                <Card className="border-0 shadow-sm">
                    <CardContent className="p-6">
                        <div className="flex items-center gap-3">
                            <div className="p-3 bg-blue-100 rounded-xl">
                                <ShoppingCart className="w-6 h-6 text-blue-600" />
                            </div>
                            <div>
                                <p className="text-sm text-gray-500">Orders</p>
                                <p className="text-2xl font-bold text-gray-900">{data.orderCount}</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
                <Card className="border-0 shadow-sm">
                    <CardContent className="p-6">
                        <div className="flex items-center gap-3">
                            <div className="p-3 bg-purple-100 rounded-xl">
                                <TrendingUp className="w-6 h-6 text-purple-600" />
                            </div>
                            <div>
                                <p className="text-sm text-gray-500">Avg Order Value</p>
                                <p className="text-2xl font-bold text-gray-900">${data.aov.toFixed(2)}</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Revenue by Source */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Card className="border-0 shadow-sm">
                    <CardHeader>
                        <CardTitle className="text-sm font-semibold">Revenue by First Touch</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-3">
                            {data.byFirstTouch.slice(0, 8).map(item => {
                                const maxRevenue = data.byFirstTouch[0]?.revenue || 1;
                                const percentage = (item.revenue / maxRevenue) * 100;
                                return (
                                    <div key={item.source}>
                                        <div className="flex justify-between text-sm mb-1">
                                            <span className="capitalize text-gray-700">{item.source}</span>
                                            <span className="font-medium">${item.revenue.toLocaleString()}</span>
                                        </div>
                                        <div className="w-full bg-gray-100 rounded-full h-2">
                                            <div
                                                className="bg-blue-500 h-2 rounded-full transition-all"
                                                style={{ width: `${percentage}%` }}
                                            />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </CardContent>
                </Card>

                <Card className="border-0 shadow-sm">
                    <CardHeader>
                        <CardTitle className="text-sm font-semibold">Revenue by Last Touch</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-3">
                            {data.byLastTouch.slice(0, 8).map(item => {
                                const maxRevenue = data.byLastTouch[0]?.revenue || 1;
                                const percentage = (item.revenue / maxRevenue) * 100;
                                return (
                                    <div key={item.source}>
                                        <div className="flex justify-between text-sm mb-1">
                                            <span className="capitalize text-gray-700">{item.source}</span>
                                            <span className="font-medium">${item.revenue.toLocaleString()}</span>
                                        </div>
                                        <div className="w-full bg-gray-100 rounded-full h-2">
                                            <div
                                                className="bg-green-500 h-2 rounded-full transition-all"
                                                style={{ width: `${percentage}%` }}
                                            />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Revenue by Country & Device */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Card className="border-0 shadow-sm">
                    <CardHeader>
                        <CardTitle className="text-sm font-semibold flex items-center gap-2">
                            <Globe className="w-4 h-4" /> Revenue by Country
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-2">
                            {data.byCountry.map(item => (
                                <div key={item.country} className="flex justify-between text-sm py-1.5 border-b border-gray-50 last:border-0">
                                    <span className="text-gray-700">{item.country}</span>
                                    <span className="font-medium">${item.revenue.toLocaleString()}</span>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>

                <Card className="border-0 shadow-sm">
                    <CardHeader>
                        <CardTitle className="text-sm font-semibold">Revenue by Device</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="flex gap-4">
                            {data.byDevice.map(item => (
                                <div key={item.device} className="flex-1 bg-gray-50 rounded-xl p-4 text-center">
                                    <div className="flex justify-center mb-2 text-gray-500">
                                        {getDeviceIcon(item.device)}
                                    </div>
                                    <p className="text-xs text-gray-500 capitalize">{item.device}</p>
                                    <p className="text-lg font-bold text-gray-900">${item.revenue.toLocaleString()}</p>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
};

export default RevenuePage;
