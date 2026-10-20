/**
 * Ad Copy Selection Options
 * 
 * Tone and platform selection UI for the Ad Copy Generator.
 */
import type { TonePreset, Platform } from './adCopyTypes';

interface ToneSelectionProps {
    tonePresets: TonePreset[];
    selectedTone: string;
    onSelect: (toneId: string) => void;
}

/**
 * Tone/style selection buttons.
 */
export function ToneSelection({ tonePresets, selectedTone, onSelect }: ToneSelectionProps) {
    return (
        <fieldset>
            <legend className="block text-sm font-medium text-gray-300 mb-2">
                Tone & Style
            </legend>
            <div className="space-y-2">
                {tonePresets.map((tone) => (
                    <button
                        type="button" aria-pressed={selectedTone === tone.id}
                        key={tone.id}
                        onClick={() => onSelect(tone.id)}
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
        </fieldset>
    );
}

interface PlatformSelectionProps {
    platforms: Platform[];
    selectedPlatform: string;
    onSelect: (platformId: string) => void;
}

/**
 * Target platform selection buttons.
 */
export function PlatformSelection({ platforms, selectedPlatform, onSelect }: PlatformSelectionProps) {
    return (
        <fieldset>
            <legend className="block text-sm font-medium text-gray-300 mb-2">
                Target Platform
            </legend>
            <div className="space-y-2">
                {platforms.map((platform) => (
                    <button
                        type="button" aria-pressed={selectedPlatform === platform.id}
                        key={platform.id}
                        onClick={() => onSelect(platform.id)}
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
        </fieldset>
    );
}
