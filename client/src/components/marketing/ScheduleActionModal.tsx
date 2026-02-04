/**
 * Schedule Action Modal
 * 
 * Allows users to schedule a recommendation action for later execution.
 */

import { useState } from 'react';
import { Clock, Loader2, Calendar, AlertCircle } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { ActionableRecommendation } from '../../types/ActionableTypes';

interface ScheduleActionModalProps {
    isOpen: boolean;
    onClose: () => void;
    recommendation: ActionableRecommendation;
    onScheduled?: () => void;
}

export function ScheduleActionModal({
    isOpen,
    onClose,
    recommendation,
    onScheduled
}: ScheduleActionModalProps) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();

    const [scheduledDate, setScheduledDate] = useState('');
    const [scheduledTime, setScheduledTime] = useState('09:00');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Get minimum date (tomorrow)
    const getMinDate = () => {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        return tomorrow.toISOString().split('T')[0];
    };

    async function handleSchedule() {
        if (!scheduledDate) {
            setError('Please select a date');
            return;
        }

        const action = recommendation.action;
        if (!action) {
            setError('No action available for this recommendation');
            return;
        }

        setSaving(true);
        setError(null);

        try {
            const scheduledFor = new Date(`${scheduledDate}T${scheduledTime}:00`);

            const res = await fetch('/api/ads/schedule-action', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount?.id || ''
                },
                body: JSON.stringify({
                    actionType: action.actionType,
                    platform: recommendation.platform === 'both' ? 'google' : recommendation.platform,
                    campaignId: 'campaignId' in action ? action.campaignId : undefined,
                    campaignName: 'campaignName' in action ? action.campaignName : undefined,
                    parameters: {
                        currentBudget: 'currentBudget' in action ? action.currentBudget : undefined,
                        newBudget: 'suggestedBudget' in action ? action.suggestedBudget : undefined,
                        changeAmount: 'changeAmount' in action ? action.changeAmount : undefined
                    },
                    scheduledFor: scheduledFor.toISOString(),
                    recommendationId: recommendation.id
                })
            });

            if (res.ok) {
                onScheduled?.();
                onClose();
            } else {
                const data = await res.json();
                setError(data.error || 'Failed to schedule action');
            }
        } catch (err) {
            setError('Failed to schedule action');
        } finally {
            setSaving(false);
        }
    }

    const action = recommendation.action;

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-blue-500 rounded-lg">
                        <Clock size={20} className="text-white" />
                    </div>
                    <div>
                        <div className="font-semibold text-gray-900">Schedule Action</div>
                        <p className="text-sm text-gray-500 font-normal">Execute this later</p>
                    </div>
                </div>
            }
            maxWidth="max-w-md"
        >
            <div className="space-y-4">
                {/* Recommendation Summary */}
                <div className="p-3 bg-gray-50 rounded-lg border border-gray-100">
                    <p className="text-sm font-medium text-gray-700">{recommendation.headline}</p>
                    {action && 'suggestedBudget' in action && (
                        <p className="text-xs text-gray-500 mt-1">
                            {action.actionType === 'budget_increase' && `Increase budget to $${action.suggestedBudget}`}
                            {action.actionType === 'budget_decrease' && `Decrease budget to $${action.suggestedBudget}`}
                            {action.actionType === 'pause' && 'Pause campaign'}
                            {action.actionType === 'enable' && 'Enable campaign'}
                        </p>
                    )}
                </div>

                {/* Date Picker */}
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                        <Calendar size={14} className="inline mr-1" />
                        Schedule Date
                    </label>
                    <input
                        type="date"
                        value={scheduledDate}
                        onChange={(e) => setScheduledDate(e.target.value)}
                        min={getMinDate()}
                        className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                </div>

                {/* Time Picker */}
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                        <Clock size={14} className="inline mr-1" />
                        Time
                    </label>
                    <select
                        value={scheduledTime}
                        onChange={(e) => setScheduledTime(e.target.value)}
                        className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    >
                        <option value="00:00">12:00 AM</option>
                        <option value="06:00">6:00 AM</option>
                        <option value="09:00">9:00 AM</option>
                        <option value="12:00">12:00 PM</option>
                        <option value="15:00">3:00 PM</option>
                        <option value="18:00">6:00 PM</option>
                        <option value="21:00">9:00 PM</option>
                    </select>
                </div>

                {/* Info Box */}
                <div className="flex items-start gap-3 p-3 bg-blue-50 rounded-lg border border-blue-100">
                    <AlertCircle size={18} className="text-blue-500 mt-0.5 shrink-0" />
                    <p className="text-xs text-blue-700">
                        Scheduled actions are processed automatically. You can cancel pending actions from the Scheduled Actions page.
                    </p>
                </div>

                {error && (
                    <p className="text-sm text-red-600">{error}</p>
                )}
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-3 pt-4 mt-4 border-t">
                <button
                    onClick={onClose}
                    className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                    disabled={saving}
                >
                    Cancel
                </button>
                <button
                    onClick={handleSchedule}
                    disabled={saving || !scheduledDate}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                    {saving && <Loader2 size={16} className="animate-spin" />}
                    Schedule
                </button>
            </div>
        </Modal>
    );
}
