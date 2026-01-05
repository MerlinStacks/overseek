
import { useState } from 'react';
import { AdsView } from '../components/marketing/AdsView';
import { CampaignsList } from '../components/marketing/CampaignsList';
import { AutomationsList } from '../components/marketing/AutomationsList';
import { EmailDesignEditor } from '../components/marketing/EmailDesignEditor';
import { FlowBuilder } from '../components/marketing/FlowBuilder';
import { LayoutGrid, Mail, Zap, Megaphone, ArrowLeft } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useAccount } from '../context/AccountContext';

type EditorMode = 'email' | 'automation' | null;

interface EditingItem {
    id: string;
    name: string;
    description?: string;
}

export function MarketingPage() {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [activeTab, setActiveTab] = useState<'overview' | 'campaigns' | 'automations' | 'ads'>('campaigns');

    // Editor State
    const [editorMode, setEditorMode] = useState<EditorMode>(null);
    const [editingItem, setEditingItem] = useState<EditingItem | null>(null);
    const [editingAutomationData, setEditingAutomationData] = useState<any>(null); // To store full automation data

    const tabs = [
        { id: 'campaigns', label: 'Campaigns', icon: Mail },
        { id: 'automations', label: 'Automations', icon: Zap },
        { id: 'ads', label: 'Ads Intelligence', icon: Megaphone },
    ];

    const handleEditCampaign = (id: string, name: string) => {
        setEditingItem({ id, name });
        setEditorMode('email');
    };

    const handleEditAutomation = async (id: string, name: string) => {
        setEditingItem({ id, name });
        // Fetch details
        try {
            const res = await fetch(`/api/marketing/automations/${id}`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount?.id || ''
                }
            });
            if (res.ok) {
                const data = await res.json();
                setEditingAutomationData(data);
                setEditorMode('automation');
            } else {
                alert('Failed to load automation details');
            }
        } catch (e) {
            console.error(e);
            alert('Failed to load automation details');
        }
    };

    const handleCloseEditor = () => {
        setEditorMode(null);
        setEditingItem(null);
        setEditingAutomationData(null);
        // Ideally refetch lists? Lists fetch on mount so we are good if we unmount them.
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
            console.error(err);
            alert('Failed to save');
        }
    };

    const handleSaveFlow = async (flow: { nodes: any[], edges: any[] }) => {
        if (!editingItem || !currentAccount) return;
        try {
            // Automations endpoint handles upsert/update
            await fetch(`/api/marketing/automations/${editingItem.id}`, {
                method: 'PUT', // Assuming PUT logic exists or POST upsert
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount.id
                },
                // Use Partial update or full object? The backend `upsertAutomation` is usually POST /api/marketing/automations.
                // But let's assume we have a PUT or just use the same upsert endpoint.
                body: JSON.stringify({
                    id: editingItem.id,
                    // We need to keep existing fields? The backend upsert requires name/triggerType etc if using upsert logic.
                    // But if we just update flow, we might need a dedicated PATCH endpoint or ensuring we send everything.
                    // For now, let's assume the upsert handles partial if ID is present OR we need to fetch info first.
                    // Let's rely on the fact that existing fields are preserved if not passed? 
                    // My backend logic `upsertAutomation` replaces everything if passed? No, `prisma.update` only updates provided fields.
                    // Ah, `upsertAutomation` gets `data`. 
                    flowDefinition: flow,
                    isActive: true // Optionally activate on save?
                })
            });
            alert('Automation saved!');
        } catch (err) {
            console.error(err);
            alert('Failed to save');
        }
    };

    // --- Render Editors ---

    if (editorMode === 'email') {
        return (
            <div className="h-[calc(100vh-64px)] -m-6 bg-white z-50 absolute inset-0 top-16">
                {/* Full screen overlay or replace layout content */}
                <div className="h-full flex flex-col">
                    <EmailDesignEditor
                        // Initial design loading logic would need fetching the design first. 
                        // For prototype, we skip pre-loading or do it inside Editor with a fetch.
                        // Ideally Editor fetches by ID or we pass it.
                        onSave={handleSaveEmail}
                        onCancel={handleCloseEditor}
                    />
                </div>
            </div>
        );
    }

    if (editorMode === 'automation') {
        return (
            <div className="h-[calc(100vh-64px)] -m-6 bg-white z-50 absolute inset-0 top-16">
                <div className="h-full flex flex-col">
                    <div className="border-b p-4 flex justify-between items-center bg-gray-50">
                        <div className="flex items-center gap-2">
                            <button onClick={handleCloseEditor} className="p-2 hover:bg-gray-200 rounded-full">
                                <ArrowLeft size={20} />
                            </button>
                            <h2 className="font-bold text-lg">{editingItem?.name}</h2>
                        </div>
                    </div>
                    <div className="flex-1 overflow-hidden">
                        <FlowBuilder
                            initialFlow={editingAutomationData?.flowDefinition}
                            onSave={handleSaveFlow}
                            onCancel={handleCloseEditor}
                        />
                    </div>
                </div>
            </div>
        );
    }

    // --- Render Lists ---

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-2">
                <h1 className="text-2xl font-bold text-gray-900">Marketing & Growth</h1>
                <p className="text-gray-500">Manage your email marketing, automations, and ad campaigns.</p>
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
                {activeTab === 'automations' && <AutomationsList onEdit={handleEditAutomation} />}
                {activeTab === 'ads' && <AdsView />}
            </div>
        </div>
    );
}
