/**
 * Step 3: Ad Copy Editor
 * 
 * Displays AI-generated ad copy and allows user editing.
 * Validates headline and description lengths per Google Ads specs.
 */

import React, { useEffect, useState, useCallback } from 'react';
import { RefreshCw, Wand2 } from 'lucide-react';
import { Logger } from '../../../../utils/logger';
import {
    WizardStepProps,
    MAX_HEADLINE_LENGTH,
    MAX_DESCRIPTION_LENGTH,
    MIN_HEADLINES,
    MIN_DESCRIPTIONS,
    MAX_HEADLINES,
    MAX_DESCRIPTIONS
} from '../types';

/** Simulated AI generation delay (ms) */
const AI_GENERATION_DELAY = 1200;

/**
 * Generates mock AI ad copy based on selected products.
 * In production, this would call an actual AI service.
 */
function generateMockAdCopy(productName: string) {
    return {
        headlines: [
            `Shop ${productName} Today`,
            'Best Deals of the Season',
            'Free Shipping on All Orders',
            'Premium Quality Guaranteed',
            'Limited Time Offer'
        ],
        descriptions: [
            `Discover our exclusive collection of ${productName}. Unmatched quality and style for the modern lifestyle.`,
            'Upgrade your daily essentials with our premium selection. Shop now and save 20% on your first order.'
        ],
        finalUrl: 'https://example.com/shop'
    };
}

export function StepAdCopy({ draft, setDraft }: WizardStepProps) {
    const [generating, setGenerating] = useState(false);

    const generateCopy = useCallback(async () => {
        setGenerating(true);
        Logger.info('[StepAdCopy] Generating AI ad copy');

        // Simulate AI processing time
        await new Promise(r => setTimeout(r, AI_GENERATION_DELAY));

        const productName = draft.selectedProducts[0]?.name || 'Premium Product';
        const generatedCopy = generateMockAdCopy(productName);

        setDraft(d => ({
            ...d,
            adCopy: generatedCopy
        }));

        setGenerating(false);
        Logger.info('[StepAdCopy] Ad copy generated', { headlineCount: generatedCopy.headlines.length });
    }, [draft.selectedProducts, setDraft]);

    // Auto-generate on first load if empty
    useEffect(() => {
        if (draft.adCopy.headlines.length === 0 && draft.selectedProducts.length > 0) {
            // Defer the async call to avoid cascading renders
            const timeoutId = setTimeout(() => {
                generateCopy();
            }, 0);
            return () => clearTimeout(timeoutId);
        }
    }, [draft.adCopy.headlines.length, draft.selectedProducts.length, generateCopy]);

    const updateHeadline = useCallback((index: number, value: string) => {
        setDraft(d => {
            const newHeadlines = [...d.adCopy.headlines];
            newHeadlines[index] = value;
            return { ...d, adCopy: { ...d.adCopy, headlines: newHeadlines } };
        });
    }, [setDraft]);

    const updateDescription = useCallback((index: number, value: string) => {
        setDraft(d => {
            const newDesc = [...d.adCopy.descriptions];
            newDesc[index] = value;
            return { ...d, adCopy: { ...d.adCopy, descriptions: newDesc } };
        });
    }, [setDraft]);

    const addHeadline = useCallback(() => {
        if (draft.adCopy.headlines.length >= MAX_HEADLINES) return;
        setDraft(d => ({
            ...d,
            adCopy: { ...d.adCopy, headlines: [...d.adCopy.headlines, ''] }
        }));
    }, [draft.adCopy.headlines.length, setDraft]);

    const updateFinalUrl = useCallback((value: string) => {
        setDraft(d => ({ ...d, adCopy: { ...d.adCopy, finalUrl: value } }));
    }, [setDraft]);

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-300">
            <div className="flex justify-between items-start">
                <div>
                    <h3 className="text-2xl font-bold text-gray-900 mb-2">Review Ad Copy</h3>
                    <p className="text-gray-500">
                        AI has generated these assets based on your products. Edit them to fit your brand.
                    </p>
                </div>
                <button
                    onClick={generateCopy}
                    disabled={generating}
                    className="flex items-center gap-2 px-4 py-2 bg-indigo-50 text-indigo-600 rounded-xl hover:bg-indigo-100 transition-colors font-medium text-sm disabled:opacity-50"
                >
                    {generating ? (
                        <RefreshCw className="animate-spin" size={16} />
                    ) : (
                        <Wand2 size={16} />
                    )}
                    Regenerate AI Copy
                </button>
            </div>

            {/* Live Preview */}
            <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm max-w-md mx-auto">
                <div className="text-xs text-green-700 font-bold mb-1">
                    Ad <span className="text-gray-400 font-normal">· example.com/shop</span>
                </div>
                <div className="text-blue-700 text-xl font-medium mb-1 hover:underline cursor-pointer line-clamp-1">
                    {draft.adCopy.headlines[0] || 'Headline 1'} | {draft.adCopy.headlines[1] || 'Headline 2'}
                </div>
                <div className="text-gray-600 text-sm line-clamp-2">
                    {draft.adCopy.descriptions[0] || 'Description text will appear here...'}
                </div>
            </div>

            <div className="space-y-6">
                {/* Headlines */}
                <div>
                    <label className="block text-sm font-bold text-gray-700 mb-3">
                        Headlines{' '}
                        <span className="text-xs font-normal text-gray-400">
                            (Min {MIN_HEADLINES}, Max {MAX_HEADLINES})
                        </span>
                    </label>
                    <div className="space-y-3">
                        {draft.adCopy.headlines.map((headline, idx) => (
                            <div key={`headline-${idx}`} className="relative">
                                <span className="absolute left-3 top-3 text-gray-400 text-xs font-mono">
                                    {idx + 1}
                                </span>
                                <input
                                    type="text"
                                    value={headline}
                                    onChange={(e) => updateHeadline(idx, e.target.value)}
                                    maxLength={MAX_HEADLINE_LENGTH}
                                    className="w-full pl-8 pr-12 py-2 rounded-lg border border-gray-200 focus:border-blue-500 focus:ring-1 focus:ring-blue-100 outline-none text-sm"
                                />
                                <span className={`absolute right-3 top-2.5 text-xs ${headline.length >= MAX_HEADLINE_LENGTH ? 'text-red-500' : 'text-gray-400'
                                    }`}>
                                    {headline.length}/{MAX_HEADLINE_LENGTH}
                                </span>
                            </div>
                        ))}
                        {draft.adCopy.headlines.length < MAX_HEADLINES && (
                            <button
                                onClick={addHeadline}
                                className="text-sm text-blue-600 font-medium hover:underline pl-1"
                            >
                                + Add Headline
                            </button>
                        )}
                    </div>
                </div>

                {/* Descriptions */}
                <div>
                    <label className="block text-sm font-bold text-gray-700 mb-3">
                        Descriptions{' '}
                        <span className="text-xs font-normal text-gray-400">
                            (Min {MIN_DESCRIPTIONS}, Max {MAX_DESCRIPTIONS})
                        </span>
                    </label>
                    <div className="space-y-3">
                        {draft.adCopy.descriptions.map((desc, idx) => (
                            <div key={`desc-${idx}`} className="relative">
                                <span className="absolute left-3 top-3 text-gray-400 text-xs font-mono">
                                    {idx + 1}
                                </span>
                                <textarea
                                    value={desc}
                                    onChange={(e) => updateDescription(idx, e.target.value)}
                                    maxLength={MAX_DESCRIPTION_LENGTH}
                                    rows={2}
                                    className="w-full pl-8 pr-12 py-2 rounded-lg border border-gray-200 focus:border-blue-500 focus:ring-1 focus:ring-blue-100 outline-none text-sm resize-none"
                                />
                                <span className={`absolute right-3 top-2 text-xs ${desc.length >= MAX_DESCRIPTION_LENGTH ? 'text-red-500' : 'text-gray-400'
                                    }`}>
                                    {desc.length}/{MAX_DESCRIPTION_LENGTH}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Final URL */}
                <div>
                    <label className="block text-sm font-bold text-gray-700 mb-2">Final URL</label>
                    <input
                        type="url"
                        value={draft.adCopy.finalUrl}
                        onChange={(e) => updateFinalUrl(e.target.value)}
                        placeholder="https://example.com/product-page"
                        className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:border-blue-500 focus:ring-1 focus:ring-blue-100 outline-none text-sm"
                    />
                </div>
            </div>
        </div>
    );
}
