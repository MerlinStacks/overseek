
import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { Plus, Zap, Play, Pause, Trash2, Loader2, GitBranch } from 'lucide-react';

export function AutomationsList({ onEdit }: { onEdit: (id: string, name: string) => void }) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [automations, setAutomations] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    // Create Modal
    const [showCreate, setShowCreate] = useState(false);
    const [newItem, setNewItem] = useState({ name: '', triggerType: 'ORDER_CREATED' });

    useEffect(() => {
        fetchData();
    }, [currentAccount, token]);

    async function fetchData() {
        if (!currentAccount) return;
        try {
            const res = await fetch('/api/marketing/automations', {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount.id
                }
            });
            if (res.ok) {
                const data = await res.json();
                if (Array.isArray(data)) setAutomations(data);
                else setAutomations([]);
            } else {
                console.error("Failed to fetch automations:", res.status);
                setAutomations([]);
            }
        } catch (err) { console.error(err); setAutomations([]); }
        finally { setIsLoading(false); }
    }

    async function handleCreate(e: React.FormEvent) {
        e.preventDefault();
        try {
            // Default steps: Wait 1 hour -> Send Email
            const defaultSteps = [
                { type: 'DELAY', config: { duration: 1, unit: 'hours' } },
                { type: 'SEND_EMAIL', config: { templateId: 'default', subject: 'Thanks for your order!' } }
            ];

            const res = await fetch('/api/marketing/automations', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount.id
                },
                body: JSON.stringify({ ...newItem, steps: defaultSteps, isActive: false })
            });

            if (res.ok) {
                const data = await res.json();
                setShowCreate(false);
                setNewItem({ name: '', triggerType: 'ORDER_CREATED' });
                // fetchData();
                onEdit(data.id, data.name);
            }
        } catch (err) { alert('Error creating'); }
    }

    async function toggleActive(aut: any) {
        try {
            // We need to fetch full object or just send update?
            // Upsert endpoint handles update.
            // But we need the existing steps to not lose them?
            // Or can we just patch? API `upsertAutomation` replaces steps if provided.
            // I need a proper PATCH endpoint or pass logic.
            // For now, let's fetch full, modify isActive, send back.

            // Optimistic update
            const updated = { ...aut, isActive: !aut.isActive };
            // Wait, list doesn't include steps details? service `listAutomations` doesn't include steps.
            // So I can't simple upsert without losing steps!
            // I need to fetch detail first.

            const detailRes = await fetch(`/api/marketing/automations/${aut.id}`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount.id
                }
            });
            const detail = await detailRes.json();

            await fetch('/api/marketing/automations', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount.id
                },
                body: JSON.stringify({ ...detail, isActive: !aut.isActive })
            });

            fetchData();
        } catch (err) { alert('Failed to toggle'); }
    }

    async function handleDelete(id: string) {
        if (!confirm('Delete this automation?')) return;
        try {
            await fetch(`/api/marketing/automations/${id}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount.id
                }
            });
            fetchData();
        } catch (err) { alert('Failed to delete'); }
    }

    const triggers: Record<string, string> = {
        'ORDER_CREATED': 'Order Created',
        'ORDER_COMPLETED': 'Order Completed',
        'REVIEW_LEFT': 'Review Left',
        'ABANDONED_CART': 'Abandoned Cart'
    };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h2 className="text-xl font-semibold text-gray-900">Automations</h2>
                <button
                    onClick={() => setShowCreate(true)}
                    className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
                >
                    <Plus size={18} /> New Automation
                </button>
            </div>

            {showCreate && (
                <div className="bg-gray-50 p-4 rounded-lg border border-gray-200 mb-4">
                    <form onSubmit={handleCreate} className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
                        <div>
                            <label className="block text-sm font-medium mb-1">Automation Name</label>
                            <input
                                className="w-full p-2 border rounded"
                                value={newItem.name}
                                onChange={e => setNewItem({ ...newItem, name: e.target.value })}
                                required
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium mb-1">Trigger</label>
                            <select
                                className="w-full p-2 border rounded"
                                value={newItem.triggerType}
                                onChange={e => setNewItem({ ...newItem, triggerType: e.target.value })}
                            >
                                {Object.entries(triggers).map(([k, v]) => (
                                    <option key={k} value={k}>{v}</option>
                                ))}
                            </select>
                        </div>
                        <div className="flex gap-2">
                            <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded">Create</button>
                            <button type="button" onClick={() => setShowCreate(false)} className="px-4 py-2 text-gray-500">Cancel</button>
                        </div>
                    </form>
                </div>
            )}

            {isLoading ? <Loader2 className="animate-spin" /> : (
                <div className="grid gap-4">
                    {automations.map(aut => (
                        <div key={aut.id} className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm flex items-center justify-between">
                            <div className="flex items-center gap-4">
                                <div className={`p-3 rounded-lg ${aut.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                                    <Zap size={24} />
                                </div>
                                <div>
                                    <h3 className="font-semibold text-gray-900">{aut.name}</h3>
                                    <div className="flex items-center gap-2 text-sm text-gray-500">
                                        <span className="font-medium text-gray-700">Trigger:</span> {triggers[aut.triggerType] || aut.triggerType}
                                        <span className="text-gray-300">|</span>
                                        <span className="flex items-center gap-1"><GitBranch size={14} /> {aut.enrollments?.length || 0} active</span>
                                    </div>
                                </div>
                            </div>

                            <div className="flex items-center gap-3">
                                <button
                                    onClick={() => toggleActive(aut)}
                                    className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${aut.isActive
                                        ? 'bg-green-100 text-green-800 hover:bg-green-200'
                                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                        }`}
                                >
                                    {aut.isActive ? <><Pause size={14} /> Active</> : <><Play size={14} /> Paused</>}
                                </button>
                                <button onClick={() => onEdit(aut.id, aut.name)} className="text-blue-600 hover:text-blue-800 p-2 font-medium text-sm">
                                    Edit Flow
                                </button>
                                <button onClick={() => handleDelete(aut.id)} className="p-2 text-gray-400 hover:text-red-600">
                                    <Trash2 size={18} />
                                </button>
                            </div>
                        </div>
                    ))}
                    {automations.length === 0 && (
                        <div className="text-center py-12 text-gray-500">No automations created yet.</div>
                    )}
                </div>
            )
            }
        </div >
    );
}
