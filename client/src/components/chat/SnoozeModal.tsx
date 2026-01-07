import { useState } from 'react';
import { Clock, X } from 'lucide-react';
import { cn } from '../../utils/cn';

interface SnoozeModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSnooze: (snoozeUntil: Date) => Promise<void>;
}

interface SnoozeOption {
    label: string;
    minutes: number;
    description: string;
}

const SNOOZE_OPTIONS: SnoozeOption[] = [
    { label: '10 minutes', minutes: 10, description: 'Quick follow-up' },
    { label: '30 minutes', minutes: 30, description: 'Short delay' },
    { label: '1 hour', minutes: 60, description: 'Extended delay' },
    { label: '24 hours', minutes: 1440, description: 'Next day follow-up' },
];

/**
 * Modal component for selecting snooze duration.
 * Provides predefined time options for snoozing a conversation.
 */
export function SnoozeModal({ isOpen, onClose, onSnooze }: SnoozeModalProps) {
    const [isSnoozing, setIsSnoozing] = useState(false);

    if (!isOpen) return null;

    const handleSnooze = async (minutes: number) => {
        setIsSnoozing(true);
        try {
            const snoozeUntil = new Date(Date.now() + minutes * 60 * 1000);
            await onSnooze(snoozeUntil);
            onClose();
        } finally {
            setIsSnoozing(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/50 backdrop-blur-sm"
                onClick={onClose}
            />

            {/* Modal */}
            <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
                    <div className="flex items-center gap-2">
                        <Clock size={18} className="text-blue-600" />
                        <h3 className="font-semibold text-gray-900">Snooze Conversation</h3>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-1 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* Options */}
                <div className="p-3">
                    <p className="text-sm text-gray-500 mb-3 px-2">
                        Select how long to snooze this conversation:
                    </p>
                    <div className="space-y-1">
                        {SNOOZE_OPTIONS.map((option) => (
                            <button
                                key={option.minutes}
                                onClick={() => handleSnooze(option.minutes)}
                                disabled={isSnoozing}
                                className={cn(
                                    "w-full flex items-center justify-between px-4 py-3 rounded-lg transition-colors",
                                    "hover:bg-blue-50 text-left",
                                    isSnoozing && "opacity-50 cursor-not-allowed"
                                )}
                            >
                                <div>
                                    <div className="font-medium text-gray-900">{option.label}</div>
                                    <div className="text-xs text-gray-500">{option.description}</div>
                                </div>
                                <Clock size={16} className="text-gray-400" />
                            </button>
                        ))}
                    </div>
                </div>

                {/* Footer */}
                <div className="px-5 py-3 bg-gray-50 border-t border-gray-100">
                    <button
                        onClick={onClose}
                        className="w-full px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors"
                    >
                        Cancel
                    </button>
                </div>
            </div>
        </div>
    );
}
