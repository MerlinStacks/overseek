/**
 * MarketingPage - Campaigns, Ad Performance, and Ad Accounts management.
 * Flows/Automations moved to dedicated FlowsPage.
 */
import { useState, useEffect, lazy, Suspense } from 'react';
import { Logger } from '../utils/logger';
import { useSearchParams } from 'react-router-dom';
import { AdsView } from '../components/marketing/AdsView';
import { AdPerformanceView } from '../components/marketing/AdPerformanceView';
import { CampaignsList } from '../components/marketing/CampaignsList';
import { ExperimentsPanel } from '../components/marketing/ExperimentsPanel';
import { ExecutiveReportsPanel } from '../components/marketing/ExecutiveReportsPanel';
import { AudienceSyncPanel } from '../components/marketing/AudienceSyncPanel';
import { AdIntelligencePanel } from '../components/marketing/AdIntelligencePanel';
import { Mail, Megaphone, BarChart2, FlaskConical, FileText, Users, Zap } from 'lucide-react';

// Lazy-load EmailDesignEditor to prevent react-email-editor from polluting React singleton
const EmailDesignEditor = lazy(() => import('../components/marketing/EmailDesignEditor').then(m => ({ default: m.EmailDesignEditor })));
import { useAuth } from '../context/AuthContext';
import { useAccount } from '../context/AccountContext';
import { useAccountFeature } from '../hooks/useAccountFeature';
import { ErrorBoundary } from '../components/ui/ErrorBoundary';

type EditorMode = 'email' | null;


interface EditingItem {
    id: string;
    name: string;
    description?: string;
}

export function MarketingPage() {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const isAdTrackingEnabled = useAccountFeature('AD_TRACKING');
    const [searchParams, setSearchParams] = useSearchParams();

    // Initialize activeTab from URL query param or default to 'campaigns'
    type TabId = 'campaigns' | 'performance' | 'ads' | 'experiments' | 'reports' | 'audiences' | 'intelligence';
    const validTabs: TabId[] = ['campaigns', 'performance', 'ads', 'experiments', 'reports', 'audiences', 'intelligence'];
    const tabFromUrl = searchParams.get('tab') as TabId | null;
    const [activeTab, setActiveTab] = useState<TabId>(
        tabFromUrl && validTabs.includes(tabFromUrl) ? tabFromUrl : 'campaigns'
    );

    // Editor State
    const [editorMode, setEditorMode] = useState<EditorMode>(null);
    const [editingItem, setEditingItem] = useState<EditingItem | null>(null);

    // Sync tab changes to URL
    useEffect(() => {
        if (activeTab !== 'campaigns') {
            setSearchParams({ tab: activeTab }, { replace: true });
        } else {
            // Remove tab param when on default tab
            setSearchParams({}, { replace: true });
        }
    }, [activeTab, setSearchParams]);

    const tabs = [
        { id: 'campaigns', label: 'Campaigns', icon: Mail },
        ...(isAdTrackingEnabled ? [
            { id: 'performance', label: 'Ad Performance', icon: BarChart2 },
            { id: 'ads', label: 'Ad Accounts', icon: Megaphone },
            { id: 'experiments', label: 'A/B Tests', icon: FlaskConical },
            { id: 'reports', label: 'Reports', icon: FileText },
            { id: 'audiences', label: 'Audiences', icon: Users },
            { id: 'intelligence', label: 'Intelligence', icon: Zap },
        ] : []),
    ];

    const handleEditCampaign = (id: string, name: string) => {
        setEditingItem({ id, name });
        setEditorMode('email');
    };



    const handleCloseEditor = () => {
        setEditorMode(null);
        setEditingItem(null);
    };

    const handleSaveEmail = async (html: string, design: any) => {
        if (!editingItem || !currentAccount) return;
        try {
            await fetch(`/api/marketing/campaigns/${editingItem.id}`, {
                method: 'PUT', // or PATCH
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount.id
                },
                body: JSON.stringify({ content: html, designJson: design })
            });
            alert('Design saved!');
        } catch (err) {
            Logger.error('An error occurred', { error: err });
            alert('Failed to save');
        }
    };



    if (editorMode === 'email') {
        return (
            <Suspense fallback={<div className="flex items-center justify-center h-screen"><div className="text-gray-500">Loading email editor...</div></div>}>
                <EmailDesignEditor
                    initialDesign={undefined} // Could fetch and pass existing design
                    onSave={handleSaveEmail}
                    onCancel={handleCloseEditor}
                />
            </Suspense>
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
                            onClick={() => setActiveTab(tab.id as any)}
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
                {activeTab === 'campaigns' && <CampaignsList onEdit={handleEditCampaign} />}
                {activeTab === 'performance' && (
                    <ErrorBoundary>
                        <AdPerformanceView />
                    </ErrorBoundary>
                )}
                {activeTab === 'ads' && <AdsView />}
                {activeTab === 'experiments' && (
                    <ErrorBoundary>
                        <ExperimentsPanel />
                    </ErrorBoundary>
                )}
                {activeTab === 'reports' && (
                    <ErrorBoundary>
                        <ExecutiveReportsPanel />
                    </ErrorBoundary>
                )}
                {activeTab === 'audiences' && (
                    <ErrorBoundary>
                        <AudienceSyncPanel />
                    </ErrorBoundary>
                )}
                {activeTab === 'intelligence' && (
                    <ErrorBoundary>
                        <AdIntelligencePanel />
                    </ErrorBoundary>
                )}
            </div>
        </div>
    );
}
