import { useState } from 'react';
import { Logger } from '../utils/logger';
import { CampaignsList } from '../components/marketing/CampaignsList';
import { useAuth } from '../context/AuthContext';
import { useAccount } from '../context/AccountContext';
import { MarketingEmailDesigner } from '../components/marketing/MarketingEmailDesigner';

type EditorMode = 'email' | null;

interface EditingItem {
    id: string;
    name: string;
    subject?: string;
    designJson?: unknown;
    description?: string;
}

export function BroadcastsPage() {
    const { token } = useAuth();
    const { currentAccount } = useAccount();

    // Editor State
    const [editorMode, setEditorMode] = useState<EditorMode>(null);
    const [editingItem, setEditingItem] = useState<EditingItem | null>(null);
    const [loadingEditorDesign, setLoadingEditorDesign] = useState(false);

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
            Logger.error('Failed to load broadcast design', { error });
        } finally {
            setLoadingEditorDesign(false);
        }
    };

    const handleCloseEditor = () => {
        setEditorMode(null);
        setEditingItem(null);
    };

    const handleSaveEmail = async (html: string, design: unknown) => {
        if (!editingItem || !currentAccount) return;
        try {
            await fetch(`/api/marketing/campaigns/${editingItem.id}`, {
                method: 'PUT',
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
            <>
                {loadingEditorDesign && (
                    <div className="fixed inset-x-0 top-0 z-[70] bg-indigo-600 px-4 py-2 text-center text-sm font-medium text-white shadow-lg">
                        Loading saved broadcast design...
                    </div>
                )}
                <MarketingEmailDesigner
                    initialDesign={editingItem?.designJson}
                    onSave={handleSaveEmail}
                    onCancel={handleCloseEditor}
                />
            </>
        );
    }

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-2">
                <h1 className="text-2xl font-bold text-gray-900">Broadcasts</h1>
                <p className="text-gray-500">Manage and send email broadcasts to your customers.</p>
            </div>

            <div className="py-4">
                <CampaignsList onEdit={handleEditCampaign} />
            </div>
        </div>
    );
}
