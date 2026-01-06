import React, { useState, useEffect } from 'react';
import { useAccount } from '../../context/AccountContext';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../services/api';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card';
import { Users, Repeat, DollarSign, Crown } from 'lucide-react';

interface LTVData {
    avgLTV: number;
    totalCustomers: number;
    repeatCustomers: number;
    repeatRate: number;
    topCustomers: { customerId: string; ltv: number; orders: number }[];
}

export const CustomersPage: React.FC = () => {
    const { currentAccount } = useAccount();
    const { token } = useAuth();
    const [data, setData] = useState<LTVData | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchData = async () => {
            if (!currentAccount || !token) return;
            setLoading(true);
            try {
                const result = await api.get<LTVData>('/api/tracking/ltv', token, currentAccount.id);
                setData(result);
            } catch (error) {
                console.error('Failed to fetch LTV:', error);
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, [currentAccount, token]);

    if (loading) {
        return (
            <div className="p-6 flex items-center justify-center h-64">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
        );
    }

    if (!data) {
        return <div className="p-6 text-gray-500">No customer data available</div>;
    }

    return (
        <div className="p-6 space-y-6">
            <div>
                <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                    <Users className="w-6 h-6" />
                    Customer Analytics
                </h1>
                <p className="text-sm text-gray-500 mt-1">Understand your customer lifetime value and retention.</p>
            </div>

            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <Card className="border-0 shadow-sm">
                    <CardContent className="p-6">
                        <div className="flex items-center gap-3">
                            <div className="p-3 bg-green-100 rounded-xl">
                                <DollarSign className="w-6 h-6 text-green-600" />
                            </div>
                            <div>
                                <p className="text-sm text-gray-500">Avg. LTV</p>
                                <p className="text-2xl font-bold text-gray-900">${data.avgLTV.toFixed(2)}</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
                <Card className="border-0 shadow-sm">
                    <CardContent className="p-6">
                        <div className="flex items-center gap-3">
                            <div className="p-3 bg-blue-100 rounded-xl">
                                <Users className="w-6 h-6 text-blue-600" />
                            </div>
                            <div>
                                <p className="text-sm text-gray-500">Total Customers</p>
                                <p className="text-2xl font-bold text-gray-900">{data.totalCustomers.toLocaleString()}</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
                <Card className="border-0 shadow-sm">
                    <CardContent className="p-6">
                        <div className="flex items-center gap-3">
                            <div className="p-3 bg-purple-100 rounded-xl">
                                <Repeat className="w-6 h-6 text-purple-600" />
                            </div>
                            <div>
                                <p className="text-sm text-gray-500">Repeat Customers</p>
                                <p className="text-2xl font-bold text-gray-900">{data.repeatCustomers.toLocaleString()}</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
                <Card className="border-0 shadow-sm">
                    <CardContent className="p-6">
                        <div className="flex items-center gap-3">
                            <div className="p-3 bg-orange-100 rounded-xl">
                                <Repeat className="w-6 h-6 text-orange-600" />
                            </div>
                            <div>
                                <p className="text-sm text-gray-500">Repeat Rate</p>
                                <p className="text-2xl font-bold text-gray-900">{data.repeatRate}%</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Top Customers */}
            <Card className="border-0 shadow-sm">
                <CardHeader>
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                        <Crown className="w-4 h-4 text-yellow-500" />
                        Top Customers by Lifetime Value
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-gray-100">
                                    <th className="text-left py-3 font-medium text-gray-500">Rank</th>
                                    <th className="text-left py-3 font-medium text-gray-500">Customer</th>
                                    <th className="text-right py-3 font-medium text-gray-500">Orders</th>
                                    <th className="text-right py-3 font-medium text-gray-500">Lifetime Value</th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.topCustomers.map((customer, index) => (
                                    <tr key={customer.customerId} className="border-b border-gray-50 hover:bg-gray-50/50">
                                        <td className="py-3">
                                            <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${index === 0 ? 'bg-yellow-100 text-yellow-700' :
                                                index === 1 ? 'bg-gray-200 text-gray-700' :
                                                    index === 2 ? 'bg-orange-100 text-orange-700' :
                                                        'bg-gray-100 text-gray-500'
                                                }`}>
                                                {index + 1}
                                            </span>
                                        </td>
                                        <td className="py-3">
                                            <span className="font-medium text-gray-900">
                                                {customer.customerId.includes('@')
                                                    ? customer.customerId
                                                    : `Customer #${customer.customerId.slice(0, 8)}`}
                                            </span>
                                        </td>
                                        <td className="py-3 text-right text-gray-600">{customer.orders}</td>
                                        <td className="py-3 text-right">
                                            <span className="font-bold text-green-600">${customer.ltv.toLocaleString()}</span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
};

export default CustomersPage;
