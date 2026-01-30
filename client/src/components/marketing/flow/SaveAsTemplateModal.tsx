/**
 * SaveAsTemplateModal - Modal for saving current email as a template
 */
import { useState } from 'react';
import { X, Save, Loader2 } from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import { useAccount } from '../../../context/AccountContext';

interface Props {
    content: string;
    designJson?: any;
    onSaved: (templateId: string) => void;
    onClose: () => void;
}

export function SaveAsTemplateModal({ content, designJson, onSaved, onClose }: Props) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [name, setName] = useState('');
    const [subject, setSubject] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    const handleSave = async () => {
        if (!name.trim()) {
            setError('Please enter a template name');
            return;
        }

        setSaving(true);
        setError('');

        try {
            const res = await fetch('/api/marketing/templates', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                    'x-account-id': currentAccount?.id || ''
                },
                body: JSON.stringify({
                    name: name.trim(),
                    subject: subject.trim() || null,
                    content,
                    designJson
                })
            });

            if (res.ok) {
                const template = await res.json();
                onSaved(template.id);
            } else {
                const data = await res.json();
                setError(data.message || 'Failed to save template');
            }
        } catch (err) {
            setError('Failed to save template');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-xs">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b">
                    <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-green-100">
                            <Save size={18} className="text-green-600" />
                        </div>
                        <div>
                            <h3 className="font-semibold text-gray-900">Save As Template</h3>
                            <p className="text-sm text-gray-500">Save this email for reuse</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                    >
                        <X size={18} className="text-gray-500" />
                    </button>
                </div>

                {/* Content */}
                <div className="p-6 space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Template Name *
                        </label>
                        <input
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="e.g., Order Confirmation"
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Default Subject (Optional)
                        </label>
                        <input
                            type="text"
                            value={subject}
                            onChange={(e) => setSubject(e.target.value)}
                            placeholder="e.g., Your order has been confirmed"
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
                        />
                    </div>

                    {error && (
                        <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
                    )}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-end gap-3 px-6 py-4 border-t bg-gray-50">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800 transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="flex items-center gap-2 px-5 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm font-medium transition-colors disabled:opacity-50"
                    >
                        {saving ? (
                            <Loader2 size={16} className="animate-spin" />
                        ) : (
                            <Save size={16} />
                        )}
                        Save Template
                    </button>
                </div>
            </div>
        </div>
    );
}
