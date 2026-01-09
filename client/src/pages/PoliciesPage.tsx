import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useAccount } from '../context/AccountContext';
import { Plus, FileText, BookOpen, GraduationCap, Trash2, Edit2, Eye, EyeOff, X, Save, ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '../utils/cn';

interface Policy {
    id: string;
    title: string;
    content: string;
    type: 'POLICY' | 'SOP' | 'TRAINING';
    category: string | null;
    isPublished: boolean;
    createdAt: string;
    updatedAt: string;
}

const typeConfig = {
    POLICY: { label: 'Policy', icon: FileText, color: 'bg-blue-100 text-blue-700' },
    SOP: { label: 'SOP', icon: BookOpen, color: 'bg-purple-100 text-purple-700' },
    TRAINING: { label: 'Training', icon: GraduationCap, color: 'bg-green-100 text-green-700' }
};

export function PoliciesPage() {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [policies, setPolicies] = useState<Policy[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [selectedPolicy, setSelectedPolicy] = useState<Policy | null>(null);
    const [isEditing, setIsEditing] = useState(false);
    const [expandedTypes, setExpandedTypes] = useState<string[]>(['POLICY', 'SOP', 'TRAINING']);

    // Form state
    const [formTitle, setFormTitle] = useState('');
    const [formContent, setFormContent] = useState('');
    const [formType, setFormType] = useState<'POLICY' | 'SOP' | 'TRAINING'>('POLICY');
    const [formCategory, setFormCategory] = useState('');
    const [formIsPublished, setFormIsPublished] = useState(true);

    useEffect(() => {
        if (currentAccount && token) fetchPolicies();
    }, [currentAccount, token]);

    const fetchPolicies = async () => {
        try {
            const res = await fetch('/api/policies', {
                headers: { Authorization: `Bearer ${token}`, 'x-account-id': currentAccount?.id || '' }
            });
            if (res.ok) setPolicies(await res.json());
        } catch (e) {
            console.error('Failed to fetch policies:', e);
        } finally {
            setIsLoading(false);
        }
    };

    const handleCreate = () => {
        setSelectedPolicy(null);
        setFormTitle('');
        setFormContent('');
        setFormType('POLICY');
        setFormCategory('');
        setFormIsPublished(true);
        setIsEditing(true);
    };

    const handleEdit = (policy: Policy) => {
        setSelectedPolicy(policy);
        setFormTitle(policy.title);
        setFormContent(policy.content);
        setFormType(policy.type);
        setFormCategory(policy.category || '');
        setFormIsPublished(policy.isPublished);
        setIsEditing(true);
    };

    const handleView = (policy: Policy) => {
        setSelectedPolicy(policy);
        setIsEditing(false);
    };

    const handleSave = async () => {
        if (!formTitle.trim()) return;

        const body = {
            title: formTitle,
            content: formContent,
            type: formType,
            category: formCategory || null,
            isPublished: formIsPublished
        };

        try {
            const url = selectedPolicy ? `/api/policies/${selectedPolicy.id}` : '/api/policies';
            const method = selectedPolicy ? 'PUT' : 'POST';
            const res = await fetch(url, {
                method,
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                    'x-account-id': currentAccount?.id || ''
                },
                body: JSON.stringify(body)
            });

            if (res.ok) {
                fetchPolicies();
                setIsEditing(false);
                if (!selectedPolicy) {
                    setSelectedPolicy(null);
                } else {
                    const updated = await res.json();
                    setSelectedPolicy(updated);
                }
            }
        } catch (e) {
            console.error('Failed to save policy:', e);
        }
    };

    const handleDelete = async (policyId: string) => {
        if (!confirm('Are you sure you want to delete this policy?')) return;

        try {
            const res = await fetch(`/api/policies/${policyId}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${token}`, 'x-account-id': currentAccount?.id || '' }
            });
            if (res.ok) {
                fetchPolicies();
                if (selectedPolicy?.id === policyId) {
                    setSelectedPolicy(null);
                    setIsEditing(false);
                }
            }
        } catch (e) {
            console.error('Failed to delete policy:', e);
        }
    };

    const toggleType = (type: string) => {
        setExpandedTypes(prev =>
            prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]
        );
    };

    const groupedPolicies = {
        POLICY: policies.filter(p => p.type === 'POLICY'),
        SOP: policies.filter(p => p.type === 'SOP'),
        TRAINING: policies.filter(p => p.type === 'TRAINING')
    };

    if (isLoading) return <div className="p-8">Loading policies...</div>;

    return (
        <div className="flex h-[calc(100vh-4rem)]">
            {/* Left Panel: List */}
            <div className="w-80 border-r border-gray-200 bg-white flex flex-col">
                <div className="p-4 border-b border-gray-200">
                    <div className="flex items-center justify-between mb-2">
                        <h1 className="text-lg font-bold text-gray-900">Policies & SOP</h1>
                        <button
                            onClick={handleCreate}
                            className="p-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                        >
                            <Plus size={18} />
                        </button>
                    </div>
                    <p className="text-xs text-gray-500">Manage policies, SOPs, and training materials</p>
                </div>

                <div className="flex-1 overflow-y-auto">
                    {(['POLICY', 'SOP', 'TRAINING'] as const).map(type => {
                        const config = typeConfig[type];
                        const items = groupedPolicies[type];
                        const isExpanded = expandedTypes.includes(type);

                        return (
                            <div key={type} className="border-b border-gray-100">
                                <button
                                    onClick={() => toggleType(type)}
                                    className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-gray-50 transition-colors"
                                >
                                    {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                                    <config.icon size={18} className="text-gray-500" />
                                    <span className="font-medium text-gray-700">{config.label}s</span>
                                    <span className="ml-auto text-xs text-gray-400">{items.length}</span>
                                </button>

                                {isExpanded && items.length > 0 && (
                                    <div className="pb-2">
                                        {items.map(policy => (
                                            <button
                                                key={policy.id}
                                                onClick={() => handleView(policy)}
                                                className={cn(
                                                    "w-full flex items-center gap-2 px-6 py-2 text-left text-sm transition-colors",
                                                    selectedPolicy?.id === policy.id
                                                        ? "bg-blue-50 text-blue-700 border-r-2 border-blue-600"
                                                        : "hover:bg-gray-50 text-gray-600"
                                                )}
                                            >
                                                <span className="truncate flex-1">{policy.title}</span>
                                                {!policy.isPublished && (
                                                    <EyeOff size={14} className="text-gray-400" />
                                                )}
                                            </button>
                                        ))}
                                    </div>
                                )}

                                {isExpanded && items.length === 0 && (
                                    <p className="px-6 py-2 text-xs text-gray-400 italic">No {config.label.toLowerCase()}s yet</p>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Right Panel: View/Edit */}
            <div className="flex-1 bg-gray-50 flex flex-col">
                {!selectedPolicy && !isEditing ? (
                    <div className="flex-1 flex items-center justify-center text-gray-400">
                        <div className="text-center">
                            <BookOpen size={48} className="mx-auto mb-4 opacity-50" />
                            <p>Select a policy to view or click + to create new</p>
                        </div>
                    </div>
                ) : (
                    <>
                        {/* Header */}
                        <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
                            {isEditing ? (
                                <input
                                    type="text"
                                    placeholder="Enter title..."
                                    value={formTitle}
                                    onChange={e => setFormTitle(e.target.value)}
                                    className="text-xl font-bold text-gray-900 bg-transparent border-none outline-hidden w-full"
                                />
                            ) : (
                                <div>
                                    <h2 className="text-xl font-bold text-gray-900">{selectedPolicy?.title}</h2>
                                    <div className="flex items-center gap-2 mt-1">
                                        <span className={cn("text-xs px-2 py-0.5 rounded-full font-medium", typeConfig[selectedPolicy?.type || 'POLICY'].color)}>
                                            {typeConfig[selectedPolicy?.type || 'POLICY'].label}
                                        </span>
                                        {selectedPolicy?.category && (
                                            <span className="text-xs text-gray-500">• {selectedPolicy.category}</span>
                                        )}
                                    </div>
                                </div>
                            )}

                            <div className="flex items-center gap-2">
                                {isEditing ? (
                                    <>
                                        <button
                                            onClick={() => {
                                                setIsEditing(false);
                                                if (!selectedPolicy) setSelectedPolicy(null);
                                            }}
                                            className="px-3 py-1.5 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                                        >
                                            Cancel
                                        </button>
                                        <button
                                            onClick={handleSave}
                                            className="flex items-center gap-1 px-4 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                                        >
                                            <Save size={16} />
                                            Save
                                        </button>
                                    </>
                                ) : (
                                    <>
                                        <button
                                            onClick={() => selectedPolicy && handleEdit(selectedPolicy)}
                                            className="p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                        >
                                            <Edit2 size={18} />
                                        </button>
                                        <button
                                            onClick={() => selectedPolicy && handleDelete(selectedPolicy.id)}
                                            className="p-2 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                        >
                                            <Trash2 size={18} />
                                        </button>
                                    </>
                                )}
                            </div>
                        </div>

                        {/* Metadata Bar (Edit Mode) */}
                        {isEditing && (
                            <div className="bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-4">
                                <select
                                    value={formType}
                                    onChange={e => setFormType(e.target.value as any)}
                                    className="text-sm border border-gray-300 rounded-lg px-2 py-1"
                                >
                                    <option value="POLICY">Policy</option>
                                    <option value="SOP">SOP</option>
                                    <option value="TRAINING">Training</option>
                                </select>
                                <input
                                    type="text"
                                    placeholder="Category (optional)"
                                    value={formCategory}
                                    onChange={e => setFormCategory(e.target.value)}
                                    className="text-sm border border-gray-300 rounded-lg px-2 py-1 w-40"
                                />
                                <label className="flex items-center gap-2 text-sm text-gray-600">
                                    <input
                                        type="checkbox"
                                        checked={formIsPublished}
                                        onChange={e => setFormIsPublished(e.target.checked)}
                                        className="rounded-sm"
                                    />
                                    Published
                                </label>
                            </div>
                        )}

                        {/* Content */}
                        <div className="flex-1 overflow-y-auto p-6">
                            {isEditing ? (
                                <textarea
                                    placeholder="Write your policy content here... (Markdown supported)"
                                    value={formContent}
                                    onChange={e => setFormContent(e.target.value)}
                                    className="w-full h-full min-h-[400px] p-4 bg-white border border-gray-200 rounded-lg text-sm font-mono resize-none outline-hidden focus:ring-2 focus:ring-blue-500"
                                />
                            ) : (
                                <div className="bg-white rounded-lg border border-gray-200 p-6 prose max-w-none">
                                    {selectedPolicy?.content ? (
                                        <div className="whitespace-pre-wrap">{selectedPolicy.content}</div>
                                    ) : (
                                        <p className="text-gray-400 italic">No content</p>
                                    )}
                                </div>
                            )}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
