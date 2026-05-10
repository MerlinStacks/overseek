import { useEffect, useState, useCallback } from 'react';
import { Logger } from '../utils/logger';
import { useAuth } from '../context/AuthContext';
import { useAccount } from '../context/AccountContext';
import { useAccountFeature } from '../hooks/useAccountFeature';
import { FileText } from 'lucide-react';

import { ReportBuilder } from '../components/ReportBuilder';
import { Toast, ToastType } from '../components/ui/Toast';

import { ReportsSidebar } from '../components/analytics/ReportsSidebar';
import { StockVelocityReport } from '../components/analytics/StockVelocityReport';
import { ProfitabilityReport } from '../components/analytics/ProfitabilityReport';
import { ReportsDateSelector } from '../components/analytics/reports/ReportsDateSelector';
import { ReportsOverviewTab } from '../components/analytics/reports/ReportsOverviewTab';
import { ReportsLockedState } from '../components/analytics/reports/ReportsLockedState';
import { ReportsTabs } from '../components/analytics/reports/ReportsTabs';
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
        if (!confirm('Are you sure?')) return;
        try {
            await fetch(`/api/analytics/templates/${id}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}`, 'X-Account-ID': currentAccount.id }
            });
            if (selectedTemplateId === id) {
                setSelectedTemplateId(undefined);
                setCustomReportConfig(undefined);
                setShouldAutoRun(false);
            }
            fetchTemplates();
            showToast('Template deleted', 'success');
        } catch (e) { Logger.error('Delete failed', { error: e }); showToast('Failed to delete template'); }
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
        fetchTemplates();
        fetchData();
    }, [fetchTemplates, fetchData]);

    return (
        <>
            <div className="space-y-6">
                {/* Header */}
                <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900">Reports & Analytics</h1>
                        <p className="text-sm text-gray-500 mt-1">Deep dive into your store performance with custom and premade reports</p>
                    </div>

                    <ReportsTabs
                        activeTab={activeTab}
                        isAdvancedReportsEnabled={isAdvancedReportsEnabled}
                        onChangeTab={setActiveTab}
                        onEnterCustomBuilder={() => {
                            setShouldAutoRun(false);
                            setSelectedTemplateId(undefined);
                            setActiveTab('custom');
                        }}
                    />
                </div>

                {/* Date Range Selector (for applicable tabs) */}
                {(activeTab === 'overview' || activeTab === 'profitability' || activeTab === 'premade') && (
                    <ReportsDateSelector dateOption={dateOption} onChange={setDateOption} />
                )}

                {
                    activeTab === 'overview' && (
                        <ReportsOverviewTab
                            isLoading={isLoading}
                            salesData={salesData}
                            topProducts={topProducts}
                            customerGrowth={customerGrowth}
                        />
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
                            <ReportsLockedState
                                title="Advanced Reports Required"
                                description="The Report Library contains powerful pre-built analysis templates. Enable the Advanced Reports feature to access this library."
                                colorClass="bg-blue-100 text-blue-600"
                            />
                        ) : (
                            <div className="flex gap-6 items-start h-[calc(100vh-14rem)]">
                                <ReportsSidebar
                                    templates={templates}
                                    selectedTemplateId={selectedTemplateId}
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
                            <ReportsLockedState
                                title="Custom Builder Locked"
                                description="Build your own custom reports and dashboards with the Advanced Reports addon."
                                colorClass="bg-purple-100 text-purple-600"
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
