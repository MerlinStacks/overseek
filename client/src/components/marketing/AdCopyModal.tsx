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
    Clipboard,
    Check,
    X,
    Loader2,
    Wand2,
    Copy,
    CheckCircle2,
    AlertCircle
} from 'lucide-react';

// =============================================================================
// TYPES
// =============================================================================

interface TonePreset {
    id: string;
    name: string;
    description: string;
}

interface Platform {
    id: string;
    name: string;
    limits?: {
        headline?: number;
        description?: number;
        primaryText?: number;
    };
}

interface GeneratedCopy {
    headlines: string[];
    descriptions: string[];
    primaryTexts?: string[];
    source: 'ai' | 'template';
    platform?: string;
    notes?: string[];
}

interface AdCopyModalProps {
    isOpen: boolean;
    onClose: () => void;
    productId?: string;
    productName?: string;
    onCopyGenerated?: (copy: GeneratedCopy) => void;
}

// =============================================================================
// COMPONENT
// =============================================================================

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
                        {/* Tone Selection */}
                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-2">
                                Tone & Style
                            </label>
                            <div className="space-y-2">
                                {tonePresets.map((tone: TonePreset) => (
                                    <button
                                        key={tone.id}
                                        onClick={() => setSelectedTone(tone.id)}
                                        className={`w-full p-3 rounded-lg border text-left transition-all ${selectedTone === tone.id
                                            ? 'border-violet-500 bg-violet-500/10 text-white'
                                            : 'border-gray-700 bg-gray-800/50 text-gray-300 hover:border-gray-600'
                                            }`}
                                    >
                                        <div className="font-medium">{tone.name}</div>
                                        <div className="text-xs text-gray-500 mt-0.5">
                                            {tone.description}
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Platform Selection */}
                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-2">
                                Target Platform
                            </label>
                            <div className="space-y-2">
                                {platforms.map((platform: Platform) => (
                                    <button
                                        key={platform.id}
                                        onClick={() => setSelectedPlatform(platform.id)}
                                        className={`w-full p-3 rounded-lg border text-left transition-all ${selectedPlatform === platform.id
                                            ? 'border-emerald-500 bg-emerald-500/10 text-white'
                                            : 'border-gray-700 bg-gray-800/50 text-gray-300 hover:border-gray-600'
                                            }`}
                                    >
                                        <div className="font-medium">{platform.name}</div>
                                        {platform.limits && (
                                            <div className="text-xs text-gray-500 mt-0.5">
                                                {platform.limits.headline && `Headlines: ${platform.limits.headline} chars`}
                                                {platform.limits.description && ` • Descriptions: ${platform.limits.description} chars`}
                                            </div>
                                        )}
                                    </button>
                                ))}
                            </div>
                        </div>
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
                        <div className="mt-6 space-y-4">
                            {/* Source Badge */}
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <span className={`px-2 py-1 text-xs font-medium rounded-full ${generatedCopy.source === 'ai'
                                        ? 'bg-violet-500/20 text-violet-400'
                                        : 'bg-gray-600/20 text-gray-400'
                                        }`}>
                                        {generatedCopy.source === 'ai' ? 'AI Generated' : 'Template'}
                                    </span>
                                    {generatedCopy.notes?.map((note, i) => (
                                        <span key={i} className="text-xs text-gray-500">{note}</span>
                                    ))}
                                </div>
                                <button
                                    onClick={handleCopyAll}
                                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-300 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
                                >
                                    {copiedItems.has('all') ? (
                                        <CheckCircle2 className="w-4 h-4 text-green-400" />
                                    ) : (
                                        <Clipboard className="w-4 h-4" />
                                    )}
                                    Copy All
                                </button>
                            </div>

                            {/* Headlines */}
                            <div>
                                <h3 className="text-sm font-medium text-gray-300 mb-2">
                                    Headlines ({generatedCopy.headlines.length})
                                </h3>
                                <div className="space-y-2">
                                    {generatedCopy.headlines.map((headline, i) => (
                                        <div
                                            key={i}
                                            className="flex items-center justify-between p-3 bg-gray-800/50 rounded-lg border border-gray-700 group"
                                        >
                                            <span className="text-white">{headline}</span>
                                            <div className="flex items-center gap-2">
                                                <span className="text-xs text-gray-500">
                                                    {headline.length} chars
                                                </span>
                                                <button
                                                    onClick={() => handleCopyToClipboard(headline, `h-${i}`)}
                                                    className="p-1.5 text-gray-400 hover:text-white opacity-0 group-hover:opacity-100 transition-all"
                                                >
                                                    {copiedItems.has(`h-${i}`) ? (
                                                        <Check className="w-4 h-4 text-green-400" />
                                                    ) : (
                                                        <Copy className="w-4 h-4" />
                                                    )}
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Descriptions */}
                            {generatedCopy.descriptions.length > 0 && (
                                <div>
                                    <h3 className="text-sm font-medium text-gray-300 mb-2">
                                        Descriptions ({generatedCopy.descriptions.length})
                                    </h3>
                                    <div className="space-y-2">
                                        {generatedCopy.descriptions.map((desc, i) => (
                                            <div
                                                key={i}
                                                className="flex items-start justify-between p-3 bg-gray-800/50 rounded-lg border border-gray-700 group"
                                            >
                                                <span className="text-white text-sm leading-relaxed">{desc}</span>
                                                <div className="flex items-center gap-2 ml-3 flex-shrink-0">
                                                    <span className="text-xs text-gray-500">
                                                        {desc.length} chars
                                                    </span>
                                                    <button
                                                        onClick={() => handleCopyToClipboard(desc, `d-${i}`)}
                                                        className="p-1.5 text-gray-400 hover:text-white opacity-0 group-hover:opacity-100 transition-all"
                                                    >
                                                        {copiedItems.has(`d-${i}`) ? (
                                                            <Check className="w-4 h-4 text-green-400" />
                                                        ) : (
                                                            <Copy className="w-4 h-4" />
                                                        )}
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Primary Texts (Meta) */}
                            {generatedCopy.primaryTexts && generatedCopy.primaryTexts.length > 0 && (
                                <div>
                                    <h3 className="text-sm font-medium text-gray-300 mb-2">
                                        Primary Texts - Meta ({generatedCopy.primaryTexts.length})
                                    </h3>
                                    <div className="space-y-2">
                                        {generatedCopy.primaryTexts.map((text, i) => (
                                            <div
                                                key={i}
                                                className="flex items-start justify-between p-3 bg-gray-800/50 rounded-lg border border-gray-700 group"
                                            >
                                                <span className="text-white text-sm leading-relaxed">{text}</span>
                                                <div className="flex items-center gap-2 ml-3 flex-shrink-0">
                                                    <span className="text-xs text-gray-500">
                                                        {text.length} chars
                                                    </span>
                                                    <button
                                                        onClick={() => handleCopyToClipboard(text, `p-${i}`)}
                                                        className="p-1.5 text-gray-400 hover:text-white opacity-0 group-hover:opacity-100 transition-all"
                                                    >
                                                        {copiedItems.has(`p-${i}`) ? (
                                                            <Check className="w-4 h-4 text-green-400" />
                                                        ) : (
                                                            <Copy className="w-4 h-4" />
                                                        )}
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
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
