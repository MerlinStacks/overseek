import { useEffect, useState, useCallback } from 'react';
import { Logger } from '../utils/logger';
import { useAuth } from '../context/AuthContext';
import { useAccount } from '../context/AccountContext';
import { useAccountFeature } from '../hooks/useAccountFeature';
import { FileText, Plus } from 'lucide-react';

import { ReportBuilder } from '../components/ReportBuilder';
import { Toast, ToastType } from '../components/ui/Toast';

import { ReportsSidebar } from '../components/analytics/ReportsSidebar';
import { StockVelocityReport } from '../components/analytics/StockVelocityReport';
import { ProfitabilityReport } from '../components/analytics/ProfitabilityReport';
import { ReportsDateSelector } from '../components/analytics/reports/ReportsDateSelector';
import { ReportsOverviewTab } from '../components/analytics/reports/ReportsOverviewTab';
import { ReportsLockedState } from '../components/analytics/reports/ReportsLockedState';
import { ReportsTabs } from '../components/analytics/reports/ReportsTabs';
import { ReportsActionCenter } from '../components/analytics/reports/ReportsActionCenter';
import { getDateRange, DateRangeOption } from '../utils/dateUtils';
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
    const { token, user } = useAuth(), { currentAccount } = useAccount();
    return <ScopedReportsPage key={JSON.stringify([user?.id, token, currentAccount?.id])} />;
}
function ScopedReportsPage() {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const isAdvancedReportsEnabled = useAccountFeature('ADVANCED_REPORTS');
    const [isLoading, setIsLoading] = useState(true);

    // Date Logic
    const [dateOption, setDateOption] = useState<DateRangeOption>('today');

    const [salesData, setSalesData] = useState<SalesData[]>([]);
    const [topProducts, setTopProducts] = useState<TopProduct[]>([]);
    const [customerGrowth, setCustomerGrowth] = useState<CustomerGrowth[]>([]);


    const [activeTab, setActiveTab] = useState<'overview' | 'stock_velocity' | 'profitability' | 'premade' | 'custom'>('overview');

    // Template State
    const [templates, setTemplates] = useState<ReportTemplate[]>([]);
    const [customReportConfig, setCustomReportConfig] = useState<ReportTemplate['config'] | undefined>(undefined);
    const [selectedTemplateId, setSelectedTemplateId] = useState<string | undefined>(undefined);
    const [shouldAutoRun, setShouldAutoRun] = useState(false);

    const [toastMessage, setToastMessage] = useState('');
    const [toastVisible, setToastVisible] = useState(false);
    const [toastType, setToastType] = useState<ToastType>('error');
    const showToast = useCallback((message: string, type: ToastType = 'error') => {
        setToastMessage(message); setToastType(type); setToastVisible(true);
    }, []);

    const enterCustomBuilder = useCallback(() => {
        setShouldAutoRun(false);
        setSelectedTemplateId(undefined);
        setActiveTab('custom');
    }, []);

    const fetchTemplates = useCallback(async () => {
        if (!currentAccount || !token) return;
        try {
            const res = await fetch('/api/analytics/templates', {
                headers: { 'Authorization': `Bearer ${token}`, 'X-Account-ID': currentAccount.id }
            });
            if (res.ok) {
                setTemplates(await res.json());
            }
        } catch (e) { Logger.error('Failed to load templates', { error: e }); showToast('Failed to load report templates'); }
    }, [currentAccount, token, showToast]);

    const handleSelectTemplate = (template: ReportTemplate) => {
        setSelectedTemplateId(template.id);
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
        if (!token || !currentAccount) return;
        const version = templates.find(template => template.id === id)?.updatedAt;
        if (!version) throw new Error('Template version unavailable');
        const operationId = crypto.randomUUID();
        try {
            const response = await fetch(`/api/analytics/templates/${encodeURIComponent(id)}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}`, 'X-Account-ID': currentAccount.id, 'Content-Type': 'application/json' },
                body: JSON.stringify({ operationId, version })
            });
            if (!response.ok) throw new Error('Template deletion not acknowledged');
            const ack = await response.json();
            if (ack.success !== true || ack.operationId !== operationId || ack.accountId !== currentAccount.id || ack.resourceId !== id) throw new Error('Template deletion scope acknowledgement unavailable');
            if (selectedTemplateId === id) {
                setSelectedTemplateId(undefined);
                setCustomReportConfig(undefined);
                setShouldAutoRun(false);
            }
            fetchTemplates();
            showToast('Template deleted', 'success');
        } catch (e) { Logger.error('Delete failed', { error: e }); showToast('Failed to delete template'); throw e; }
    };

    const handleTemplateSaved = useCallback(() => {
        fetchTemplates();
    }, [fetchTemplates]);

    const fetchData = useCallback(async () => {
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
    }, [currentAccount, token, dateOption, showToast]);

    useEffect(() => {
        let active = true;
        queueMicrotask(() => { if (active) { void fetchTemplates(); void fetchData(); } });
        return () => { active = false; };
    }, [fetchTemplates, fetchData]);

    const dateRange = getDateRange(dateOption);
    const totalRevenue = salesData.reduce((acc, curr) => acc + curr.sales, 0);
    const totalOrders = salesData.reduce((acc, curr) => acc + curr.orders, 0);
    const newCustomersCount = customerGrowth.reduce((acc, curr) => acc + curr.newCustomers, 0);

    return (
        <>
            <div className="min-w-0 space-y-6 p-6">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">Reports & Analytics</h1>
                    {(activeTab === 'overview' || activeTab === 'profitability' || activeTab === 'premade') && (
                        <ReportsDateSelector dateOption={dateOption} onChange={setDateOption} />
                    )}
                </div>

                <div className="min-w-0">
                    <ReportsTabs
                        activeTab={activeTab}
                        isAdvancedReportsEnabled={isAdvancedReportsEnabled}
                        onChangeTab={setActiveTab}
                        onEnterCustomBuilder={enterCustomBuilder}
                    />
                </div>

                {
                    activeTab === 'overview' && (
                        <div className="space-y-6">
                            <ReportsOverviewTab
                                isLoading={isLoading}
                                salesData={salesData}
                                topProducts={topProducts}
                                customerGrowth={customerGrowth}
                                currency={currentAccount?.currency || 'USD'}
                            />
                            <ReportsActionCenter
                                dateOption={dateOption}
                                startDate={dateRange.startDate}
                                endDate={dateRange.endDate}
                                totalRevenue={totalRevenue}
                                totalOrders={totalOrders}
                                newCustomers={newCustomersCount}
                                currency={currentAccount?.currency || 'USD'}
                                templateCount={templates.length}
                                onOpenLibrary={() => setActiveTab('premade')}
                                onOpenCustomBuilder={enterCustomBuilder}
                            />
                        </div>
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
                            startDate={dateRange.startDate}
                            endDate={dateRange.endDate}
                        />
                    )
                }

                {
                    activeTab === 'premade' && (
                        !isAdvancedReportsEnabled ? (
                            <ReportsLockedState
                                title="Advanced Reports Required"
                                description="The Report Library contains powerful pre-built analysis templates. Enable the Advanced Reports feature to access this library."
                            colorClass="bg-[var(--brand-subtle)] text-[var(--brand-text)]"
                            />
                        ) : (
                            <div className="flex min-w-0 flex-col gap-6 lg:h-[calc(100vh-14rem)] lg:flex-row lg:items-start">
                                <ReportsSidebar
                                    templates={templates}
                                    selectedTemplateId={selectedTemplateId}
                                    onSelect={handleSelectTemplate}
                                    onDelete={handleDeleteTemplate}
                                    onCreateCustom={enterCustomBuilder}
                                />
                                <div className="min-h-[28rem] min-w-0 flex-1 overflow-hidden lg:h-full lg:min-h-0">
                                    {customReportConfig ? (
                                        <ReportBuilder
                                            initialConfig={customReportConfig}
                                            autoRun={shouldAutoRun}
                                            viewMode={true}
                                            onTemplateSaved={handleTemplateSaved}
                                        />
                                    ) : (
                            <div className="flex h-full flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 bg-gray-50 p-8 text-center text-gray-400 dark:border-slate-700 dark:bg-slate-900">
                                <div className="mb-4 rounded-lg bg-white p-3 dark:bg-slate-800">
                                                <FileText size={48} className="text-gray-300" />
                                            </div>
                                            <p className="text-lg font-semibold text-gray-700 dark:text-slate-200">Choose a report or build a new one</p>
                                            <p className="mt-2 max-w-sm text-sm text-gray-500 dark:text-slate-400">Select a system template from the library, open one of your saved reports, or start a custom report from scratch.</p>
                                            <button
                                                onClick={enterCustomBuilder}
                                    className="mt-6 inline-flex items-center gap-2 rounded-lg bg-[var(--primary-color)] px-4 py-2.5 text-sm font-semibold text-[var(--primary-foreground)] transition-colors hover:bg-[var(--primary-hover)] focus-visible:outline-[var(--focus-color)]"
                                            >
                                                <Plus size={16} />
                                                Build Custom Report
                                            </button>
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
                            <ReportsLockedState
                                title="Custom Builder Locked"
                                description="Build your own custom reports and dashboards with the Advanced Reports addon."
                            colorClass="bg-[var(--brand-subtle)] text-[var(--brand-text)]"
                            />
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
