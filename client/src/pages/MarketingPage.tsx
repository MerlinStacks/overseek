/**
 * MarketingPage - Campaigns, Ad Performance, and Ad Accounts management.
 * Flows/Automations moved to dedicated FlowsPage.
 */
import { useState, useEffect } from 'react';
import { Logger } from '../utils/logger';
import { useSearchParams } from 'react-router-dom';
import { AdsView } from '../components/marketing/AdsView';
import { AdPerformanceView } from '../components/marketing/AdPerformanceView';
import { CampaignsList } from '../components/marketing/CampaignsList';
import { AdIntelligencePanel } from '../components/marketing/AdIntelligencePanel';
import { Mail, Megaphone, BarChart2, Zap } from 'lucide-react';

import { MarketingEmailDesigner } from '../components/marketing/MarketingEmailDesigner';
import { useAuth } from '../context/AuthContext';
import { useAccount } from '../context/AccountContext';
import { useToast } from '../context/ToastContext';
import { useAccountFeature } from '../hooks/useAccountFeature';
import { ErrorBoundary } from '../components/ui/ErrorBoundary';

type EditorMode = 'email' | null;


interface EditingItem {
    id: string;
    name: string;
    subject?: string;
    designJson?: unknown;
    description?: string;
}

export function MarketingPage() {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const toast = useToast();
    const isAdTrackingEnabled = useAccountFeature('AD_TRACKING');
    const [searchParams, setSearchParams] = useSearchParams();

    // Initialize activeTab from URL query param or default to 'campaigns'
    type TabId = 'campaigns' | 'performance' | 'ads' | 'intelligence';
    const validTabs: TabId[] = ['campaigns', 'performance', 'ads', 'intelligence'];
    const tabFromUrl = searchParams.get('tab') as TabId | null;
    const [activeTab, setActiveTab] = useState<TabId>(
        tabFromUrl && validTabs.includes(tabFromUrl) ? tabFromUrl : 'campaigns'
    );

    // Editor State
    const [editorMode, setEditorMode] = useState<EditorMode>(null);
    const [editingItem, setEditingItem] = useState<EditingItem | null>(null);
    const [loadingEditorDesign, setLoadingEditorDesign] = useState(false);

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

    const handleEditCampaign = async (id: string, name: string, subject?: string) => {
        setEditingItem({ id, name, subject });
        setEditorMode('email');

        if (!currentAccount) return;
        setLoadingEditorDesign(true);
        try {
            const response = await fetch(`/api/marketing/campaigns/${id}`, {
                headers: {
                    Authorization: `Bearer ${token}`,
                    'x-account-id': currentAccount.id,
                },
            });
            if (!response.ok) return;
            const campaign = await response.json() as { designJson?: unknown; subject?: string; name?: string };
            setEditingItem({
                id,
                name: campaign.name || name,
                subject: campaign.subject || subject,
                designJson: campaign.designJson,
            });
        } catch (error) {
            Logger.error('Failed to load campaign design', { error });
            toast.error('Opened editor with a blank design because the saved design could not be loaded');
        } finally {
            setLoadingEditorDesign(false);
        }
    };



    const handleCloseEditor = () => {
        setEditorMode(null);
        setEditingItem(null);
    };

    const handleSaveEmail = async (html: string, design: unknown, meta?: { subject: string; autosave?: boolean }) => {
        if (!editingItem || !currentAccount) return;
        try {
            const response = await fetch(`/api/marketing/campaigns/${editingItem.id}`, {
                method: 'PUT', // or PATCH
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount.id
                },
                body: JSON.stringify({ content: html, designJson: design, subject: meta?.subject ?? editingItem.subject ?? '' })
            });
            if (!response.ok) throw new Error('Failed to save design');
            if (!meta?.autosave) toast.success('Design saved!');
        } catch (err) {
            Logger.error('An error occurred', { error: err });
            if (!meta?.autosave) toast.error('Failed to save design');
            throw err;
        }
    };



    if (editorMode === 'email') {
        return (
            <>
                {loadingEditorDesign && (
                    <div className="fixed inset-x-0 top-0 z-[70] bg-indigo-600 px-4 py-2 text-center text-sm font-medium text-white shadow-lg">
                        Loading saved campaign design...
                    </div>
                )}
                <MarketingEmailDesigner
                    initialDesign={editingItem?.designJson}
                    initialSubject={editingItem?.subject}
                    onSave={handleSaveEmail}
                    onCancel={handleCloseEditor}
                />
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
                {activeTab === 'campaigns' && <CampaignsList onEdit={handleEditCampaign} />}
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
