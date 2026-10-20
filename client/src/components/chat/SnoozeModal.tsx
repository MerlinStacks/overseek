import { useEffect, useRef, useState } from 'react';
import { Clock } from 'lucide-react';
import { Modal } from '../ui/Modal';
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
export function SnoozeModal(props: SnoozeModalProps) {
    return props.isOpen ? <SnoozeModalContent {...props} /> : null;
}

function SnoozeModalContent({ isOpen, onClose, onSnooze }: SnoozeModalProps) {
    const [isSnoozing, setIsSnoozing] = useState(false);
    const [error, setError] = useState(false);
    const active = useRef(true);
    const pending = useRef(false);
    useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);

    const handleSnooze = async (minutes: number) => {
        if (pending.current) return;
        pending.current = true;
        setError(false);
        setIsSnoozing(true);
        try {
            // eslint-disable-next-line react-hooks/purity -- Calculated only in the click handler, never during rendering.
            const snoozeUntil = new Date(Date.now() + minutes * 60 * 1000);
            await onSnooze(snoozeUntil);
            if (active.current) onClose();
        } catch {
            if (active.current) setError(true);
        } finally {
            pending.current = false;
            if (active.current) setIsSnoozing(false);
        }
    };

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={
                <div className="flex items-center gap-2">
                    <Clock size={18} className="text-blue-600" />
                    <span>Snooze Conversation</span>
                </div>
            }
            maxWidth="max-w-sm"
        >
            <div className="space-y-3">
                {error && <p role="alert" className="text-red-700 dark:text-red-300">Could not snooze this conversation. Please try again.</p>}
                <p className="text-sm text-gray-500">
                    Select how long to snooze this conversation:
                </p>
                <div className="space-y-1">
                    {SNOOZE_OPTIONS.map((option) => (
                        <button
                            type="button"
                            key={option.minutes}
                            onClick={() => handleSnooze(option.minutes)}
                            disabled={isSnoozing}
                            className={cn(
                                "w-full flex items-center justify-between px-4 py-3 rounded-lg transition-colors",
                                "hover:bg-blue-50 dark:hover:bg-slate-700 text-left",
                                isSnoozing && "opacity-50 cursor-not-allowed"
                            )}
                        >
                            <div>
                                <div className="font-medium text-gray-900 dark:text-slate-100">{option.label}</div>
                                <div className="text-xs text-gray-500">{option.description}</div>
                            </div>
                            <Clock size={16} className="text-gray-400" />
                        </button>
                    ))}
                </div>
                <button
                    type="button"
                    onClick={onClose}
                    className="w-full px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors border-t border-gray-100 pt-3 mt-2"
                >
                    Cancel
                </button>
            </div>
        </Modal>
    );
}
