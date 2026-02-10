import { useEffect, useState, useCallback } from 'react';
import { Logger } from '../utils/logger';
import { useAuth } from '../context/AuthContext';
import { useAccount } from '../context/AccountContext';
import { useAccountFeature } from '../hooks/useAccountFeature';
import { Loader2, TrendingUp, DollarSign, Users, Package, BarChart3, PieChart, FileText, LayoutGrid, Lock } from 'lucide-react';

import { ReportBuilder } from '../components/ReportBuilder';
import { Toast, ToastType } from '../components/ui/Toast';

import { ReportsSidebar } from '../components/analytics/ReportsSidebar';
import { StockVelocityReport } from '../components/analytics/StockVelocityReport';
import { ProfitabilityReport } from '../components/analytics/ProfitabilityReport';
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
    const isAdvancedReportsEnabled = useAccountFeature('ADVANCED_REPORTS');
    const [isLoading, setIsLoading] = useState(true);

    // Date Logic
    const [dateOption, setDateOption] = useState<DateRangeOption>('today');
    const [comparisonOption, setComparisonOption] = useState<ComparisonOption>('none');

    const [salesData, setSalesData] = useState<SalesData[]>([]);
    const [topProducts, setTopProducts] = useState<TopProduct[]>([]);
    const [customerGrowth, setCustomerGrowth] = useState<CustomerGrowth[]>([]);


    const [activeTab, setActiveTab] = useState<'overview' | 'stock_velocity' | 'profitability' | 'premade' | 'custom'>('overview');

    // Template State
    const [templates, setTemplates] = useState<ReportTemplate[]>([]);
    const [customReportConfig, setCustomReportConfig] = useState<ReportTemplate['config'] | undefined>(undefined);
    const [shouldAutoRun, setShouldAutoRun] = useState(false);

    const [toastMessage, setToastMessage] = useState('');
    const [toastVisible, setToastVisible] = useState(false);
    const [toastType, setToastType] = useState<ToastType>('error');
    const showToast = useCallback((message: string, type: ToastType = 'error') => {
        setToastMessage(message); setToastType(type); setToastVisible(true);
    }, []);

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
        } catch (e) { Logger.error('Failed to load templates', { error: e }); showToast('Failed to load report templates'); }
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
            showToast('Template deleted', 'success');
        } catch (e) { Logger.error('Delete failed', { error: e }); showToast('Failed to delete template'); }
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
            Logger.error('Failed to load reports', { error: error });
            showToast('Failed to load report data');
        } finally {
            setIsLoading(false);
        }
    }

    const totalRevenue = salesData.reduce((acc, curr) => acc + curr.sales, 0);
    const newCustomersCount = customerGrowth.reduce((acc, curr) => acc + curr.newCustomers, 0);

    return (
        <>
            <div className="space-y-6">
                {/* Header */}
                <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900">Reports & Analytics</h1>
                        <p className="text-sm text-gray-500 mt-1">Deep dive into your store performance with custom and premade reports</p>
                    </div>

                    {/* Tab Navigation */}
                    <div className="flex bg-white/80 backdrop-blur-xs p-1.5 rounded-xl border border-gray-200/60 shadow-xs">
                        <button
                            onClick={() => setActiveTab('overview')}
                            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${activeTab === 'overview' ? 'bg-linear-to-r from-blue-500 to-blue-600 text-white shadow-md shadow-blue-500/20' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'}`}
                        >
                            Overview
                        </button>

                        <button
                            onClick={() => setActiveTab('stock_velocity')}
                            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${activeTab === 'stock_velocity' ? 'bg-linear-to-r from-blue-500 to-blue-600 text-white shadow-md shadow-blue-500/20' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'}`}
                        >
                            Stock Velocity
                        </button>
                        <button
                            onClick={() => setActiveTab('profitability')}
                            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${activeTab === 'profitability' ? 'bg-linear-to-r from-blue-500 to-blue-600 text-white shadow-md shadow-blue-500/20' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'}`}
                        >
                            Profitability
                        </button> //
                        <button
                            onClick={() => setActiveTab('premade')}
                            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${activeTab === 'premade' ? 'bg-linear-to-r from-purple-500 to-purple-600 text-white shadow-md shadow-purple-500/20' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'}`}
                        >
                            Report Library
                        </button>
                        <button
                            onClick={() => {
                                setShouldAutoRun(false);
                                setActiveTab('custom');
                            }}
                            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${activeTab === 'custom' ? 'bg-linear-to-r from-green-500 to-green-600 text-white shadow-md shadow-green-500/20' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'}`}
                        >
                            Custom Builder
                            {!isAdvancedReportsEnabled && <Lock size={12} className="ml-1 inline-block" />}
                        </button>
                        {!isAdvancedReportsEnabled && (activeTab === 'premade' || activeTab === 'custom' || activeTab === 'stock_velocity') && (
                            <div className="absolute inset-x-0 -bottom-12 flex justify-center pointer-events-none">
                                <div className="bg-gray-900 text-white text-xs py-1 px-3 rounded-full shadow-lg opacity-0 transition-opacity peer-hover:opacity-100">
                                    This feature requires the Advanced Reports addon.
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Date Range Selector (for applicable tabs) */}
                {(activeTab === 'overview' || activeTab === 'profitability' || activeTab === 'premade') && (
                    <div className="flex justify-end">
                        <div className="flex bg-white border border-gray-200 rounded-xl shadow-xs overflow-hidden">
                            <select
                                value={dateOption}
                                onChange={(e) => setDateOption(e.target.value as DateRangeOption)}
                                className="bg-transparent border-r border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 outline-hidden focus:bg-gray-50"
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
                                className="bg-transparent px-4 py-2.5 text-sm text-gray-500 outline-hidden focus:bg-gray-50"
                            >
                                <option value="none">No Comparison</option>
                                <option value="previous_period">vs Previous Period</option>
                                <option value="previous_year">vs Previous Year</option>
                            </select>
                        </div>
                    </div>
                )}

                {
                    activeTab === 'overview' && (
                        <>
                            {/* KPI Cards */}
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
                                    <div className="text-3xl font-bold text-gray-900">
                                        ${salesData.length ? (totalRevenue / (salesData.reduce((acc, c) => acc + c.orders, 0) || 1)).toFixed(2) : '0.00'}
                                    </div>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                                {/* Sales Chart (Custom SVG implementation for zero deps) */}
                                <div className="lg:col-span-2 bg-white p-6 rounded-xl shadow-xs border border-gray-200">
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
                                                        <div className="absolute bottom-full mb-2 hidden group-hover:block bg-gray-900 text-white text-xs p-2 rounded-sm z-10 whitespace-nowrap">
                                                            {d.date}: ${d.sales}
                                                        </div>
                                                    </div>
                                                );
                                            })
                                        )}
                                    </div>
                                </div>

                                {/* Top Products */}
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
                    )
                }



                {
                    activeTab === 'stock_velocity' && (
                        <StockVelocityReport />
                    )
                }

                {
                    activeTab === 'profitability' && (
                        <ProfitabilityReport
                            startDate={getDateRange(dateOption).startDate}
                            endDate={getDateRange(dateOption).endDate}
                        />
                    )
                }

                {
                    activeTab === 'premade' && (
                        !isAdvancedReportsEnabled ? (
                            <div className="flex flex-col items-center justify-center py-20 bg-gray-50 border border-gray-200 rounded-xl border-dashed">
                                <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mb-4">
                                    <Lock size={32} className="text-blue-600" />
                                </div>
                                <h3 className="text-lg font-bold text-gray-900">Advanced Reports Required</h3>
                                <p className="text-gray-500 max-w-md text-center mt-2">
                                    The Report Library contains powerful pre-built analysis templates.
                                    Enable the Advanced Reports feature to access this library.
                                </p>
                            </div>
                        ) : (
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
                                            <div className="p-4 bg-white rounded-2xl shadow-xs mb-4">
                                                <FileText size={48} className="text-gray-300" />
                                            </div>
                                            <p className="text-lg font-medium text-gray-500">Select a report to view details</p>
                                            <p className="text-sm text-gray-400 mt-1 max-w-xs text-center">Choose from the system templates or your saved reports on the left.</p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )
                    )
                }

                {
                    activeTab === 'custom' && (
                        !isAdvancedReportsEnabled ? (
                            <div className="flex flex-col items-center justify-center py-20 bg-gray-50 border border-gray-200 rounded-xl border-dashed">
                                <div className="w-16 h-16 bg-purple-100 rounded-full flex items-center justify-center mb-4">
                                    <Lock size={32} className="text-purple-600" />
                                </div>
                                <h3 className="text-lg font-bold text-gray-900">Custom Builder Locked</h3>
                                <p className="text-gray-500 max-w-md text-center mt-2">
                                    Build your own custom reports and dashboards with the Advanced Reports addon.
                                </p>
                            </div>
                        ) : (
                            <ReportBuilder
                                initialConfig={customReportConfig}
                                autoRun={shouldAutoRun}
                                onTemplateSaved={handleTemplateSaved}
                            />
                        )
                    )
                }
            </div >

            <Toast message={toastMessage} isVisible={toastVisible} onClose={() => setToastVisible(false)} type={toastType} />
        </>);
}
