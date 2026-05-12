import { useCallback, useEffect, useState } from 'react';
import { Logger } from '../../utils/logger';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { Plus, Loader2, Trash2, AlertTriangle, ListChecks } from 'lucide-react';
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

interface EmailListItem {
    id: string;
    name: string;
    description?: string | null;
    _count?: { memberships?: number };
}

interface EmailListMember {
    id: string;
    email: string;
    isSubscribed: boolean;
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
    const [audienceType, setAudienceType] = useState<'all' | 'segment' | 'list'>('all');
    const [showListManager, setShowListManager] = useState(false);
    const [selectedListId, setSelectedListId] = useState<string>('');
    const [members, setMembers] = useState<EmailListMember[]>([]);
    const [newListName, setNewListName] = useState('');
    const [newMemberEmail, setNewMemberEmail] = useState('');
    const [deletingId, setDeletingId] = useState<string | null>(null);

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
                if (!selectedListId && data.length > 0) {
                    setSelectedListId(data[0].id);
                }
            }
        } catch (e) {
            Logger.error('An error occurred', { error: e });
        }
    }, [currentAccount, selectedListId, token]);

    const fetchMembers = useCallback(async (listId: string) => {
        if (!currentAccount || !listId) return;
        try {
            const res = await fetch(`/api/email/lists/${listId}/members`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount.id
                }
            });
            if (res.ok) {
                const data = await res.json();
                setMembers(Array.isArray(data) ? data : []);
            }
        } catch (e) {
            Logger.error('Failed to fetch list members', { error: e });
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
        if (selectedListId) {
            void fetchMembers(selectedListId);
        }
    }, [fetchMembers, selectedListId]);

    async function handleCreate(e: React.FormEvent) {
        e.preventDefault();
        try {
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
                setAudienceType('all');
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

    async function handleCreateList(e: React.FormEvent) {
        e.preventDefault();
        if (!newListName.trim()) return;
        const res = await fetch('/api/email/lists', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
                'x-account-id': currentAccount?.id || ''
            },
            body: JSON.stringify({ name: newListName.trim() })
        });
        if (!res.ok) {
            toast.error('Failed to create list');
            return;
        }
        const created = await res.json();
        setNewListName('');
        await fetchLists();
        setSelectedListId(created.id);
        toast.success('List created');
    }

    async function handleAddMember(e: React.FormEvent) {
        e.preventDefault();
        if (!selectedListId || !newMemberEmail.trim()) return;
        const res = await fetch(`/api/email/lists/${selectedListId}/members`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
                'x-account-id': currentAccount?.id || ''
            },
            body: JSON.stringify({ email: newMemberEmail.trim(), isSubscribed: true, source: 'ADMIN' })
        });
        if (!res.ok) {
            toast.error('Failed to add member');
            return;
        }
        setNewMemberEmail('');
        await fetchMembers(selectedListId);
        await fetchLists();
    }

    async function handleToggleMember(member: EmailListMember) {
        if (!selectedListId) return;
        const res = await fetch(`/api/email/lists/${selectedListId}/members`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
                'x-account-id': currentAccount?.id || ''
            },
            body: JSON.stringify({ email: member.email, isSubscribed: !member.isSubscribed, source: 'ADMIN' })
        });
        if (res.ok) {
            await fetchMembers(selectedListId);
            await fetchLists();
        }
    }

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h2 className="text-xl font-semibold text-gray-900">Email Broadcasts</h2>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setShowListManager(true)}
                        className="flex items-center gap-2 border border-gray-300 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-50"
                    >
                        <ListChecks size={18} /> Manage Lists
                    </button>
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
                            <div className="w-72 space-y-2">
                                <label className="block text-sm font-medium mb-1">Audience</label>
                                <select
                                    className="w-full p-2 border rounded-sm"
                                    value={audienceType}
                                    onChange={e => setAudienceType(e.target.value as 'all' | 'segment' | 'list')}
                                >
                                    <option value="all">All Customers</option>
                                    <option value="segment">Segment</option>
                                    <option value="list">Email List</option>
                                </select>
                                {audienceType === 'segment' && (
                                    <select
                                        className="w-full p-2 border rounded-sm"
                                        value={newItem.segmentId || ''}
                                        onChange={e => setNewItem({ ...newItem, segmentId: e.target.value })}
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
                                    >
                                        <option value="">Select Email List</option>
                                        {lists.map(l => (
                                            <option key={l.id} value={l.id}>{l.name} ({l._count?.memberships || 0} subscribed)</option>
                                        ))}
                                    </select>
                                )}
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
                                        <span
                                            title={c.sentCount > 0 ? `Open rate: ${((c.openedCount / c.sentCount) * 100).toFixed(1)}%` : 'No sends yet'}
                                            className="cursor-default"
                                        >
                                            {c.sentCount} sent · {c.openedCount} opened
                                            {c.sentCount > 0 && (
                                                <span className="ml-1 text-xs text-gray-400">
                                                    ({((c.openedCount / c.sentCount) * 100).toFixed(0)}%)
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

            <Modal isOpen={showListManager} onClose={() => setShowListManager(false)} title="Email Lists" maxWidth="max-w-2xl">
                <div className="space-y-4">
                    <form onSubmit={handleCreateList} className="flex gap-2">
                        <input
                            className="flex-1 p-2 border rounded-sm"
                            placeholder="New list name"
                            value={newListName}
                            onChange={(e) => setNewListName(e.target.value)}
                        />
                        <button type="submit" className="px-3 py-2 bg-blue-600 text-white rounded-sm">Create</button>
                    </form>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="border rounded-lg p-3">
                            <div className="text-sm font-medium mb-2">Lists</div>
                            <div className="space-y-2 max-h-64 overflow-y-auto">
                                {lists.map((list) => (
                                    <button
                                        key={list.id}
                                        onClick={() => setSelectedListId(list.id)}
                                        className={`w-full text-left p-2 rounded ${selectedListId === list.id ? 'bg-blue-50 border border-blue-200' : 'hover:bg-gray-50 border border-transparent'}`}
                                    >
                                        <div className="font-medium text-sm text-gray-900">{list.name}</div>
                                        <div className="text-xs text-gray-500">{list._count?.memberships || 0} subscribed</div>
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="border rounded-lg p-3">
                            <div className="text-sm font-medium mb-2">Members</div>
                            <form onSubmit={handleAddMember} className="flex gap-2 mb-3">
                                <input
                                    className="flex-1 p-2 border rounded-sm"
                                    placeholder="customer@email.com"
                                    value={newMemberEmail}
                                    onChange={(e) => setNewMemberEmail(e.target.value)}
                                />
                                <button type="submit" className="px-3 py-2 bg-gray-900 text-white rounded-sm">Add</button>
                            </form>
                            <div className="space-y-2 max-h-64 overflow-y-auto">
                                {members.map((member) => (
                                    <div key={member.id} className="flex items-center justify-between text-sm border rounded p-2">
                                        <span className="truncate pr-2">{member.email}</span>
                                        <button
                                            onClick={() => handleToggleMember(member)}
                                            className={`px-2 py-1 rounded text-xs ${member.isSubscribed ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}
                                        >
                                            {member.isSubscribed ? 'Subscribed' : 'Unsubscribed'}
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            </Modal>
        </div>
    );
}
