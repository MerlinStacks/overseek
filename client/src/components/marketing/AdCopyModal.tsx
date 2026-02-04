/**
 * AdCopyModal - AI Ad Copy Generator UI
 * 
 * Modal component for generating ad copy with tone presets
 * and platform selection. Part of AI Co-Pilot v2.
 */

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { Logger } from '../../utils/logger';
import {
    Sparkles,
    X,
    Loader2,
    Wand2,
    AlertCircle
} from 'lucide-react';
import { TonePreset, Platform, GeneratedCopy } from './adCopyTypes';
import { ToneSelection, PlatformSelection } from './AdCopySelections';
import { GeneratedCopyDisplay } from './GeneratedCopyDisplay';

interface AdCopyModalProps {
    isOpen: boolean;
    onClose: () => void;
    productId?: string;
    productName?: string;
    onCopyGenerated?: (copy: GeneratedCopy) => void;
}

export function AdCopyModal({
    isOpen,
    onClose,
    productId,
    productName,
    onCopyGenerated
}: AdCopyModalProps) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [selectedTone, setSelectedTone] = useState<string>('professional');
    const [selectedPlatform, setSelectedPlatform] = useState<string>('google');
    const [generatedCopy, setGeneratedCopy] = useState<GeneratedCopy | null>(null);
    const [copiedItems, setCopiedItems] = useState<Set<string>>(new Set());
    const [tonePresets, setTonePresets] = useState<TonePreset[]>([]);
    const [platforms, setPlatforms] = useState<Platform[]>([]);
    const [isGenerating, setIsGenerating] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const headers = useCallback(() => ({
        'Authorization': `Bearer ${token}`,
        'X-Account-ID': currentAccount?.id || '',
        'Content-Type': 'application/json'
    }), [token, currentAccount?.id]);

    // Fetch tone presets
    useEffect(() => {
        if (!isOpen || !currentAccount) return;

        const fetchPresets = async () => {
            try {
                const res = await fetch('/api/ads/copy/tone-presets', { headers: headers() });
                const data = await res.json();
                setTonePresets(data.data || []);
            } catch (err) {
                Logger.error('Failed to fetch tone presets', { error: err });
            }
        };
        fetchPresets();
    }, [isOpen, currentAccount, headers]);

    // Fetch platforms
    useEffect(() => {
        if (!isOpen || !currentAccount) return;

        const fetchPlatforms = async () => {
            try {
                const res = await fetch('/api/ads/copy/platforms', { headers: headers() });
                const data = await res.json();
                setPlatforms(data.data || []);
            } catch (err) {
                Logger.error('Failed to fetch platforms', { error: err });
            }
        };
        fetchPlatforms();
    }, [isOpen, currentAccount, headers]);

    const handleGenerate = async () => {
        setIsGenerating(true);
        setError(null);

        try {
            const res = await fetch('/api/ads/copy/generate', {
                method: 'POST',
                headers: headers(),
                body: JSON.stringify({
                    productId,
                    productName,
                    tonePreset: selectedTone,
                    platform: selectedPlatform
                })
            });

            if (res.ok) {
                const data = await res.json();
                setGeneratedCopy(data.data);
                onCopyGenerated?.(data.data);
            } else {
                const errData = await res.json();
                setError(errData.error || 'Failed to generate ad copy');
            }
        } catch (err) {
            Logger.error('Failed to generate ad copy', { error: err });
            setError('Failed to generate ad copy. Please try again.');
        } finally {
            setIsGenerating(false);
        }
    };

    const handleCopyToClipboard = useCallback((text: string, key: string) => {
        navigator.clipboard.writeText(text);
        setCopiedItems(prev => new Set(prev).add(key));
        setTimeout(() => {
            setCopiedItems(prev => {
                const next = new Set(prev);
                next.delete(key);
                return next;
            });
        }, 2000);
    }, []);

    const handleCopyAll = useCallback(() => {
        if (!generatedCopy) return;

        const allCopy = [
            '=== Headlines ===',
            ...generatedCopy.headlines,
            '',
            '=== Descriptions ===',
            ...generatedCopy.descriptions,
            ...(generatedCopy.primaryTexts ? [
                '',
                '=== Primary Texts (Meta) ===',
                ...generatedCopy.primaryTexts
            ] : [])
        ].join('\n');

        navigator.clipboard.writeText(allCopy);
        setCopiedItems(prev => new Set(prev).add('all'));
        setTimeout(() => {
            setCopiedItems(prev => {
                const next = new Set(prev);
                next.delete('all');
                return next;
            });
        }, 2000);
    }, [generatedCopy]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="bg-gray-900 rounded-2xl border border-gray-700 shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-gradient-to-br from-violet-500 to-purple-600 rounded-lg">
                            <Sparkles className="w-5 h-5 text-white" />
                        </div>
                        <div>
                            <h2 className="text-lg font-semibold text-white">AI Ad Copy Generator</h2>
                            <p className="text-sm text-gray-400">
                                {productName || 'Generate copy for your store'}
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6">
                    {/* Options */}
                    <div className="grid grid-cols-2 gap-6 mb-6">
                        <ToneSelection
                            tonePresets={tonePresets}
                            selectedTone={selectedTone}
                            onSelect={setSelectedTone}
                        />
                        <PlatformSelection
                            platforms={platforms}
                            selectedPlatform={selectedPlatform}
                            onSelect={setSelectedPlatform}
                        />
                    </div>

                    {/* Generate Button */}
                    <button
                        onClick={handleGenerate}
                        disabled={isGenerating}
                        className="w-full py-3 px-4 bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 disabled:from-gray-600 disabled:to-gray-600 text-white font-medium rounded-xl flex items-center justify-center gap-2 transition-all"
                    >
                        {isGenerating ? (
                            <>
                                <Loader2 className="w-5 h-5 animate-spin" />
                                Generating...
                            </>
                        ) : (
                            <>
                                <Wand2 className="w-5 h-5" />
                                Generate Ad Copy
                            </>
                        )}
                    </button>

                    {/* Error State */}
                    {error && (
                        <div className="mt-4 p-4 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center gap-3 text-red-400">
                            <AlertCircle className="w-5 h-5 flex-shrink-0" />
                            <span>{error}</span>
                        </div>
                    )}

                    {/* Generated Copy Display */}
                    {generatedCopy && (
                        <GeneratedCopyDisplay
                            generatedCopy={generatedCopy}
                            copiedItems={copiedItems}
                            onCopy={handleCopyToClipboard}
                            onCopyAll={handleCopyAll}
                        />
                    )}
                </div>

                {/* Footer */}
                <div className="px-6 py-4 border-t border-gray-700 bg-gray-800/50">
                    <div className="flex items-center justify-between">
                        <p className="text-xs text-gray-500">
                            Powered by AI • Copy may require review before use
                        </p>
                        <button
                            onClick={onClose}
                            className="px-4 py-2 text-gray-300 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
                        >
                            Close
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default AdCopyModal;
