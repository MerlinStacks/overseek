/**
 * FlowsList - Displays and manages automation flows.
 * Simplified creation: just name, then visual builder handles triggers/actions.
 */
import { useEffect, useState, useCallback } from 'react';
import { Logger } from '../../utils/logger';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { Plus, Pause, Trash2, Loader2, Circle, CheckCircle2, XCircle, DollarSign } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Toast, ToastType } from '../ui/Toast';

interface FlowRecord {
    id: string;
    name: string;
    isActive: boolean;
    triggerType?: string;
    enrollments?: unknown[];
    metrics?: {
        activeInFlow: number;
        pausedInFlow: number;
        completedInFlow: number;
        failedInFlow: number;
        revenue: number;
    };
}

function formatRevenue(value: number): string {
    if (!value || value <= 0) return '-';
    if (value >= 1000) return `$${(value / 1000).toFixed(2)}k`;
    return `$${value.toFixed(2)}`;
}

function MetricPill({
    icon,
    value,
    label,
    className
}: {
    icon: React.ReactNode;
    value: string | number;
    label: string;
    className?: string;
}) {
    return (
        <span
            title={`${label}: ${value}`}
            aria-label={`${label}: ${value}`}
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium leading-5 ${className || 'bg-slate-100 text-slate-700'}`}
        >
            {icon}
            {value}
        </span>
    );
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
        'ORDER_CREATED': 'New Paid Order',
        'ORDER_PAID': 'Order Paid',
        'ORDER_COMPLETED': 'Order Completed',
        'ORDER_STATUS_CHANGED': 'Order Status Changed',
        'FIRST_ORDER': 'First Order',
        'REVIEW_LEFT': 'Review Left',
        'ARTWORK_UPLOADED': 'Artwork Uploaded',
        'ARTWORK_APPROVAL_REQUESTED': 'Artwork Approval Requested',
        'ARTWORK_APPROVED': 'Artwork Approved',
        'ARTWORK_CHANGES_REQUESTED': 'Artwork Changes Requested',
        'ARTWORK_OVERRIDE_USED': 'Artwork Override Used',
        'SHIPMENT_RECEIVED_BY_CARRIER': 'Shipment Received By AusPost',
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
            <div className="space-y-3">
                <div className="flex justify-end">
                    <button
                        onClick={() => setShowCreate(true)}
                        className="flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
                    >
                        <Plus size={16} /> New Flow
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
                    <div className="overflow-x-auto border-y border-slate-200 bg-white">
                        <table className="min-w-[1040px] w-full text-left text-xs text-slate-800">
                            <thead className="bg-slate-100 text-[11px] font-semibold text-slate-900">
                                <tr>
                                    <th className="w-10 px-3 py-2">
                                        <input type="checkbox" aria-label="Select all flows" className="h-4 w-4 rounded border-slate-300" disabled />
                                    </th>
                                    <th className="px-3 py-2">Name</th>
                                    <th className="px-3 py-2">Event</th>
                                    <th className="px-3 py-2">Category</th>
                                    <th className="px-3 py-2">Contact Activity</th>
                                    <th className="px-3 py-2">Revenue</th>
                                    <th className="px-3 py-2">Status</th>
                                    <th className="w-32 px-3 py-2 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {flows.map(flow => (
                                    <tr key={flow.id} className="h-10 hover:bg-slate-50">
                                        <td className="px-3 py-1.5 align-middle">
                                            <input type="checkbox" aria-label={`Select ${flow.name}`} className="h-4 w-4 rounded border-slate-300" />
                                        </td>
                                        <td className="max-w-[320px] px-3 py-1.5 align-middle">
                                            <button onClick={() => onEdit(flow.id, flow.name)} className="truncate font-semibold text-blue-700 hover:text-blue-900 hover:underline">
                                                {flow.name}
                                            </button>
                                        </td>
                                        <td className="px-3 py-1.5 align-middle text-slate-700">
                                            {triggers[flow.triggerType || 'NONE'] || flow.triggerType || 'No Trigger'}
                                        </td>
                                        <td className="px-3 py-1.5 align-middle text-slate-700">-</td>
                                        <td className="px-3 py-1.5 align-middle">
                                            <div className="flex flex-wrap items-center gap-1.5">
                                                <MetricPill icon={<Circle size={12} />} label="Active in flow" value={flow.metrics?.activeInFlow || flow.enrollments?.length || 0} />
                                                <MetricPill icon={<Pause size={12} />} label="Holding until next step" value={flow.metrics?.pausedInFlow || 0} />
                                                <MetricPill icon={<CheckCircle2 size={12} />} label="Completed flow" value={flow.metrics?.completedInFlow || 0} />
                                                <MetricPill icon={<XCircle size={12} />} label="Failed flow events" value={flow.metrics?.failedInFlow || 0} />
                                            </div>
                                        </td>
                                        <td className="px-3 py-1.5 align-middle">
                                            {flow.metrics?.revenue ? (
                                                <MetricPill icon={<DollarSign size={12} />} label="Revenue" value={formatRevenue(flow.metrics.revenue)} className="bg-teal-100 text-teal-800" />
                                            ) : '-'}
                                        </td>
                                        <td className="px-3 py-1.5 align-middle">
                                            <button
                                                onClick={() => toggleActive(flow)}
                                                disabled={updatingFlowId === flow.id}
                                                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium leading-5 transition-colors ${flow.isActive
                                                    ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                                                    : 'bg-red-50 text-red-600 hover:bg-red-100'
                                                    } ${updatingFlowId === flow.id ? 'cursor-not-allowed opacity-60' : ''}`}
                                            >
                                                {updatingFlowId === flow.id
                                                    ? 'Updating...'
                                                    : (flow.isActive ? 'Active' : 'Inactive')}
                                            </button>
                                        </td>
                                        <td className="px-3 py-1.5 align-middle">
                                            <div className="flex items-center justify-end gap-1">
                                                <button onClick={() => onEdit(flow.id, flow.name)} className="rounded-md px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 hover:text-blue-800">
                                                    Edit
                                                </button>
                                                <button onClick={() => setPendingDelete({ id: flow.id, name: flow.name })} className="rounded-md p-1 text-gray-400 hover:bg-red-50 hover:text-red-600">
                                                    <Trash2 size={15} />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                                {flows.length === 0 && (
                                    <tr>
                                        <td colSpan={8} className="py-12 text-center text-sm text-gray-500">No flows created yet. Create your first flow to automate customer engagement.</td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
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
