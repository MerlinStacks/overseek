/**
 * FlowsList - Displays and manages automation flows.
 * Simplified creation: just name, then visual builder handles triggers/actions.
 */
import { useEffect, useState, useCallback } from 'react';
import { Logger } from '../../utils/logger';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { Plus, Zap, Play, Pause, Trash2, Loader2, GitBranch } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Toast, ToastType } from '../ui/Toast';

interface FlowRecord {
    id: string;
    name: string;
    isActive: boolean;
    triggerType?: string;
    enrollments?: unknown[];
}

export function AutomationsList({ onEdit }: { onEdit: (id: string, name: string) => void }) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [flows, setFlows] = useState<FlowRecord[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    // Create Modal - simplified: name only
    const [showCreate, setShowCreate] = useState(false);
    const [newFlowName, setNewFlowName] = useState('');
    const [updatingFlowId, setUpdatingFlowId] = useState<string | null>(null);
    const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null);

    const [toastMessage, setToastMessage] = useState('');
    const [toastVisible, setToastVisible] = useState(false);
    const [toastType, setToastType] = useState<ToastType>('error');
    const showToast = useCallback((message: string, type: ToastType = 'error') => {
        setToastMessage(message); setToastType(type); setToastVisible(true);
    }, []);

    const fetchData = useCallback(async () => {
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
                if (Array.isArray(data)) setFlows(data as FlowRecord[]);
                else setFlows([]);
            } else {
                Logger.error('Failed to fetch flows', { status: res.status });
                setFlows([]);
            }
        } catch (err) { Logger.error('An error occurred', { error: err }); setFlows([]); }
        finally { setIsLoading(false); }
    }, [currentAccount, token]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    async function handleCreate(e: React.FormEvent) {
        e.preventDefault();
        if (!newFlowName.trim()) { showToast('Flow name is required'); return; }

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
            } else {
                const err = await res.json().catch(() => null);
                showToast(err?.error || 'Failed to create flow');
            }
        } catch (err) { Logger.error('Failed to create flow', { error: err }); showToast('Failed to create flow — network error'); }
    }

    async function toggleActive(flow: FlowRecord) {
        const nextIsActive = !flow.isActive;
        setUpdatingFlowId(flow.id);
        setFlows((prev) => prev.map((item) => (item.id === flow.id ? { ...item, isActive: nextIsActive } : item)));

        try {
            const res = await fetch(`/api/marketing/automations/${flow.id}/status`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount?.id || ''
                },
                body: JSON.stringify({ isActive: nextIsActive })
            });

            if (!res.ok) {
                throw new Error('Failed to update flow status');
            }

            showToast(`Flow ${nextIsActive ? 'enabled' : 'disabled'}`, 'success');

            fetchData();
        } catch (err) {
            Logger.error('Failed to toggle flow', { error: err });
            setFlows((prev) => prev.map((item) => (item.id === flow.id ? { ...item, isActive: flow.isActive } : item)));
            showToast('Failed to toggle flow');
        } finally {
            setUpdatingFlowId(null);
        }
    }

    async function handleDelete(id: string) {
        try {
            const res = await fetch(`/api/marketing/automations/${id}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount?.id || ''
                }
            });
            if (!res.ok) {
                throw new Error('Failed to delete flow');
            }
            fetchData();
        } catch (err) { Logger.error('Failed to delete flow', { error: err }); showToast('Failed to delete flow'); }
    }

    async function confirmDeleteFlow() {
        if (!pendingDelete) return;
        await handleDelete(pendingDelete.id);
        setPendingDelete(null);
        showToast('Flow deleted', 'success');
    }

    // Trigger type display labels
    const triggers: Record<string, string> = {
        'ORDER_CREATED': 'Order Created',
        'ORDER_PAID': 'Order Paid',
        'ORDER_COMPLETED': 'Order Completed',
        'ORDER_STATUS_CHANGED': 'Order Status Changed',
        'FIRST_ORDER': 'First Order',
        'REVIEW_LEFT': 'Review Left',
        'SHIPMENT_IN_TRANSIT': 'Shipment In Transit',
        'SHIPMENT_OUT_FOR_DELIVERY': 'Shipment Out For Delivery',
        'SHIPMENT_DELIVERY_ATTEMPTED': 'Shipment Delivery Attempted',
        'SHIPMENT_DELIVERED': 'Shipment Delivered',
        'SHIPMENT_EXCEPTION': 'Shipment Exception',
        'ABANDONED_CART': 'Abandoned Cart',
        'CUSTOMER_CREATED': 'Customer Created',
        'NO_PURCHASE_IN_X_DAYS': 'No Purchase In X Days',
        'NONE': 'No Trigger'
    };

    return (
        <>
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
                                        disabled={updatingFlowId === flow.id}
                                        className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${flow.isActive
                                            ? 'bg-green-100 text-green-800 hover:bg-green-200'
                                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                            } ${updatingFlowId === flow.id ? 'cursor-not-allowed opacity-60' : ''}`}
                                    >
                                        {updatingFlowId === flow.id
                                            ? <>Updating...</>
                                            : (flow.isActive ? <><Pause size={14} /> Active</> : <><Play size={14} /> Paused</>)}
                                    </button>
                                    <button onClick={() => onEdit(flow.id, flow.name)} className="text-blue-600 hover:text-blue-800 p-2 font-medium text-sm">
                                        Edit Flow
                                    </button>
                                    <button onClick={() => setPendingDelete({ id: flow.id, name: flow.name })} className="p-2 text-gray-400 hover:text-red-600">
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

            <Toast message={toastMessage} isVisible={toastVisible} onClose={() => setToastVisible(false)} type={toastType} />
            <Modal
                isOpen={Boolean(pendingDelete)}
                onClose={() => setPendingDelete(null)}
                title="Delete flow"
                maxWidth="max-w-md"
            >
                <div className="space-y-4">
                    <p className="text-sm text-slate-700 dark:text-slate-200">
                        This will permanently delete <span className="font-semibold">{pendingDelete?.name}</span>.
                    </p>
                    <div className="flex justify-end gap-2">
                        <button
                            type="button"
                            onClick={() => setPendingDelete(null)}
                            className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            onClick={confirmDeleteFlow}
                            className="rounded-md bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700"
                        >
                            Delete Flow
                        </button>
                    </div>
                </div>
            </Modal>
        </>);
}
