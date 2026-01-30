import { useState, useEffect } from 'react';
import { Logger } from '../../utils/logger';
import { X, Lightbulb, Loader2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';

interface AdContextModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSaved?: () => void;
}

/**
 * Modal for providing additional business context to AI ad suggestions.
 * Context is saved per-account and used by the AdOptimizer.
 */
export function AdContextModal({ isOpen, onClose, onSaved }: AdContextModalProps) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [context, setContext] = useState('');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (isOpen && currentAccount) {
            fetchContext();
        }
    }, [isOpen, currentAccount]);

    async function fetchContext() {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch('/api/dashboard/ad-suggestions/context', {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount?.id || ''
                }
            });
            if (res.ok) {
                const data = await res.json();
                setContext(data.context || '');
            }
        } catch (err) {
            Logger.error('Failed to fetch context', { error: err });
        } finally {
            setLoading(false);
        }
    }

    async function handleSave() {
        setSaving(true);
        setError(null);
        try {
            const res = await fetch('/api/dashboard/ad-suggestions/context', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount?.id || ''
                },
                body: JSON.stringify({ context })
            });

            if (res.ok) {
                onSaved?.();
                onClose();
            } else {
                const data = await res.json();
                setError(data.error || 'Failed to save');
            }
        } catch (err) {
            setError('Failed to save context');
        } finally {
            setSaving(false);
        }
    }

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/50 backdrop-blur-sm"
                onClick={onClose}
            />

            {/* Modal */}
            <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b bg-gradient-to-r from-purple-50 to-indigo-50">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-purple-500 rounded-lg">
                            <Lightbulb size={20} className="text-white" />
                        </div>
                        <div>
                            <h2 className="font-semibold text-gray-900">Add Business Context</h2>
                            <p className="text-sm text-gray-500">Help AI give smarter suggestions</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Body */}
                <div className="p-6">
                    {loading ? (
                        <div className="flex justify-center py-8">
                            <Loader2 className="w-8 h-8 animate-spin text-purple-500" />
                        </div>
                    ) : (
                        <>
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                Your Notes & Context
                            </label>
                            <textarea
                                value={context}
                                onChange={(e) => setContext(e.target.value)}
                                placeholder="E.g., We're running a 30% off sale next week on summer products. Focus on our new arrivals. Our best margin is on jewelry..."
                                className="w-full h-40 px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-purple-500 resize-none text-gray-800 placeholder:text-gray-400"
                                maxLength={1000}
                            />
                            <p className="text-xs text-gray-400 mt-2 text-right">
                                {context.length}/1000 characters
                            </p>

                            <div className="mt-4 p-4 bg-purple-50 rounded-lg border border-purple-100">
                                <h4 className="text-sm font-medium text-purple-800 mb-2">💡 Tips for better suggestions</h4>
                                <ul className="text-sm text-purple-700 space-y-1">
                                    <li>• Mention upcoming sales or promotions</li>
                                    <li>• Note seasonal priorities (e.g., "Push winter coats")</li>
                                    <li>• Share margin preferences ("Focus on high-margin items")</li>
                                    <li>• Flag products to avoid ("Don't promote discontinued line")</li>
                                </ul>
                            </div>

                            {error && (
                                <p className="mt-4 text-sm text-red-600">{error}</p>
                            )}
                        </>
                    )}
                </div>

                {/* Footer */}
                <div className="flex justify-end gap-3 px-6 py-4 border-t bg-gray-50">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                        disabled={saving}
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={loading || saving}
                        className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                        {saving && <Loader2 size={16} className="animate-spin" />}
                        Save Context
                    </button>
                </div>
            </div>
        </div>
    );
}
