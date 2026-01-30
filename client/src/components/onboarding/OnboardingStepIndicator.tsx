/**
 * Onboarding Step Indicator
 * 
 * Vertical progress tracker for the account setup wizard.
 * Shows completed, active, skipped, and pending steps.
 */

import React from 'react';
import { Check, SkipForward } from 'lucide-react';
import { STEP_CONFIG } from './types';

interface OnboardingStepIndicatorProps {
    currentStep: number;
    completedSteps: number[];
    skippedSteps: number[];
}

/**
 * Displays vertical step progress indicator.
 * Shows icons, labels, connector lines, and status badges.
 */
export function OnboardingStepIndicator({
    currentStep,
    completedSteps,
    skippedSteps
}: OnboardingStepIndicatorProps) {
    return (
        <div className="space-y-6">
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4">
                Setup Progress
            </h3>
            <div className="space-y-3">
                {STEP_CONFIG.map((step, index) => {
                    const isActive = step.id === currentStep;
                    const isCompleted = completedSteps.includes(step.id);
                    const isSkipped = skippedSteps.includes(step.id);
                    const isLast = index === STEP_CONFIG.length - 1;
                    const Icon = step.icon;

                    return (
                        <div key={step.id} className="relative flex items-start gap-4 group">
                            {/* Connector Line */}
                            {!isLast && (
                                <div
                                    className={`absolute left-[19px] top-10 w-0.5 h-8 -ml-px transition-colors ${isCompleted ? 'bg-green-500' :
                                            isSkipped ? 'bg-amber-400' :
                                                'bg-gray-200'
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
                                            : isSkipped
                                                ? 'bg-amber-100 text-amber-600'
                                                : 'bg-white border border-gray-200 text-gray-400'
                                    }`}
                                aria-current={isActive ? 'step' : undefined}
                            >
                                {isCompleted ? (
                                    <Check size={18} />
                                ) : isSkipped ? (
                                    <SkipForward size={16} />
                                ) : (
                                    <Icon size={isActive ? 20 : 18} />
                                )}
                            </div>

                            {/* Step Label & Description */}
                            <div className="flex flex-col pt-1">
                                <span
                                    className={`text-sm font-semibold transition-colors ${isActive || isCompleted ? 'text-gray-900' :
                                            isSkipped ? 'text-amber-700' :
                                                'text-gray-400'
                                        }`}
                                >
                                    {step.label}
                                </span>
                                {isActive && (
                                    <span className="text-xs text-blue-600 font-medium animate-pulse">
                                        In Progress
                                    </span>
                                )}
                                {isCompleted && !isActive && (
                                    <span className="text-xs text-green-600 font-medium">
                                        Completed
                                    </span>
                                )}
                                {isSkipped && !isActive && (
                                    <span className="text-xs text-amber-600 font-medium">
                                        Skipped
                                    </span>
                                )}
                                {!isActive && !isCompleted && !isSkipped && (
                                    <span className="text-xs text-gray-400">
                                        {step.description}
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
