
import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { Plus, Mail, Send, Loader2, Trash2 } from 'lucide-react';

export function CampaignsList({ onEdit }: { onEdit: (id: string, name: string, subject?: string) => void }) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [campaigns, setCampaigns] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    // Create Modal state
    const [showCreate, setShowCreate] = useState(false);
    const [newItem, setNewItem] = useState({ name: '', subject: '' });

    const [segments, setSegments] = useState<any[]>([]);

    useEffect(() => {
        fetchData();
        fetchSegments();
    }, [currentAccount, token]);

    async function fetchSegments() {
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
                console.error("Failed to fetch segments:", res.status, await res.text());
            }
        } catch (e) { console.error(e); }
    }

    async function fetchData() {
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
                    console.error("Campaigns data is not an array:", data);
                    setCampaigns([]);
                }
            } else {
                console.error("Failed to fetch campaigns:", res.status, await res.text());
                setCampaigns([]);
            }
        } catch (err) {
            console.error(err);
            setCampaigns([]);
        } finally {
            setIsLoading(false);
        }
    }

    async function handleCreate(e: React.FormEvent) {
        e.preventDefault();
        try {
            const res = await fetch('/api/marketing/campaigns', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount?.id || ''
                },
                body: JSON.stringify(newItem)
            });
            if (res.ok) {
                const data = await res.json();
                setShowCreate(false);
                setNewItem({ name: '', subject: '' });
                // fetchData(); // No need if we switch view
                onEdit(data.id, data.name, data.subject);
            } else {
                const errorData = await res.json().catch(() => ({}));
                console.error("Campaign create error:", errorData);
                alert(`Failed to create campaign: ${errorData.error || 'Unknown error'} \n\nCheck console for details.`);
            }
        } catch (err) { alert('Error creating campaign'); }
    }

    async function handleDelete(id: string) {
        if (!confirm('Are you sure?')) return;
        if (!currentAccount) return;
        try {
            await fetch(`/api/marketing/campaigns/${id}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount.id
                }
            });
            fetchData();
        } catch (err) { alert('Failed to delete'); }
    }

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h2 className="text-xl font-semibold text-gray-900">Email Broadcasts</h2>
                <button
                    onClick={() => setShowCreate(true)}
                    className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
                >
                    <Plus size={18} /> New Campaign
                </button>
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
                            <div className="w-64">
                                <label className="block text-sm font-medium mb-1">Recipient Segment</label>
                                <select
                                    className="w-full p-2 border rounded-sm"
                                    value={(newItem as any).segmentId || ''}
                                    onChange={e => setNewItem({ ...newItem, segmentId: e.target.value } as any)}
                                >
                                    <option value="">All Customers</option>
                                    {segments.map(s => (
                                        <option key={s.id} value={s.id}>{s.name} ({s._count?.campaigns || 0} used)</option>
                                    ))}
                                </select>
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
                                        {c.sentCount} sent • {c.openedCount} opened
                                    </td>
                                    <td className="p-4 text-sm text-gray-600">
                                        {c.scheduledAt ? new Date(c.scheduledAt).toLocaleDateString() : '-'}
                                    </td>
                                    <td className="p-4 text-right">
                                        <button onClick={() => handleDelete(c.id)} className="text-red-500 hover:text-red-700 p-2">
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
        </div>
    );
}
