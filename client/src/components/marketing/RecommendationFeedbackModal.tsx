/**
 * Recommendation Feedback Modal
 * 
 * Allows users to provide context/feedback on why they're dismissing
 * or how they want the AI to adjust future recommendations.
 */

import { useState } from 'react';
import { X, MessageSquarePlus, Loader2, AlertTriangle } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { ActionableRecommendation } from '../../types/ActionableTypes';

interface RecommendationFeedbackModalProps {
    isOpen: boolean;
    onClose: () => void;
    recommendation: ActionableRecommendation;
    action: 'dismiss' | 'feedback';
    onSubmitted?: () => void;
}

const DISMISS_REASONS = [
    { value: 'already_done', label: 'Already done' },
    { value: 'not_relevant', label: 'Not relevant to my business' },
    { value: 'disagree', label: 'I disagree with this suggestion' },
    { value: 'will_do_later', label: 'Will do later' },
    { value: 'other', label: 'Other reason' }
];

export function RecommendationFeedbackModal({
    isOpen,
    onClose,
    recommendation,
    action,
    onSubmitted
}: RecommendationFeedbackModalProps) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();

    const [dismissReason, setDismissReason] = useState('');
    const [feedback, setFeedback] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function handleSubmit() {
        if (action === 'dismiss' && !dismissReason) {
            setError('Please select a reason');
            return;
        }

        setSaving(true);
        setError(null);

        try {
            const res = await fetch('/api/dashboard/ad-suggestions/feedback', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount?.id || ''
                },
                body: JSON.stringify({
                    recommendationId: recommendation.id,
                    action,
                    dismissReason: action === 'dismiss' ? dismissReason : undefined,
                    userFeedback: feedback,
                    recommendation: {
                        headline: recommendation.headline,
                        category: recommendation.category,
                        platform: recommendation.platform,
                        source: recommendation.source,
                        tags: recommendation.tags
                    }
                })
            });

            if (res.ok) {
                onSubmitted?.();
                onClose();
            } else {
                const data = await res.json();
                setError(data.error || 'Failed to save feedback');
            }
        } catch (err) {
            setError('Failed to save feedback');
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
            <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b bg-gradient-to-r from-amber-50 to-orange-50">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-amber-500 rounded-lg">
                            <MessageSquarePlus size={20} className="text-white" />
                        </div>
                        <div>
                            <h2 className="font-semibold text-gray-900">
                                {action === 'dismiss' ? 'Why not this suggestion?' : 'Add Feedback'}
                            </h2>
                            <p className="text-sm text-gray-500">Help the AI learn your preferences</p>
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
                <div className="p-6 space-y-4">
                    {/* Recommendation Summary */}
                    <div className="p-3 bg-gray-50 rounded-lg border border-gray-100">
                        <p className="text-sm text-gray-600 line-clamp-2">{recommendation.headline}</p>
                    </div>

                    {/* Dismiss Reason */}
                    {action === 'dismiss' && (
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                Reason <span className="text-red-500">*</span>
                            </label>
                            <div className="space-y-2">
                                {DISMISS_REASONS.map(reason => (
                                    <label
                                        key={reason.value}
                                        className={`flex items-center gap-2 p-3 border rounded-lg cursor-pointer transition-colors ${dismissReason === reason.value
                                                ? 'border-amber-500 bg-amber-50'
                                                : 'border-gray-200 hover:bg-gray-50'
                                            }`}
                                    >
                                        <input
                                            type="radio"
                                            name="dismissReason"
                                            value={reason.value}
                                            checked={dismissReason === reason.value}
                                            onChange={(e) => setDismissReason(e.target.value)}
                                            className="text-amber-500 focus:ring-amber-500"
                                        />
                                        <span className="text-sm text-gray-700">{reason.label}</span>
                                    </label>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Feedback Text */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            Additional Context <span className="text-gray-400">(optional)</span>
                        </label>
                        <textarea
                            value={feedback}
                            onChange={(e) => setFeedback(e.target.value)}
                            placeholder="E.g., 'We already have a campaign for this product running on Meta' or 'This product is being discontinued, don't suggest it again'"
                            className="w-full h-24 px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-amber-500 focus:border-amber-500 resize-none text-gray-800 placeholder:text-gray-400 text-sm"
                            maxLength={500}
                        />
                        <p className="text-xs text-gray-400 mt-1 text-right">{feedback.length}/500</p>
                    </div>

                    {/* Info Box */}
                    <div className="flex items-start gap-3 p-3 bg-blue-50 rounded-lg border border-blue-100">
                        <AlertTriangle size={18} className="text-blue-500 mt-0.5 shrink-0" />
                        <p className="text-xs text-blue-700">
                            Your feedback helps the AI learn your preferences. Similar suggestions will be adjusted in future analyses.
                        </p>
                    </div>

                    {error && (
                        <p className="text-sm text-red-600">{error}</p>
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
                        onClick={handleSubmit}
                        disabled={saving}
                        className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                        {saving && <Loader2 size={16} className="animate-spin" />}
                        {action === 'dismiss' ? 'Dismiss & Save Feedback' : 'Save Feedback'}
                    </button>
                </div>
            </div>
        </div>
    );
}
