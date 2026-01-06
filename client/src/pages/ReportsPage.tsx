import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useAccount } from '../context/AccountContext';
import { useNavigate } from 'react-router-dom';
import { Loader2, TrendingUp, DollarSign, Users, Package, BarChart3, PieChart, FileText, LayoutGrid } from 'lucide-react';
import { ForecastChart } from '../components/ForecastChart';
import { ReportBuilder } from '../components/ReportBuilder';

import { ReportsSidebar } from '../components/analytics/ReportsSidebar';
import { StockVelocityReport } from '../components/analytics/StockVelocityReport';
import { getDateRange, getComparisonRange, DateRangeOption, ComparisonOption } from '../utils/dateUtils';
import { ReportTemplate } from '../types/analytics';

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
    date: string;
    newCustomers: number;
}

export function ReportsPage() {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [isLoading, setIsLoading] = useState(true);

    // Date Logic
    const [dateOption, setDateOption] = useState<DateRangeOption>('today');
    const [comparisonOption, setComparisonOption] = useState<ComparisonOption>('none');

    const [salesData, setSalesData] = useState<SalesData[]>([]);
    const [topProducts, setTopProducts] = useState<TopProduct[]>([]);
    const [customerGrowth, setCustomerGrowth] = useState<CustomerGrowth[]>([]);


    const [activeTab, setActiveTab] = useState<'overview' | 'forecast' | 'stock_velocity' | 'premade' | 'custom'>('overview');

    // Template State
    const [templates, setTemplates] = useState<ReportTemplate[]>([]);
    const [customReportConfig, setCustomReportConfig] = useState<ReportTemplate['config'] | undefined>(undefined);
    const [shouldAutoRun, setShouldAutoRun] = useState(false);

    useEffect(() => {
        fetchTemplates();
        fetchData();
    }, [currentAccount, token, dateOption]);

    const fetchTemplates = async () => {
        if (!currentAccount || !token) return;
        try {
            const res = await fetch('/api/analytics/templates', {
                headers: { 'Authorization': `Bearer ${token}`, 'X-Account-ID': currentAccount.id }
            });
            if (res.ok) {
                setTemplates(await res.json());
            }
        } catch (e) { console.error('Failed to load templates', e); }
    };

    const handleSelectTemplate = (template: ReportTemplate) => {
        setCustomReportConfig({
            ...template.config,
            dateRange: dateOption // Override with currently selected date option
        });
        setShouldAutoRun(true);
        // Do NOT switch tabs, stay on 'premade' but update the view
        // setActiveTab('custom'); 
    };

    const handleDeleteTemplate = async (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        if (!confirm('Are you sure?')) return;
        try {
            await fetch(`/api/analytics/templates/${id}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}`, 'X-Account-ID': currentAccount!.id }
            });
            fetchTemplates();
        } catch (e) { console.error('Delete failed', e); }
    };

    const handleTemplateSaved = () => {
        fetchTemplates();
    };

    async function fetchData() {
        if (!currentAccount || !token) return;
        setIsLoading(true);

        const range = getDateRange(dateOption);

        try {
            const headers = { 'Authorization': `Bearer ${token}`, 'X-Account-ID': currentAccount.id };

            const [salesRes, productsRes, customersRes] = await Promise.all([
                fetch(`/api/analytics/sales-chart?startDate=${range.startDate}&endDate=${range.endDate}&interval=day`, { headers }),
                fetch(`/api/analytics/top-products?startDate=${range.startDate}&endDate=${range.endDate}`, { headers }),
                fetch(`/api/analytics/customer-growth?startDate=${range.startDate}&endDate=${range.endDate}`, { headers })
            ]);

            if (salesRes.ok) setSalesData(await salesRes.json());
            if (productsRes.ok) setTopProducts(await productsRes.json());
            if (customersRes.ok) setCustomerGrowth(await customersRes.json());

        } catch (error) {
            console.error('Failed to load reports', error);
        } finally {
            setIsLoading(false);
        }
    }

    const totalRevenue = salesData.reduce((acc, curr) => acc + curr.sales, 0);
    const newCustomersCount = customerGrowth.reduce((acc, curr) => acc + curr.newCustomers, 0);

    return (
        <div className="space-y-6">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">Reports</h1>
                    <p className="text-sm text-gray-500">Deep dive into your store performance</p>
                </div>

                <div className="flex bg-gray-100 p-1 rounded-lg">
                    <button
                        onClick={() => setActiveTab('overview')}
                        className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${activeTab === 'overview' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-900'}`}
                    >
                        Overview
                    </button>
                    <button
                        onClick={() => setActiveTab('forecast')}
                        className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${activeTab === 'forecast' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-900'}`}
                    >
                        Forecasting
                    </button>
                    <button
                        onClick={() => setActiveTab('stock_velocity')}
                        className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${activeTab === 'stock_velocity' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-900'}`}
                    >
                        Stock Velocity
                    </button>
                    <button
                        onClick={() => setActiveTab('premade')}
                        className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${activeTab === 'premade' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-900'}`}
                    >
                        Premade Reports
                    </button>
                    <button
                        onClick={() => {
                            setShouldAutoRun(false);
                            setActiveTab('custom');
                        }}
                        className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${activeTab === 'custom' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-900'}`}
                    >
                        Custom Reports
                    </button>
                </div>

                {(activeTab === 'overview' || activeTab === 'forecast' || activeTab === 'premade') && (
                    <div className="flex bg-white border border-gray-200 rounded-lg shadow-sm">
                        <select
                            value={dateOption}
                            onChange={(e) => setDateOption(e.target.value as DateRangeOption)}
                            className="bg-transparent border-r border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 outline-none focus:bg-gray-50"
                        >
                            <option value="today">Today</option>
                            <option value="yesterday">Yesterday</option>
                            <option value="7d">Last 7 Days</option>
                            <option value="30d">Last 30 Days</option>
                            <option value="90d">Last 90 Days</option>
                            <option value="ytd">Year to Date</option>
                            <option value="all">All Time</option>
                        </select>
                        <select
                            value={comparisonOption}
                            onChange={(e) => setComparisonOption(e.target.value as ComparisonOption)}
                            className="bg-transparent px-3 py-2 text-sm text-gray-500 outline-none focus:bg-gray-50"
                        >
                            <option value="none">No Comparison</option>
                            <option value="previous_period">vs Previous Period</option>
                            <option value="previous_year">vs Previous Year</option>
                        </select>
                    </div>
                )}
            </div>

            {
                activeTab === 'overview' && (
                    <>
                        {/* KPI Cards */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
                                <div className="flex items-center gap-3 text-gray-500 mb-2">
                                    <div className="p-2 bg-green-100 text-green-600 rounded-lg"><DollarSign size={20} /></div>
                                    <span className="text-sm font-medium">Total Revenue</span>
                                </div>
                                <div className="text-3xl font-bold text-gray-900">${totalRevenue.toLocaleString()}</div>
                            </div>
                            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
                                <div className="flex items-center gap-3 text-gray-500 mb-2">
                                    <div className="p-2 bg-blue-100 text-blue-600 rounded-lg"><Users size={20} /></div>
                                    <span className="text-sm font-medium">New Customers</span>
                                </div>
                                <div className="text-3xl font-bold text-gray-900">{newCustomersCount}</div>
                            </div>
                            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
                                <div className="flex items-center gap-3 text-gray-500 mb-2">
                                    <div className="p-2 bg-purple-100 text-purple-600 rounded-lg"><TrendingUp size={20} /></div>
                                    <span className="text-sm font-medium">Avg Order Value</span>
                                </div>
                                <div className="text-3xl font-bold text-gray-900">
                                    ${salesData.length ? (totalRevenue / (salesData.reduce((acc, c) => acc + c.orders, 0) || 1)).toFixed(2) : '0.00'}
                                </div>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                            {/* Sales Chart (Custom SVG implementation for zero deps) */}
                            <div className="lg:col-span-2 bg-white p-6 rounded-xl shadow-sm border border-gray-200">
                                <h3 className="text-lg font-bold text-gray-900 mb-6">Revenue Trend</h3>
                                <div className="h-64 relative flex items-end justify-between gap-1">
                                    {isLoading ? (
                                        <div className="w-full h-full flex items-center justify-center"><Loader2 className="animate-spin text-blue-600" /></div>
                                    ) : salesData.length === 0 ? (
                                        <div className="w-full h-full flex items-center justify-center text-gray-400">No data available</div>
                                    ) : (
                                        salesData.map((d, i) => {
                                            const maxSales = Math.max(...salesData.map(s => s.sales), 1);
                                            const height = (d.sales / maxSales) * 100;
                                            return (
                                                <div key={i} className="flex-1 flex flex-col justify-end group relative items-center">
                                                    <div
                                                        className="w-full bg-blue-500 hover:bg-blue-600 transition-all rounded-t-sm"
                                                        style={{ height: `${height}%` }}
                                                    ></div>
                                                    {/* Tooltip */}
                                                    <div className="absolute bottom-full mb-2 hidden group-hover:block bg-gray-900 text-white text-xs p-2 rounded z-10 whitespace-nowrap">
                                                        {d.date}: ${d.sales}
                                                    </div>
                                                </div>
                                            );
                                        })
                                    )}
                                </div>
                            </div>

                            {/* Top Products */}
                            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
                                <h3 className="text-lg font-bold text-gray-900 mb-6">Top Selling Products</h3>
                                <div className="space-y-4">
                                    {isLoading ? (
                                        <div className="flex justify-center p-4"><Loader2 className="animate-spin text-blue-600" /></div>
                                    ) : topProducts.length === 0 ? (
                                        <div className="text-center text-gray-400 py-8">No products yet</div>
                                    ) : topProducts.map((p, i) => (
                                        <div key={i} className="flex items-center justify-between">
                                            <div className="flex items-center gap-3 overflow-hidden">
                                                <div className="w-8 h-8 rounded bg-gray-100 flex items-center justify-center text-gray-400 flex-shrink-0">
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
                )
            }

            {
                activeTab === 'forecast' && (
                    <ForecastChart dateRange={getDateRange(dateOption)} />
                )
            }

            {
                activeTab === 'stock_velocity' && (
                    <StockVelocityReport />
                )
            }

            {
                activeTab === 'premade' && (
                    <div className="flex gap-6 items-start h-[calc(100vh-14rem)]">
                        <ReportsSidebar
                            templates={templates}
                            selectedTemplateId={undefined} // We could track selected ID state if we wanted to highlight logic
                            onSelect={handleSelectTemplate}
                            onDelete={handleDeleteTemplate}
                        />
                        <div className="flex-1 h-full min-h-0 overflow-hidden">
                            {customReportConfig ? (
                                <ReportBuilder
                                    initialConfig={customReportConfig}
                                    autoRun={shouldAutoRun}
                                    viewMode={true}
                                    onTemplateSaved={handleTemplateSaved}
                                />
                            ) : (
                                <div className="h-full flex flex-col items-center justify-center text-gray-400 border border-gray-200/60 rounded-2xl bg-gray-50/30">
                                    <div className="p-4 bg-white rounded-2xl shadow-sm mb-4">
                                        <FileText size={48} className="text-gray-300" />
                                    </div>
                                    <p className="text-lg font-medium text-gray-500">Select a report to view details</p>
                                    <p className="text-sm text-gray-400 mt-1 max-w-xs text-center">Choose from the system templates or your saved reports on the left.</p>
                                </div>
                            )}
                        </div>
                    </div>
                )
            }

            {
                activeTab === 'custom' && (
                    <ReportBuilder
                        initialConfig={customReportConfig}
                        autoRun={shouldAutoRun}
                        onTemplateSaved={handleTemplateSaved}
                    />
                )
            }
        </div >
    );
}
