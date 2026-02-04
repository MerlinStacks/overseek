/**
 * Generated Copy Display
 * 
 * Displays AI-generated ad copy with copy-to-clipboard functionality.
 */
import { Check, Copy, Clipboard, CheckCircle2 } from 'lucide-react';
import { GeneratedCopy } from './adCopyTypes';

interface CopyItemProps {
    text: string;
    itemKey: string;
    copiedItems: Set<string>;
    onCopy: (text: string, key: string) => void;
    isMultiline?: boolean;
}

/**
 * Reusable copy item row with character count and copy button.
 */
function CopyItem({ text, itemKey, copiedItems, onCopy, isMultiline }: CopyItemProps) {
    return (
        <div
            className={`flex ${isMultiline ? 'items-start' : 'items-center'} justify-between p-3 bg-gray-800/50 rounded-lg border border-gray-700 group`}
        >
            <span className={`text-white ${isMultiline ? 'text-sm leading-relaxed' : ''}`}>
                {text}
            </span>
            <div className={`flex items-center gap-2 ${isMultiline ? 'ml-3' : ''} flex-shrink-0`}>
                <span className="text-xs text-gray-500">
                    {text.length} chars
                </span>
                <button
                    onClick={() => onCopy(text, itemKey)}
                    className="p-1.5 text-gray-400 hover:text-white opacity-0 group-hover:opacity-100 transition-all"
                >
                    {copiedItems.has(itemKey) ? (
                        <Check className="w-4 h-4 text-green-400" />
                    ) : (
                        <Copy className="w-4 h-4" />
                    )}
                </button>
            </div>
        </div>
    );
}

interface GeneratedCopyDisplayProps {
    generatedCopy: GeneratedCopy;
    copiedItems: Set<string>;
    onCopy: (text: string, key: string) => void;
    onCopyAll: () => void;
}

/**
 * Displays all generated copy sections (headlines, descriptions, primary texts).
 */
export function GeneratedCopyDisplay({
    generatedCopy,
    copiedItems,
    onCopy,
    onCopyAll
}: GeneratedCopyDisplayProps) {
    return (
        <div className="mt-6 space-y-4">
            {/* Source Badge & Copy All */}
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
                    onClick={onCopyAll}
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
                        <CopyItem
                            key={i}
                            text={headline}
                            itemKey={`h-${i}`}
                            copiedItems={copiedItems}
                            onCopy={onCopy}
                        />
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
                            <CopyItem
                                key={i}
                                text={desc}
                                itemKey={`d-${i}`}
                                copiedItems={copiedItems}
                                onCopy={onCopy}
                                isMultiline
                            />
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
                            <CopyItem
                                key={i}
                                text={text}
                                itemKey={`p-${i}`}
                                copiedItems={copiedItems}
                                onCopy={onCopy}
                                isMultiline
                            />
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
