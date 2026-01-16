import { useState, lazy, Suspense } from 'react';
import { Logger } from '../utils/logger';
import { CampaignsList } from '../components/marketing/CampaignsList';
import { useAuth } from '../context/AuthContext';
import { useAccount } from '../context/AccountContext';

// Lazy-load EmailDesignEditor to prevent react-email-editor from polluting React singleton
const EmailDesignEditor = lazy(() => import('../components/marketing/EmailDesignEditor').then(m => ({ default: m.EmailDesignEditor })));

type EditorMode = 'email' | null;

interface EditingItem {
    id: string;
    name: string;
    description?: string;
}

export function BroadcastsPage() {
    const { token } = useAuth();
    const { currentAccount } = useAccount();

    // Editor State
    const [editorMode, setEditorMode] = useState<EditorMode>(null);
    const [editingItem, setEditingItem] = useState<EditingItem | null>(null);

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
            <Suspense fallback={<div className="flex items-center justify-center h-screen"><div className="text-gray-500">Loading email editor...</div></div>}>
                <EmailDesignEditor
                    initialDesign={undefined}
                    onSave={handleSaveEmail}
                    onCancel={handleCloseEditor}
                />
            </Suspense>
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
