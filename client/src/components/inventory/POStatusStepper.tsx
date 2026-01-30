/**
 * POStatusStepper - Visual progress indicator for Purchase Order workflow
 * 
 * Shows the current status and progression through the PO lifecycle.
 */

import { FileText, ShoppingCart, Truck, CheckCircle2 } from 'lucide-react';

type POStatus = 'DRAFT' | 'ORDERED' | 'RECEIVED' | 'CANCELLED';

interface POStatusStepperProps {
    status: POStatus;
    onStatusChange?: (newStatus: POStatus) => void;
    disabled?: boolean;
}

const STEPS: { key: POStatus; label: string; icon: React.ReactNode }[] = [
    { key: 'DRAFT', label: 'Draft', icon: <FileText size={18} /> },
    { key: 'ORDERED', label: 'Ordered', icon: <ShoppingCart size={18} /> },
    { key: 'RECEIVED', label: 'Received', icon: <CheckCircle2 size={18} /> },
];

const STATUS_ORDER: POStatus[] = ['DRAFT', 'ORDERED', 'RECEIVED'];

export function POStatusStepper({ status, onStatusChange, disabled = false }: POStatusStepperProps) {
    const currentIndex = STATUS_ORDER.indexOf(status);
    const isCancelled = status === 'CANCELLED';

    if (isCancelled) {
        return (
            <div className="flex items-center gap-2 px-4 py-3 bg-red-50 border border-red-200 rounded-lg">
                <span className="text-red-600 font-medium">Order Cancelled</span>
            </div>
        );
    }

    return (
        <div
            className="flex items-center justify-between bg-gray-50 p-4 rounded-xl border border-gray-200"
            role="navigation"
            aria-label="Purchase order status progression"
        >
            {STEPS.map((step, index) => {
                const isCompleted = index < currentIndex;
                const isCurrent = index === currentIndex;
                const isUpcoming = index > currentIndex;
                const isClickable = !disabled && onStatusChange && (index === currentIndex + 1 || index === currentIndex);

                return (
                    <div key={step.key} className="flex items-center flex-1">
                        {/* Step Circle */}
                        <button
                            type="button"
                            disabled={!isClickable}
                            onClick={() => isClickable && onStatusChange?.(step.key)}
                            className={`
                                relative flex items-center justify-center w-10 h-10 rounded-full border-2 transition-all
                                ${isCompleted ? 'bg-green-500 border-green-500 text-white' : ''}
                                ${isCurrent ? 'bg-blue-500 border-blue-500 text-white ring-4 ring-blue-100' : ''}
                                ${isUpcoming ? 'bg-white border-gray-300 text-gray-400' : ''}
                                ${isClickable ? 'cursor-pointer hover:scale-110' : 'cursor-default'}
                            `}
                            title={isClickable ? `Change to ${step.label}` : undefined}
                            aria-label={`${step.label} ${isCurrent ? '(current)' : isCompleted ? '(completed)' : ''}`}
                            aria-current={isCurrent ? 'step' : undefined}
                        >
                            {step.icon}
                        </button>

                        {/* Label */}
                        <div className="ml-3 mr-4">
                            <p className={`text-sm font-medium ${isCurrent ? 'text-gray-900' : isCompleted ? 'text-green-600' : 'text-gray-400'}`}>
                                {step.label}
                            </p>
                            {isCurrent && (
                                <p className="text-xs text-blue-600">Current Status</p>
                            )}
                            {isCompleted && (
                                <p className="text-xs text-green-600">Completed</p>
                            )}
                        </div>

                        {/* Connector Line */}
                        {index < STEPS.length - 1 && (
                            <div className={`flex-1 h-1 rounded-full ${isCompleted ? 'bg-green-400' : 'bg-gray-200'}`} />
                        )}
                    </div>
                );
            })}
        </div>
    );
}
