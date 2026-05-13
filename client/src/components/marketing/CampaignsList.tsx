import { useCallback, useEffect, useState } from 'react';
import { Logger } from '../../utils/logger';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { Plus, Loader2, Trash2, AlertTriangle, CalendarClock, X } from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import { Modal } from '../ui/Modal';

interface MarketingCampaign {
    id: string;
    name: string;
    subject?: string;
    status: 'SENT' | 'DRAFT' | string;
    sentCount: number;
    openedCount: number;
    scheduledAt?: string | null;
    progress?: {
        processedCount: number;
        sentCount: number;
        failedCount: number;
        skippedCount: number;
        lastEventAt?: string | null;
    };
}

interface SegmentItem {
    id: string;
    name: string;
    _count?: { campaigns?: number };
}

interface NewCampaignInput {
    name: string;
    subject: string;
    segmentId?: string;
    listId?: string;
}

type AudienceType = 'all' | 'segment' | 'list';

interface EmailListItem {
    id: string;
    name: string;
    description?: string | null;
    _count?: { memberships?: number };
}

export function CampaignsList({ onEdit }: { onEdit: (id: string, name: string, subject?: string) => void }) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const toast = useToast();
    const [campaigns, setCampaigns] = useState<MarketingCampaign[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    // Create Modal state
    const [showCreate, setShowCreate] = useState(false);
    const [newItem, setNewItem] = useState<NewCampaignInput>({ name: '', subject: '' });

    const [segments, setSegments] = useState<SegmentItem[]>([]);
    const [lists, setLists] = useState<EmailListItem[]>([]);
    const [audienceType, setAudienceType] = useState<AudienceType | ''>('');
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [sendingId, setSendingId] = useState<string | null>(null);
    const [schedulingId, setSchedulingId] = useState<string | null>(null);
    const [scheduleValue, setScheduleValue] = useState('');

    const fetchLists = useCallback(async () => {
        if (!currentAccount) return;
        try {
            const res = await fetch('/api/email/lists', {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount.id
                }
            });
            if (res.ok) {
                const data = await res.json();
                setLists(Array.isArray(data) ? data : []);
            }
        } catch (e) {
            Logger.error('An error occurred', { error: e });
        }
    }, [currentAccount, token]);

    const fetchSegments = useCallback(async () => {
        if (!currentAccount) return;
        try {
            const res = await fetch('/api/segments', {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount.id
                }
            });
            if (res.ok) {
                setSegments(await res.json());
            } else {
                Logger.error('Failed to fetch segments', { status: res.status });
            }
        } catch (e) { Logger.error('An error occurred', { error: e }); }
    }, [currentAccount, token]);

    const fetchData = useCallback(async () => {
        if (!currentAccount) return;
        try {
            const res = await fetch('/api/marketing/campaigns', {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount.id
                }
            });

            if (res.ok) {
                const data = await res.json();
                if (Array.isArray(data)) {
                    setCampaigns(data);
                } else {
                    Logger.error('Campaigns data is not an array:', { error: data });
                    setCampaigns([]);
                }
            } else {
                Logger.error('Failed to fetch campaigns', { status: res.status });
                setCampaigns([]);
            }
        } catch (err) {
            Logger.error('An error occurred', { error: err });
            setCampaigns([]);
        } finally {
            setIsLoading(false);
        }
    }, [currentAccount, token]);

    useEffect(() => {
        void fetchData();
        void fetchSegments();
        void fetchLists();
    }, [fetchData, fetchSegments, fetchLists]);

    useEffect(() => {
        const hasSendingCampaign = campaigns.some((campaign) => campaign.status === 'SENDING');
        if (!hasSendingCampaign) return;

        const timer = window.setInterval(() => {
            void fetchData();
        }, 5000);

        return () => window.clearInterval(timer);
    }, [campaigns, fetchData]);

    async function handleCreate(e: React.FormEvent) {
        e.preventDefault();
        try {
            if (!audienceType) {
                toast.error('Please choose an audience before creating a campaign');
                return;
            }

            if (audienceType === 'segment' && !newItem.segmentId) {
                toast.error('Please select a segment');
                return;
            }

            if (audienceType === 'list' && !newItem.listId) {
                toast.error('Please select an email list');
                return;
            }

            const payload: NewCampaignInput = { ...newItem };
            if (audienceType === 'all') {
                payload.segmentId = '';
                payload.listId = '';
            } else if (audienceType === 'segment') {
                payload.listId = '';
            } else {
                payload.segmentId = '';
            }

            const res = await fetch('/api/marketing/campaigns', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount?.id || ''
                },
                body: JSON.stringify(payload)
            });
            if (res.ok) {
                const data = await res.json();
                setShowCreate(false);
                setNewItem({ name: '', subject: '' });
                setAudienceType('');
                // fetchData(); // No need if we switch view
                onEdit(data.id, data.name, data.subject);
            } else {
                const errorData = await res.json().catch(() => ({}));
                Logger.error('Campaign create error:', { error: errorData });
                toast.error(`Failed to create campaign: ${errorData.error || 'Unknown error'}`);
            }
        } catch (err) { toast.error('Error creating campaign'); }
    }

    async function handleDelete(id: string) {
        if (!currentAccount) return;
        try {
            await fetch(`/api/marketing/campaigns/${id}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount.id
                }
            });
            setDeletingId(null);
            fetchData();
            toast.success('Campaign deleted');
        } catch (err) { toast.error('Failed to delete campaign'); }
    }

    async function handleSendCampaign(id: string) {
        if (!currentAccount) return;
        setSendingId(id);
        try {
            const res = await fetch(`/api/marketing/campaigns/${id}/send`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount.id
                }
            });

            if (!res.ok) {
                const payload = await res.json().catch(() => ({}));
                throw new Error(payload.error || 'Failed to queue campaign send');
            }

            toast.success('Campaign queued for sending');
            await fetchData();
        } catch (error: any) {
            toast.error(error?.message || 'Failed to queue campaign send');
        } finally {
            setSendingId(null);
        }
    }

    function openScheduleModal(campaign: MarketingCampaign) {
        setSchedulingId(campaign.id);
        if (campaign.scheduledAt) {
            const date = new Date(campaign.scheduledAt);
            setScheduleValue(new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16));
            return;
        }

        const nextHour = new Date();
        nextHour.setMinutes(0, 0, 0);
        nextHour.setHours(nextHour.getHours() + 1);
        setScheduleValue(new Date(nextHour.getTime() - nextHour.getTimezoneOffset() * 60000).toISOString().slice(0, 16));
    }

    async function handleScheduleCampaign(id: string) {
        if (!currentAccount || !scheduleValue) return;
        try {
            const res = await fetch(`/api/marketing/campaigns/${id}/schedule`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount.id
                },
                body: JSON.stringify({ scheduledAt: new Date(scheduleValue).toISOString() })
            });

            if (!res.ok) {
                const payload = await res.json().catch(() => ({}));
                throw new Error(payload.error || 'Failed to schedule campaign');
            }

            setSchedulingId(null);
            toast.success('Campaign scheduled');
            await fetchData();
        } catch (error: any) {
            toast.error(error?.message || 'Failed to schedule campaign');
        }
    }

    async function handleUnscheduleCampaign(id: string) {
        if (!currentAccount) return;
        try {
            const res = await fetch(`/api/marketing/campaigns/${id}/schedule`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount.id
                }
            });

            if (!res.ok) {
                const payload = await res.json().catch(() => ({}));
                throw new Error(payload.error || 'Failed to unschedule campaign');
            }

            toast.success('Campaign unscheduled');
            await fetchData();
        } catch (error: any) {
            toast.error(error?.message || 'Failed to unschedule campaign');
        }
    }

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h2 className="text-xl font-semibold text-gray-900">Email Broadcasts</h2>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setShowCreate(true)}
                        className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
                    >
                        <Plus size={18} /> New Campaign
                    </button>
                </div>
            </div>

            {showCreate && (
                <div className="bg-gray-50 p-4 rounded-lg border border-gray-200 mb-4">
                    <form onSubmit={handleCreate} className="flex flex-col gap-4">
                        <div className="flex gap-4 items-end">
                            <div className="w-72 space-y-2">
                                <label className="block text-sm font-medium mb-1">Audience</label>
                                <select
                                    className="w-full p-2 border rounded-sm"
                                    value={audienceType}
                                    onChange={e => {
                                        const nextAudienceType = e.target.value as AudienceType | '';
                                        setAudienceType(nextAudienceType);
                                        setNewItem(prev => ({
                                            ...prev,
                                            segmentId: nextAudienceType === 'segment' ? prev.segmentId : '',
                                            listId: nextAudienceType === 'list' ? prev.listId : ''
                                        }));
                                    }}
                                    required
                                >
                                    <option value="">Select Audience</option>
                                    <option value="all">All Customers</option>
                                    <option value="segment">Segment</option>
                                    <option value="list">Email List</option>
                                </select>
                                {audienceType === 'segment' && (
                                    <select
                                        className="w-full p-2 border rounded-sm"
                                        value={newItem.segmentId || ''}
                                        onChange={e => setNewItem({ ...newItem, segmentId: e.target.value })}
                                        required
                                    >
                                        <option value="">Select Segment</option>
                                        {segments.map(s => (
                                            <option key={s.id} value={s.id}>{s.name} ({s._count?.campaigns || 0} used)</option>
                                        ))}
                                    </select>
                                )}
                                {audienceType === 'list' && (
                                    <select
                                        className="w-full p-2 border rounded-sm"
                                        value={newItem.listId || ''}
                                        onChange={e => setNewItem({ ...newItem, listId: e.target.value })}
                                        required
                                    >
                                        <option value="">Select Email List</option>
                                        {lists.map(l => (
                                            <option key={l.id} value={l.id}>{l.name} ({l._count?.memberships || 0} subscribed)</option>
                                        ))}
                                    </select>
                                )}
                            </div>
                            <div className="flex-1">
                                <label className="block text-sm font-medium mb-1">Campaign Name</label>
                                <input
                                    className="w-full p-2 border rounded-sm"
                                    value={newItem.name}
                                    onChange={e => setNewItem({ ...newItem, name: e.target.value })}
                                    required
                                />
                            </div>
                            <div className="flex-1">
                                <label className="block text-sm font-medium mb-1">Subject Line</label>
                                <input
                                    className="w-full p-2 border rounded-sm"
                                    value={newItem.subject}
                                    onChange={e => setNewItem({ ...newItem, subject: e.target.value })}
                                    required
                                />
                            </div>
                        </div>
                        <div className="flex gap-2 justify-end">
                            <button type="button" onClick={() => setShowCreate(false)} className="px-4 py-2 text-gray-500">Cancel</button>
                            <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded-sm">Create & Edit Design</button>
                        </div>
                    </form>
                </div>
            )}

            {isLoading ? <Loader2 className="animate-spin" /> : (
                <div className="bg-white rounded-xl shadow-xs border border-gray-200 overflow-hidden">
                    <table className="w-full text-left">
                        <thead className="bg-gray-50 border-b">
                            <tr>
                                <th className="p-4 font-medium text-gray-500">Name</th>
                                <th className="p-4 font-medium text-gray-500">Status</th>
                                <th className="p-4 font-medium text-gray-500">Sent / Opened</th>
                                <th className="p-4 font-medium text-gray-500">Schedule</th>
                                <th className="p-4 font-medium text-gray-500 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {campaigns.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className="p-8 text-center text-gray-500">No campaigns found.</td>
                                </tr>
                            ) : campaigns.map(c => (
                                <tr key={c.id} className="border-b last:border-0 hover:bg-gray-50">
                                    <td className="p-4">
                                        <div className="font-medium text-gray-900">{c.name}</div>
                                        <div className="text-sm text-gray-500">{c.subject}</div>
                                    </td>
                                    <td className="p-4">
                                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${c.status === 'SENT' ? 'bg-green-100 text-green-800' :
                                            c.status === 'DRAFT' ? 'bg-gray-100 text-gray-800' :
                                                'bg-blue-100 text-blue-800'
                                            }`}>
                                            {c.status}
                                        </span>
                                    </td>
                                    <td className="p-4 text-sm text-gray-600">
                                        {c.progress && c.status === 'SENDING' && (
                                            <div className="mb-1 text-xs text-gray-500">
                                                {c.progress.processedCount} processed · {c.progress.failedCount} failed · {c.progress.skippedCount} skipped
                                            </div>
                                        )}
                                        <span
                                            title={(c.progress?.sentCount || c.sentCount) > 0 ? `Open rate: ${((c.openedCount / (c.progress?.sentCount || c.sentCount)) * 100).toFixed(1)}%` : 'No sends yet'}
                                            className="cursor-default"
                                        >
                                            {(c.progress?.sentCount || c.sentCount)} sent · {c.openedCount} opened
                                            {(c.progress?.sentCount || c.sentCount) > 0 && (
                                                <span className="ml-1 text-xs text-gray-400">
                                                    ({((c.openedCount / (c.progress?.sentCount || c.sentCount)) * 100).toFixed(0)}%)
                                                </span>
                                            )}
                                        </span>
                                    </td>
                                    <td className="p-4 text-sm text-gray-600">
                                        {c.scheduledAt ? (
                                            <div>
                                                <div>{new Date(c.scheduledAt).toLocaleDateString()}</div>
                                                <div className="text-xs text-gray-400">{new Date(c.scheduledAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</div>
                                            </div>
                                        ) : '-'}
                                    </td>
                                    <td className="p-4 text-right">
                                        <button onClick={() => setDeletingId(c.id)} className="text-red-500 hover:text-red-700 p-2">
                                            <Trash2 size={16} />
                                        </button>
                                        <button
                                            onClick={() => handleSendCampaign(c.id)}
                                            disabled={c.status === 'SENDING' || c.status === 'SENT' || sendingId === c.id}
                                            className="text-emerald-600 hover:text-emerald-800 disabled:opacity-50 p-2 font-medium text-sm"
                                        >
                                            {sendingId === c.id ? 'Queueing...' : (c.status === 'SENDING' ? 'Sending...' : (c.status === 'SENT' ? 'Sent' : 'Send'))}
                                        </button>
                                        {c.status === 'SCHEDULED' ? (
                                            <button
                                                onClick={() => handleUnscheduleCampaign(c.id)}
                                                className="text-amber-600 hover:text-amber-800 p-2 font-medium text-sm"
                                            >
                                                Unschedule
                                            </button>
                                        ) : (
                                            <button
                                                onClick={() => openScheduleModal(c)}
                                                disabled={c.status === 'SENDING' || c.status === 'SENT'}
                                                className="text-violet-600 hover:text-violet-800 disabled:opacity-50 p-2 font-medium text-sm inline-flex items-center gap-1"
                                            >
                                                <CalendarClock size={14} /> {c.scheduledAt ? 'Reschedule' : 'Schedule'}
                                            </button>
                                        )}
                                        <button onClick={() => onEdit(c.id, c.name, c.subject)} className="text-blue-600 hover:text-blue-800 p-2 font-medium text-sm">
                                            Edit
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            <Modal
                isOpen={!!schedulingId}
                onClose={() => setSchedulingId(null)}
                title="Schedule Campaign"
                maxWidth="max-w-md"
            >
                <div className="space-y-4">
                    <p className="text-sm text-gray-600 dark:text-gray-300">Choose when this campaign should start sending.</p>
                    <input
                        type="datetime-local"
                        value={scheduleValue}
                        onChange={(e) => setScheduleValue(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    />
                    <div className="flex justify-end gap-3">
                        <button
                            onClick={() => setSchedulingId(null)}
                            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-lg transition-colors inline-flex items-center gap-2"
                        >
                            <X size={14} /> Cancel
                        </button>
                        <button
                            onClick={() => schedulingId && handleScheduleCampaign(schedulingId)}
                            className="px-4 py-2 text-sm font-medium text-white bg-violet-600 hover:bg-violet-700 rounded-lg transition-colors"
                        >
                            Schedule
                        </button>
                    </div>
                </div>
            </Modal>

            <Modal
                isOpen={!!deletingId}
                onClose={() => setDeletingId(null)}
                title="Delete Campaign"
                maxWidth="max-w-sm"
            >
                <div className="space-y-4">
                    <div className="flex items-start gap-3">
                        <div className="p-2 bg-red-100 dark:bg-red-500/10 rounded-lg">
                            <AlertTriangle size={20} className="text-red-600 dark:text-red-400" />
                        </div>
                        <p className="text-sm text-gray-600 dark:text-gray-300">
                            Are you sure you want to delete this campaign? This action cannot be undone.
                        </p>
                    </div>
                    <div className="flex justify-end gap-3">
                        <button
                            onClick={() => setDeletingId(null)}
                            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={() => deletingId && handleDelete(deletingId)}
                            className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors"
                        >
                            Delete
                        </button>
                    </div>
                </div>
            </Modal>

        </div>
    );
}
