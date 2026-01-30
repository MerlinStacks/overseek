/**
 * EmailTemplateSelectorModal - Modal for selecting saved email templates
 */
import { useState, useEffect } from 'react';
import { X, Search, Layout, FileText, Loader2 } from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import { useAccount } from '../../../context/AccountContext';

interface EmailTemplate {
    id: string;
    name: string;
    subject: string | null;
    content: string;
    designJson: any;
    createdAt: string;
    updatedAt: string;
}

interface Props {
    onSelect: (template: EmailTemplate) => void;
    onClose: () => void;
}

export function EmailTemplateSelectorModal({ onSelect, onClose }: Props) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [templates, setTemplates] = useState<EmailTemplate[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');

    useEffect(() => {
        const fetchTemplates = async () => {
            if (!currentAccount) return;
            try {
                const res = await fetch('/api/marketing/templates', {
                    headers: { Authorization: `Bearer ${token}`, 'x-account-id': currentAccount.id }
                });
                if (res.ok) {
                    const data = await res.json();
                    setTemplates(data);
                }
            } catch (err) {
                console.error('Failed to fetch templates:', err);
            } finally {
                setLoading(false);
            }
        };
        fetchTemplates();
    }, [token]);

    const filtered = templates.filter(t =>
        t.name.toLowerCase().includes(search.toLowerCase()) ||
        (t.subject && t.subject.toLowerCase().includes(search.toLowerCase()))
    );

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-xs">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b">
                    <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-indigo-100">
                            <Layout size={18} className="text-indigo-600" />
                        </div>
                        <div>
                            <h3 className="font-semibold text-gray-900">Email Templates</h3>
                            <p className="text-sm text-gray-500">Select a template to use</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                    >
                        <X size={18} className="text-gray-500" />
                    </button>
                </div>

                {/* Search */}
                <div className="px-6 py-3 border-b">
                    <div className="relative">
                        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                        <input
                            type="text"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Search templates..."
                            className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                        />
                    </div>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6">
                    {loading ? (
                        <div className="flex items-center justify-center py-12">
                            <Loader2 size={24} className="animate-spin text-indigo-500" />
                        </div>
                    ) : filtered.length === 0 ? (
                        <div className="text-center py-12">
                            <FileText size={48} className="mx-auto text-gray-300 mb-3" />
                            <p className="text-gray-500">
                                {search ? 'No templates match your search' : 'No templates saved yet'}
                            </p>
                            <p className="text-sm text-gray-400 mt-1">
                                Create an email and save it as a template
                            </p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-2 gap-4">
                            {filtered.map((template) => (
                                <button
                                    key={template.id}
                                    onClick={() => onSelect(template)}
                                    className="p-4 border border-gray-200 rounded-lg hover:border-indigo-300 hover:bg-indigo-50/50 transition-colors text-left group"
                                >
                                    <div className="flex items-start justify-between mb-2">
                                        <div className="p-2 bg-gray-100 rounded group-hover:bg-indigo-100 transition-colors">
                                            <Layout size={16} className="text-gray-600 group-hover:text-indigo-600" />
                                        </div>
                                    </div>
                                    <h4 className="font-medium text-gray-900 truncate">{template.name}</h4>
                                    {template.subject && (
                                        <p className="text-sm text-gray-500 truncate mt-1">{template.subject}</p>
                                    )}
                                    <p className="text-xs text-gray-400 mt-2">
                                        Updated {new Date(template.updatedAt).toLocaleDateString()}
                                    </p>
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="px-6 py-4 border-t bg-gray-50">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800 transition-colors"
                    >
                        Cancel
                    </button>
                </div>
            </div>
        </div>
    );
}
