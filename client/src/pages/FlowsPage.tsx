/**
 * FlowsPage - Dedicated page for automation flows (formerly "Automations" tab).
 * Part of the Growth menu in the sidebar.
 */
import { useState } from 'react';
import { Logger } from '../utils/logger';
import { AutomationsList } from '../components/marketing/AutomationsList';
import { FlowBuilder } from '../components/marketing/FlowBuilder';
import { ArrowLeft } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useAccount } from '../context/AccountContext';
import { ErrorBoundary } from '../components/ui/ErrorBoundary';

interface EditingItem {
    id: string;
    name: string;
}

export function FlowsPage() {
    const { token } = useAuth();
    const { currentAccount } = useAccount();

    const [isEditing, setIsEditing] = useState(false);
    const [editingItem, setEditingItem] = useState<EditingItem | null>(null);
    const [editingFlowData, setEditingFlowData] = useState<any>(null);

    const handleEditFlow = async (id: string, name: string) => {
        setEditingItem({ id, name });
        try {
            const res = await fetch(`/api/marketing/automations/${id}`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount?.id || ''
                }
            });
            if (res.ok) {
                const data = await res.json();
                setEditingFlowData(data);
                setIsEditing(true);
            } else {
                alert('Failed to load flow details');
            }
        } catch (e) {
            Logger.error('An error occurred', { error: e });
            alert('Failed to load flow details');
        }
    };

    const handleCloseEditor = () => {
        setIsEditing(false);
        setEditingItem(null);
        setEditingFlowData(null);
    };

    const handleSaveFlow = async (flow: { nodes: any[]; edges: any[] }) => {
        if (!editingItem || !currentAccount) return;
        try {
            await fetch(`/api/marketing/automations/${editingItem.id}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount.id
                },
                body: JSON.stringify({
                    id: editingItem.id,
                    flowDefinition: flow,
                    isActive: true
                })
            });
            alert('Flow saved!');
        } catch (err) {
            Logger.error('An error occurred', { error: err });
            alert('Failed to save');
        }
    };

    // --- Render Flow Builder Editor ---
    if (isEditing) {
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
                        <ErrorBoundary>
                            <FlowBuilder
                                initialFlow={editingFlowData?.flowDefinition}
                                onSave={handleSaveFlow}
                                onCancel={handleCloseEditor}
                            />
                        </ErrorBoundary>
                    </div>
                </div>
            </div>
        );
    }

    // --- Render Flows List ---
    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-2">
                <h1 className="text-2xl font-bold text-gray-900">Flows</h1>
                <p className="text-gray-500">Create and manage automated workflows for customer engagement.</p>
            </div>

            <ErrorBoundary>
                <AutomationsList onEdit={handleEditFlow} />
            </ErrorBoundary>
        </div>
    );
}
