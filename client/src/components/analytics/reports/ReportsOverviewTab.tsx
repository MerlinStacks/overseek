import { Loader2, TrendingUp, DollarSign, Users, Package } from 'lucide-react';

interface SalesData {
    date: string;
    sales: number;
    orders: number;
}

interface TopProduct {
    name: string;
    quantity: number;
}

interface CustomerGrowth {
    newCustomers: number;
}

interface ReportsOverviewTabProps {
    isLoading: boolean;
    salesData: SalesData[];
    topProducts: TopProduct[];
    customerGrowth: CustomerGrowth[];
}

export function ReportsOverviewTab({ isLoading, salesData, topProducts, customerGrowth }: ReportsOverviewTabProps) {
    const totalRevenue = salesData.reduce((acc, curr) => acc + curr.sales, 0);
    const newCustomersCount = customerGrowth.reduce((acc, curr) => acc + curr.newCustomers, 0);
    const totalOrders = salesData.reduce((acc, curr) => acc + curr.orders, 0);
    const avgOrderValue = totalOrders > 0 ? (totalRevenue / totalOrders).toFixed(2) : '0.00';
    const maxSales = Math.max(...salesData.map(s => s.sales), 1);

    return (
        <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-white p-6 rounded-xl shadow-xs border border-gray-200">
                    <div className="flex items-center gap-3 text-gray-500 mb-2">
                        <div className="p-2 bg-green-100 text-green-600 rounded-lg"><DollarSign size={20} /></div>
                        <span className="text-sm font-medium">Total Revenue</span>
                    </div>
                    <div className="text-3xl font-bold text-gray-900">${totalRevenue.toLocaleString()}</div>
                </div>
                <div className="bg-white p-6 rounded-xl shadow-xs border border-gray-200">
                    <div className="flex items-center gap-3 text-gray-500 mb-2">
                        <div className="p-2 bg-blue-100 text-blue-600 rounded-lg"><Users size={20} /></div>
                        <span className="text-sm font-medium">New Customers</span>
                    </div>
                    <div className="text-3xl font-bold text-gray-900">{newCustomersCount}</div>
                </div>
                <div className="bg-white p-6 rounded-xl shadow-xs border border-gray-200">
                    <div className="flex items-center gap-3 text-gray-500 mb-2">
                        <div className="p-2 bg-purple-100 text-purple-600 rounded-lg"><TrendingUp size={20} /></div>
                        <span className="text-sm font-medium">Avg Order Value</span>
                    </div>
                    <div className="text-3xl font-bold text-gray-900">${avgOrderValue}</div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 bg-white p-6 rounded-xl shadow-xs border border-gray-200">
                    <h3 className="text-lg font-bold text-gray-900 mb-6">Revenue Trend</h3>
                    <div className="h-64 relative flex items-end justify-between gap-1">
                        {isLoading ? (
                            <div className="w-full h-full flex items-center justify-center"><Loader2 className="animate-spin text-blue-600" /></div>
                        ) : salesData.length === 0 ? (
                            <div className="w-full h-full flex items-center justify-center text-gray-400">No data available</div>
                        ) : (
                            salesData.map((d, i) => {
                                const height = (d.sales / maxSales) * 100;
                                return (
                                    <div key={i} className="flex-1 flex flex-col justify-end group relative items-center">
                                        <div className="w-full bg-blue-500 hover:bg-blue-600 transition-all rounded-t-sm" style={{ height: `${height}%` }} />
                                        <div className="absolute bottom-full mb-2 hidden group-hover:block bg-gray-900 text-white text-xs p-2 rounded-sm z-10 whitespace-nowrap">
                                            {d.date}: ${d.sales}
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>

                <div className="bg-white p-6 rounded-xl shadow-xs border border-gray-200">
                    <h3 className="text-lg font-bold text-gray-900 mb-6">Top Selling Products</h3>
                    <div className="space-y-4">
                        {isLoading ? (
                            <div className="flex justify-center p-4"><Loader2 className="animate-spin text-blue-600" /></div>
                        ) : topProducts.length === 0 ? (
                            <div className="text-center text-gray-400 py-8">No products yet</div>
                        ) : topProducts.map((p, i) => (
                            <div key={i} className="flex items-center justify-between">
                                <div className="flex items-center gap-3 overflow-hidden">
                                    <div className="w-8 h-8 rounded-sm bg-gray-100 flex items-center justify-center text-gray-400 shrink-0">
                                        <Package size={14} />
                                    </div>
                                    <span className="text-sm font-medium text-gray-900 truncate">{p.name || 'Unknown Product'}</span>
                                </div>
                                <span className="text-sm font-bold text-gray-900">{p.quantity} sold</span>
                            </div>
                        ))}
                    </div>
                    <button className="w-full mt-6 py-2 text-sm text-blue-600 font-medium hover:bg-blue-50 rounded-lg transition-colors">
                        View All Products
                    </button>
                </div>
            </div>
        </>
    );
}
