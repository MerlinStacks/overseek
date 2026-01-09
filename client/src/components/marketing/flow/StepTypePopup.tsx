/**
 * StepTypePopup - Compact popup for selecting step types when clicking "+" button.
 * Shows Action, Delay, Condition, Goal, Jump, Exit options.
 */
import * as React from 'react';
import { X, Zap, Clock, GitBranch, Target, ArrowUpDown, LogOut } from 'lucide-react';

export type StepType = 'action' | 'delay' | 'condition' | 'goal' | 'jump' | 'exit';

interface StepOption {
    id: StepType;
    label: string;
    icon: React.ReactNode;
    color: string;
}

const STEP_OPTIONS: StepOption[] = [
    { id: 'action', label: 'Action', icon: <Zap size={16} />, color: 'text-yellow-600' },
    { id: 'delay', label: 'Delay', icon: <Clock size={16} />, color: 'text-green-600' },
    { id: 'condition', label: 'Condition', icon: <GitBranch size={16} />, color: 'text-purple-600' },
    { id: 'goal', label: 'Goal', icon: <Target size={16} />, color: 'text-green-600' },
    { id: 'jump', label: 'Jump', icon: <ArrowUpDown size={16} />, color: 'text-red-600' },
    { id: 'exit', label: 'Exit', icon: <LogOut size={16} />, color: 'text-blue-600' },
];

interface StepTypePopupProps {
    isOpen: boolean;
    position: { x: number; y: number };
    onClose: () => void;
    onSelect: (stepType: StepType) => void;
}

export const StepTypePopup: React.FC<StepTypePopupProps> = ({
    isOpen,
    position,
    onClose,
    onSelect,
}) => {
    if (!isOpen) return null;

    return (
        <>
            {/* Backdrop */}
            <div
                className="fixed inset-0 z-40"
                onClick={onClose}
            />

            {/* Popup */}
            <div
                className="fixed z-50 bg-white rounded-xl shadow-xl border border-gray-200 p-4 animate-in fade-in zoom-in-95 duration-150"
                style={{
                    left: position.x,
                    top: position.y,
                    transform: 'translate(-50%, 8px)',
                }}
            >
                {/* Header */}
                <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-gray-900">Add Step</h3>
                    <button
                        onClick={onClose}
                        className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-sm transition-colors"
                    >
                        <X size={14} />
                    </button>
                </div>

                {/* Step Options Grid */}
                <div className="grid grid-cols-2 gap-2">
                    {STEP_OPTIONS.map((option) => (
                        <button
                            key={option.id}
                            onClick={() => {
                                onSelect(option.id);
                                onClose();
                            }}
                            className="flex items-center gap-2 px-3 py-2.5 text-sm text-gray-700 bg-gray-50 border border-gray-200 rounded-lg hover:bg-gray-100 hover:border-gray-300 transition-all"
                        >
                            <span className={option.color}>{option.icon}</span>
                            <span className="font-medium">{option.label}</span>
                        </button>
                    ))}
                </div>
            </div>
        </>
    );
};
