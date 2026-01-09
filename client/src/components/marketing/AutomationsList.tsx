/**
 * FlowsList - Displays and manages automation flows.
 * Simplified creation: just name, then visual builder handles triggers/actions.
 */
import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { Plus, Zap, Play, Pause, Trash2, Loader2, GitBranch } from 'lucide-react';

export function AutomationsList({ onEdit }: { onEdit: (id: string, name: string) => void }) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [flows, setFlows] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    // Create Modal - simplified: name only
    const [showCreate, setShowCreate] = useState(false);
    const [newFlowName, setNewFlowName] = useState('');

    useEffect(() => {
        fetchData();
    }, [currentAccount, token]);

    async function fetchData() {
        if (!currentAccount) return;
        try {
            const res = await fetch('/api/marketing/automations', {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount?.id || ''
                }
            });
            if (res.ok) {
                const data = await res.json();
                if (Array.isArray(data)) setFlows(data);
                else setFlows([]);
            } else {
                console.error("Failed to fetch flows:", res.status);
                setFlows([]);
            }
        } catch (err) { console.error(err); setFlows([]); }
        finally { setIsLoading(false); }
    }

    async function handleCreate(e: React.FormEvent) {
        e.preventDefault();
        if (!newFlowName.trim()) return;

        try {
            const res = await fetch('/api/marketing/automations', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount?.id || ''
                },
                body: JSON.stringify({
                    name: newFlowName.trim(),
                    triggerType: 'NONE',
                    isActive: false,
                    flowDefinition: { nodes: [], edges: [] }
                })
            });

            if (res.ok) {
                const data = await res.json();
                setShowCreate(false);
                setNewFlowName('');
                onEdit(data.id, data.name);
            }
        } catch (err) { alert('Error creating flow'); }
    }

    async function toggleActive(flow: any) {
        try {
            const detailRes = await fetch(`/api/marketing/automations/${flow.id}`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount?.id || ''
                }
            });
            const detail = await detailRes.json();

            await fetch('/api/marketing/automations', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount?.id || ''
                },
                body: JSON.stringify({ ...detail, isActive: !flow.isActive })
            });

            fetchData();
        } catch (err) { alert('Failed to toggle'); }
    }

    async function handleDelete(id: string) {
        if (!confirm('Delete this flow?')) return;
        try {
            await fetch(`/api/marketing/automations/${id}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount?.id || ''
                }
            });
            fetchData();
        } catch (err) { alert('Failed to delete'); }
    }

    // Trigger type display labels
    const triggers: Record<string, string> = {
        'ORDER_CREATED': 'Order Created',
        'ORDER_COMPLETED': 'Order Completed',
        'REVIEW_LEFT': 'Review Left',
        'ABANDONED_CART': 'Abandoned Cart',
        'NONE': 'No Trigger'
    };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h2 className="text-xl font-semibold text-gray-900">Flows</h2>
                <button
                    onClick={() => setShowCreate(true)}
                    className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
                >
                    <Plus size={18} /> New Flow
                </button>
            </div>

            {showCreate && (
                <div className="bg-gray-50 p-4 rounded-lg border border-gray-200 mb-4">
                    <form onSubmit={handleCreate} className="flex items-end gap-4">
                        <div className="flex-1">
                            <label className="block text-sm font-medium mb-1">Flow Name</label>
                            <input
                                className="w-full p-2 border rounded-sm"
                                placeholder="e.g., Post-Purchase Follow Up"
                                value={newFlowName}
                                onChange={e => setNewFlowName(e.target.value)}
                                autoFocus
                                required
                            />
                        </div>
                        <div className="flex gap-2">
                            <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded-sm">Create & Edit</button>
                            <button type="button" onClick={() => { setShowCreate(false); setNewFlowName(''); }} className="px-4 py-2 text-gray-500">Cancel</button>
                        </div>
                    </form>
                </div>
            )}

            {isLoading ? <Loader2 className="animate-spin" /> : (
                <div className="grid gap-4">
                    {flows.map(flow => (
                        <div key={flow.id} className="bg-white p-4 rounded-xl border border-gray-200 shadow-xs flex items-center justify-between">
                            <div className="flex items-center gap-4">
                                <div className={`p-3 rounded-lg ${flow.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                                    <Zap size={24} />
                                </div>
                                <div>
                                    <h3 className="font-semibold text-gray-900">{flow.name}</h3>
                                    <div className="flex items-center gap-2 text-sm text-gray-500">
                                        {flow.triggerType && flow.triggerType !== 'NONE' && (
                                            <>
                                                <span className="font-medium text-gray-700">Trigger:</span> {triggers[flow.triggerType] || flow.triggerType}
                                                <span className="text-gray-300">|</span>
                                            </>
                                        )}
                                        <span className="flex items-center gap-1"><GitBranch size={14} /> {flow.enrollments?.length || 0} active</span>
                                    </div>
                                </div>
                            </div>

                            <div className="flex items-center gap-3">
                                <button
                                    onClick={() => toggleActive(flow)}
                                    className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${flow.isActive
                                        ? 'bg-green-100 text-green-800 hover:bg-green-200'
                                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                        }`}
                                >
                                    {flow.isActive ? <><Pause size={14} /> Active</> : <><Play size={14} /> Paused</>}
                                </button>
                                <button onClick={() => onEdit(flow.id, flow.name)} className="text-blue-600 hover:text-blue-800 p-2 font-medium text-sm">
                                    Edit Flow
                                </button>
                                <button onClick={() => handleDelete(flow.id)} className="p-2 text-gray-400 hover:text-red-600">
                                    <Trash2 size={18} />
                                </button>
                            </div>
                        </div>
                    ))}
                    {flows.length === 0 && (
                        <div className="text-center py-12 text-gray-500">No flows created yet. Create your first flow to automate customer engagement.</div>
                    )}
                </div>
            )
            }
        </div >
    );
}
