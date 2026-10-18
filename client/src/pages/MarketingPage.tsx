/**
 * MarketingPage - Campaigns, Ad Performance, and Ad Accounts management.
 * Flows/Automations moved to dedicated FlowsPage.
 */
import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AdsView } from '../components/marketing/AdsView';
import { AdPerformanceView } from '../components/marketing/AdPerformanceView';
import { CampaignsList } from '../components/marketing/CampaignsList';
import { AdIntelligencePanel } from '../components/marketing/AdIntelligencePanel';
import { Mail, Megaphone, BarChart2, Zap } from 'lucide-react';

import { MarketingEmailDesigner } from '../components/marketing/MarketingEmailDesigner';
import { useCampaignEmailEditor } from '../components/marketing/useCampaignEmailEditor';
import { useAccountFeature } from '../hooks/useAccountFeature';
import { ErrorBoundary } from '../components/ui/ErrorBoundary';

export function MarketingPage() {
    const editor = useCampaignEmailEditor();
    const isAdTrackingEnabled = useAccountFeature('AD_TRACKING');
    const [searchParams, setSearchParams] = useSearchParams();

    // Initialize activeTab from URL query param or default to 'campaigns'
    type TabId = 'campaigns' | 'performance' | 'ads' | 'intelligence';
    const validTabs: TabId[] = ['campaigns', 'performance', 'ads', 'intelligence'];
    const tabFromUrl = searchParams.get('tab') as TabId | null;
    const [activeTab, setActiveTab] = useState<TabId>(
        tabFromUrl && validTabs.includes(tabFromUrl) ? tabFromUrl : 'campaigns'
    );

    // Sync tab changes to URL
    useEffect(() => {
        if (activeTab !== 'campaigns') {
            setSearchParams({ tab: activeTab }, { replace: true });
        } else {
            // Remove tab param when on default tab
            setSearchParams({}, { replace: true });
        }
    }, [activeTab, setSearchParams]);

    const adTabs: Array<{ id: TabId; label: string; icon: typeof Mail }> = isAdTrackingEnabled ? [
        { id: 'performance', label: 'Ad Performance', icon: BarChart2 },
        { id: 'ads', label: 'Ad Accounts', icon: Megaphone },
        { id: 'intelligence', label: 'Intelligence', icon: Zap },
    ] : [];

    const tabs: Array<{ id: TabId; label: string; icon: typeof Mail }> = [
        { id: 'campaigns', label: 'Campaigns', icon: Mail },
        ...adTabs,
    ];

    if (editor.isOpen) {
        return (
            <>
                {(editor.loading || editor.error) ? (
                    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-white dark:bg-slate-950 dark:text-white">
                        <p role={editor.error ? 'alert' : 'status'}>{editor.error || 'Loading saved campaign design...'}</p>
                        {editor.error && <button onClick={() => editor.item && void editor.open(editor.item.id, editor.item.name, editor.item.subject)}>Retry</button>}
                        <button onClick={editor.close}>Back to campaigns</button>
                    </div>
                ) : (
                <MarketingEmailDesigner
                    key={editor.item?.id}
                    storageScope={`campaign:${editor.item?.id}`}
                    initialHtml={editor.item?.content}
                    previewOrderMode="none"
                    initialDesign={editor.item?.designJson}
                    initialSubject={editor.item?.subject}
                    onSave={editor.save}
                    onCancel={editor.close}
                />
                )}
            </>
        );
    }



    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-2">
                <h1 className="text-2xl font-bold text-gray-900">Marketing</h1>
                <p className="text-gray-500">Manage your email campaigns and ad accounts.</p>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-gray-200">
                {tabs.map(tab => {
                    const Icon = tab.icon;
                    const isActive = activeTab === tab.id;
                    return (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`flex items-center gap-2 px-6 py-3 font-medium text-sm border-b-2 transition-colors ${isActive
                                ? 'border-blue-600 text-blue-600'
                                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                                }`}
                        >
                            <Icon size={18} />
                            {tab.label}
                        </button>
                    )
                })}
            </div>

            <div className="py-4">
                {activeTab === 'campaigns' && <CampaignsList onEdit={editor.open} />}
                {activeTab === 'performance' && (
                    <ErrorBoundary>
                        <AdPerformanceView />
                    </ErrorBoundary>
                )}
                {activeTab === 'ads' && <AdsView />}
                {activeTab === 'intelligence' && (
                    <ErrorBoundary>
                        <AdIntelligencePanel />
                    </ErrorBoundary>
                )}
            </div>
        </div>
    );
}
