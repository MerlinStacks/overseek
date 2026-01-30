
import { useState, useEffect } from 'react';
import { Logger } from '../utils/logger';
import { useAuth } from '../context/AuthContext';
import { useAccount } from '../context/AccountContext';
import { Plus, Users, Edit2, Trash2 } from 'lucide-react';
import { SegmentBuilder, SegmentCriteria } from '../components/segments/SegmentBuilder';
import { useNavigate } from 'react-router-dom';

interface Segment {
    id: string;
    name: string;
    description: string;
    criteria: SegmentCriteria;
    campaigns?: any[];
    _count?: { campaigns: number };
}

export function SegmentsPage() {
    const navigate = useNavigate();
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [segments, setSegments] = useState<Segment[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isCreating, setIsCreating] = useState(false);
    const [editingSegment, setEditingSegment] = useState<Segment | null>(null);
    const [segmentName, setSegmentName] = useState('');
    const [segmentDesc, setSegmentDesc] = useState('');

    useEffect(() => {
        fetchSegments();
    }, [currentAccount, token]);

    async function fetchSegments() {
        if (!currentAccount || !token) return;
        try {
            const res = await fetch(`/api/segments`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'X-Account-ID': currentAccount.id
                }
            });
            if (res.ok) {
                const data = await res.json();
                setSegments(data);
            }
        } catch (err) {
            Logger.error('An error occurred', { error: err });
        } finally {
            setIsLoading(false);
        }
    }

    async function handleSave(criteria: SegmentCriteria) {
        if (!currentAccount || !token) return;

        // Basic validation
        if (!segmentName.trim()) {
            alert('Please enter a segment name');
            return;
        }

        const data = {
            name: segmentName,
            description: segmentDesc,
            criteria
        };

        try {
            let res;
            if (editingSegment) {
                res = await fetch(`/api/segments/${editingSegment.id}`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`,
                        'X-Account-ID': currentAccount.id
                    },
                    body: JSON.stringify(data)
                });
            } else {
                res = await fetch(`/api/segments`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`,
                        'X-Account-ID': currentAccount.id
                    },
                    body: JSON.stringify(data)
                });
            }

            if (res.ok) {
                setIsCreating(false);
                setEditingSegment(null);
                setSegmentName('');
                setSegmentDesc('');
                fetchSegments();
            } else {
                const err = await res.json();
                alert(err.error || 'Failed to save segment');
            }
        } catch (err) {
            Logger.error('An error occurred', { error: err });
        }
    }

    async function handleDelete(id: string) {
        if (!confirm('Are you sure you want to delete this segment?')) return;

        try {
            const res = await fetch(`/api/segments/${id}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'X-Account-ID': currentAccount!.id
                }
            });
            if (res.ok) {
                fetchSegments();
            }
        } catch (err) {
            Logger.error('An error occurred', { error: err });
        }
    }

    if (isCreating || editingSegment) {
        return (
            <div className="space-y-6 max-w-4xl mx-auto">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">{editingSegment ? 'Edit Segment' : 'Create New Segment'}</h1>
                    <p className="text-sm text-gray-500">Define criteria to group your customers.</p>
                </div>

                <div className="bg-white p-6 rounded-lg border border-gray-200 shadow-xs space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Segment Name</label>
                        <input
                            type="text"
                            className="w-full border border-gray-300 rounded-sm px-3 py-2 outline-hidden focus:ring-2 focus:ring-blue-500"
                            placeholder="e.g. VIP Customers"
                            value={segmentName}
                            onChange={e => setSegmentName(e.target.value)}
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Description (Optional)</label>
                        <input
                            type="text"
                            className="w-full border border-gray-300 rounded-sm px-3 py-2 outline-hidden focus:ring-2 focus:ring-blue-500"
                            placeholder="Customers who spent over $500"
                            value={segmentDesc}
                            onChange={e => setSegmentDesc(e.target.value)}
                        />
                    </div>
                </div>

                <SegmentBuilder
                    initialCriteria={editingSegment?.criteria}
                    onSave={handleSave}
                    onCancel={() => {
                        setIsCreating(false);
                        setEditingSegment(null);
                        setSegmentName('');
                        setSegmentDesc('');
                    }}
                />
            </div>
        )
    }

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">Segments</h1>
                    <p className="text-sm text-gray-500">Manage customer groups for targeted marketing</p>
                </div>
                <button
                    onClick={() => {
                        setSegmentName('');
                        setSegmentDesc('');
                        setIsCreating(true);
                    }}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
                >
                    <Plus size={18} />
                    Create Segment
                </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {segments.map(segment => (
                    <div key={segment.id} className="bg-white p-6 rounded-xl border border-gray-200 shadow-xs hover:shadow-md transition-shadow group relative">
                        <div className="flex justify-between items-start mb-4">
                            <div className="p-3 bg-blue-50 text-blue-600 rounded-lg">
                                <Users size={24} />
                            </div>
                            <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity bg-white p-1 rounded-lg border border-gray-100 shadow-xs">
                                <button
                                    onClick={() => {
                                        setSegmentName(segment.name);
                                        setSegmentDesc(segment.description || '');
                                        setEditingSegment(segment);
                                    }}
                                    className="p-1.5 text-gray-500 hover:text-blue-600 rounded-sm hover:bg-blue-50"
                                >
                                    <Edit2 size={16} />
                                </button>
                                <button
                                    onClick={() => handleDelete(segment.id)}
                                    className="p-1.5 text-gray-500 hover:text-red-600 rounded-sm hover:bg-red-50"
                                >
                                    <Trash2 size={16} />
                                </button>
                            </div>
                        </div>

                        <h3 className="text-lg font-semibold text-gray-900 mb-1">{segment.name}</h3>
                        <p className="text-sm text-gray-500 line-clamp-2 h-10 mb-4">{segment.description || 'No description'}</p>

                        <div className="flex items-center gap-4 text-xs font-medium text-gray-500 border-t border-gray-100 pt-4">
                            <span className="flex items-center gap-1">
                                <span className="w-1.5 h-1.5 bg-green-500 rounded-full"></span>
                                {segment.criteria?.type} Logic
                            </span>
                            <span>
                                {segment.criteria?.rules?.length || 0} Conditions
                            </span>
                            <span>
                                {segment._count?.campaigns || 0} Campaigns
                            </span>
                        </div>
                    </div>
                ))}

                {segments.length === 0 && !isLoading && (
                    <div className="col-span-full py-12 text-center text-gray-400 bg-gray-50 rounded-xl border border-dashed border-gray-200">
                        <Users size={48} className="mx-auto mb-4 opacity-50" />
                        <p className="text-lg font-medium text-gray-900">No segments yet</p>
                        <p className="text-sm mb-6">Create your first segment to start targeting customers.</p>
                        <button
                            onClick={() => setIsCreating(true)}
                            className="text-blue-600 hover:underline"
                        >
                            Create Segment
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
