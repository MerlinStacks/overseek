/**
 * Step 4: Budget & Review
 * 
 * Final step for setting daily budget and reviewing campaign configuration.
 */

import React, { useCallback, useMemo } from 'react';
import { DollarSign, MapPin, Target } from 'lucide-react';
import { WizardStepProps, DEFAULT_BUDGET } from '../types';

/** Budget slider configuration */
const BUDGET_MIN = 5;
const BUDGET_MAX = 200;
const BUDGET_STEP = 5;

/** Average days per month for estimation */
const DAYS_PER_MONTH = 30.4;

export function StepBudgetReview({ draft, setDraft }: WizardStepProps) {

    const estimatedMonthly = useMemo(
        () => Math.round(draft.budget * DAYS_PER_MONTH),
        [draft.budget]
    );

    const updateBudget = useCallback((value: number) => {
        setDraft(d => ({ ...d, budget: value }));
    }, [setDraft]);

    const campaignGoal = draft.type === 'PMAX'
        ? 'Performance Max (Sales)'
        : 'Search (Traffic)';

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-300">
            <div>
                <h3 className="text-2xl font-bold text-gray-900 mb-2">Budget & Review</h3>
                <p className="text-gray-500">
                    Set your daily spend and review your campaign details before launching.
                </p>
            </div>

            <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm space-y-6">
                <div>
                    <label htmlFor="budget-input" className="block text-sm font-bold text-gray-700 mb-4">
                        Daily Budget
                    </label>
                    <div className="flex items-center gap-4">
                        <div className="relative flex-1">
                            <DollarSign className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                            <input
                                id="budget-input"
                                type="number"
                                value={draft.budget}
                                onChange={(e) => updateBudget(parseFloat(e.target.value) || DEFAULT_BUDGET)}
                                min={BUDGET_MIN}
                                max={BUDGET_MAX}
                                className="w-full pl-10 pr-4 py-3 rounded-xl border border-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none text-lg font-semibold"
                            />
                        </div>
                        <div className="text-sm text-gray-500">
                            Est. ${estimatedMonthly} / month
                        </div>
                    </div>
                    <input
                        type="range"
                        min={BUDGET_MIN}
                        max={BUDGET_MAX}
                        step={BUDGET_STEP}
                        value={draft.budget}
                        onChange={(e) => updateBudget(parseFloat(e.target.value))}
                        className="w-full mt-4 h-2 bg-gray-100 rounded-lg appearance-none cursor-pointer accent-blue-600"
                        aria-label="Budget slider"
                    />
                </div>

                <div className="grid grid-cols-2 gap-4 pt-4 border-t border-gray-100">
                    <div className="bg-gray-50 p-4 rounded-xl">
                        <div className="flex items-center gap-2 text-gray-500 mb-1">
                            <Target size={16} />
                            <span className="text-xs font-semibold uppercase tracking-wider">Goal</span>
                        </div>
                        <div className="font-semibold text-gray-900">{campaignGoal}</div>
                    </div>
                    <div className="bg-gray-50 p-4 rounded-xl">
                        <div className="flex items-center gap-2 text-gray-500 mb-1">
                            <MapPin size={16} />
                            <span className="text-xs font-semibold uppercase tracking-wider">Targeting</span>
                        </div>
                        <div className="font-semibold text-gray-900">United States (Default)</div>
                    </div>
                </div>
            </div>

            {/* Campaign Summary */}
            <div className="space-y-3">
                <h4 className="font-bold text-gray-900 text-sm uppercase tracking-wider">Campaign Summary</h4>
                <div className="bg-gray-50 rounded-xl p-4 text-sm space-y-2 text-gray-600">
                    <div className="flex justify-between">
                        <span>Campaign Name:</span>
                        <span className="font-medium text-gray-900">{draft.name || '(Not set)'}</span>
                    </div>
                    <div className="flex justify-between">
                        <span>Products Selected:</span>
                        <span className="font-medium text-gray-900">{draft.selectedProducts.length} items</span>
                    </div>
                    <div className="flex justify-between">
                        <span>Headlines:</span>
                        <span className="font-medium text-gray-900">{draft.adCopy.headlines.length} variations</span>
                    </div>
                    <div className="flex justify-between">
                        <span>Daily Budget:</span>
                        <span className="font-medium text-gray-900">${draft.budget}</span>
                    </div>
                </div>
            </div>
        </div>
    );
}
