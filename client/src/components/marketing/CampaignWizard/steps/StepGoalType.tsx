/**
 * Step 1: Goal & Type Selection
 * 
 * Allows users to choose between Search and Performance Max campaign types.
 */

import React, { useCallback } from 'react';
import { MousePointerClick, ShoppingCart } from 'lucide-react';
import { WizardStepProps, CampaignType } from '../types';

export function StepGoalType({ draft, setDraft }: WizardStepProps) {

    const selectType = useCallback((type: CampaignType, defaultName: string) => {
        setDraft(d => ({
            ...d,
            type,
            name: d.name || defaultName
        }));
    }, [setDraft]);

    const updateName = useCallback((name: string) => {
        setDraft(d => ({ ...d, name }));
    }, [setDraft]);

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-300">
            <div>
                <h3 className="text-2xl font-bold text-gray-900 mb-2">What is your campaign goal?</h3>
                <p className="text-gray-500">We'll optimize your campaign settings based on your objective.</p>
            </div>

            <div className="grid md:grid-cols-2 gap-4">
                <button
                    onClick={() => selectType('PMAX', 'Performance Max - Sales')}
                    className={`p-6 rounded-2xl border-2 text-left transition-all ${draft.type === 'PMAX'
                            ? 'border-blue-500 bg-blue-50/50 ring-2 ring-blue-100'
                            : 'border-gray-100 bg-white hover:border-gray-200 hover:bg-gray-50'
                        }`}
                >
                    <div className="w-12 h-12 bg-purple-100 text-purple-600 rounded-xl flex items-center justify-center mb-4">
                        <ShoppingCart size={24} />
                    </div>
                    <h4 className="text-lg font-bold text-gray-900 mb-2">Drive Sales (Shoppers)</h4>
                    <p className="text-sm text-gray-500 leading-relaxed">
                        Maximize conversions across Google Search, Shopping, YouTube, and Display using Performance Max.
                    </p>
                </button>

                <button
                    onClick={() => selectType('SEARCH', 'Search Traffic')}
                    className={`p-6 rounded-2xl border-2 text-left transition-all ${draft.type === 'SEARCH'
                            ? 'border-blue-500 bg-blue-50/50 ring-2 ring-blue-100'
                            : 'border-gray-100 bg-white hover:border-gray-200 hover:bg-gray-50'
                        }`}
                >
                    <div className="w-12 h-12 bg-blue-100 text-blue-600 rounded-xl flex items-center justify-center mb-4">
                        <MousePointerClick size={24} />
                    </div>
                    <h4 className="text-lg font-bold text-gray-900 mb-2">Drive Traffic (Clicks)</h4>
                    <p className="text-sm text-gray-500 leading-relaxed">
                        Target high-intent users searching for specific keywords on Google Search.
                    </p>
                </button>
            </div>

            <div className="space-y-4">
                <label htmlFor="campaign-name" className="block text-sm font-medium text-gray-700">
                    Campaign Name
                </label>
                <input
                    id="campaign-name"
                    type="text"
                    value={draft.name}
                    onChange={(e) => updateName(e.target.value)}
                    placeholder="e.g., Summer Sale 2024"
                    className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none transition-all"
                />
            </div>
        </div>
    );
}
