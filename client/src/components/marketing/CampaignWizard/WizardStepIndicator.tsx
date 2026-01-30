/**
 * Wizard Step Indicator
 * 
 * Visual progress tracker for the campaign creation wizard.
 * Shows completed, active, and pending steps.
 */

import React from 'react';
import { LayoutGrid, ShoppingBag, Type, Banknote, LucideIcon } from 'lucide-react';
import { WIZARD_STEPS } from './types';

interface WizardStepIndicatorProps {
    currentStep: number;
}

interface StepConfig {
    id: number;
    label: string;
    icon: LucideIcon;
}

/** Step configuration with icons and labels */
const STEPS: StepConfig[] = [
    { id: WIZARD_STEPS.GOAL, label: 'Goal & Type', icon: LayoutGrid },
    { id: WIZARD_STEPS.PRODUCTS, label: 'Products', icon: ShoppingBag },
    { id: WIZARD_STEPS.AD_COPY, label: 'Ad Copy', icon: Type },
    { id: WIZARD_STEPS.BUDGET, label: 'Budget & Review', icon: Banknote },
];

/**
 * Displays vertical step progress indicator.
 * Shows icons, labels, and connector lines between steps.
 */
export function WizardStepIndicator({ currentStep }: WizardStepIndicatorProps) {
    return (
        <div className="space-y-6">
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4">
                Setup Progress
            </h3>
            <div className="space-y-4">
                {STEPS.map((step, index) => {
                    const isActive = step.id === currentStep;
                    const isCompleted = step.id < currentStep;
                    const isLast = index === STEPS.length - 1;
                    const Icon = step.icon;

                    return (
                        <div key={step.id} className="relative flex items-center gap-4 group">
                            {/* Connector Line */}
                            {!isLast && (
                                <div
                                    className={`absolute left-[19px] top-10 w-0.5 h-10 -ml-px transition-colors ${isCompleted ? 'bg-green-500' : 'bg-gray-200'
                                        }`}
                                    aria-hidden="true"
                                />
                            )}

                            {/* Step Icon */}
                            <div
                                className={`relative z-10 flex items-center justify-center w-10 h-10 rounded-xl transition-all duration-300 ${isActive
                                        ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/30 scale-110'
                                        : isCompleted
                                            ? 'bg-green-100 text-green-600'
                                            : 'bg-white border border-gray-200 text-gray-400'
                                    }`}
                                aria-current={isActive ? 'step' : undefined}
                            >
                                <Icon size={isActive ? 20 : 18} />
                            </div>

                            {/* Step Label */}
                            <div className="flex flex-col">
                                <span
                                    className={`text-sm font-semibold transition-colors ${isActive || isCompleted ? 'text-gray-900' : 'text-gray-400'
                                        }`}
                                >
                                    {step.label}
                                </span>
                                {isActive && (
                                    <span className="text-xs text-blue-600 font-medium animate-pulse">
                                        In Progress
                                    </span>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
