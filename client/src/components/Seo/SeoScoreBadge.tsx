import { Trophy, AlertCircle, CheckCircle } from 'lucide-react';

export interface SeoTest {
    test: string;
    passed: boolean;
    message: string;
}

interface SeoScoreBadgeProps {
    score: number;
    size?: 'sm' | 'md' | 'lg';
    /** Optional SEO test results - when provided, hovering displays fixes needed */
    tests?: SeoTest[];
}

/**
 * Displays an SEO score badge with optional hover tooltip showing test results.
 * When tests are provided, hovering reveals which checks passed/failed.
 */
export function SeoScoreBadge({ score, size = 'md', tests }: SeoScoreBadgeProps) {
    // 0-40 Red, 41-70 Yellow, 71-100 Green
    let color = 'text-red-600 bg-red-50 border-red-200';
    if (score > 40) color = 'text-yellow-600 bg-yellow-50 border-yellow-200';
    if (score > 70) color = 'text-green-600 bg-green-50 border-green-200';

    const sizeClasses = {
        sm: 'text-xs px-2 py-0.5',
        md: 'text-sm px-2.5 py-1',
        lg: 'text-base px-3 py-1.5'
    };

    const failedTests = tests?.filter(t => !t.passed) || [];
    const passedTests = tests?.filter(t => t.passed) || [];
    const hasTooltip = tests && tests.length > 0;

    return (
        <span className={`relative group inline-flex items-center gap-1.5 font-semibold rounded-full border ${color} ${sizeClasses[size]} ${hasTooltip ? 'cursor-help' : ''}`}>
            <Trophy size={size === 'sm' ? 12 : 14} />
            {score}/100

            {/* Hover tooltip for SEO fixes */}
            {hasTooltip && (
                <div className="absolute left-0 top-full mt-2 z-50 hidden group-hover:block w-72 animate-in fade-in zoom-in-95 duration-150">
                    <div className="bg-white rounded-lg shadow-xl border border-gray-200 overflow-hidden">
                        <div className="bg-gray-50 px-3 py-2 border-b border-gray-100">
                            <h4 className="text-xs font-bold text-gray-700 uppercase tracking-wide">SEO Analysis</h4>
                        </div>
                        <div className="p-3 max-h-64 overflow-y-auto space-y-2">
                            {failedTests.length > 0 && (
                                <>
                                    <p className="text-xs font-semibold text-red-600 mb-1 flex items-center gap-1">
                                        <AlertCircle size={12} />
                                        Fixes Needed ({failedTests.length})
                                    </p>
                                    {failedTests.map((t, i) => (
                                        <div key={i} className="text-xs text-red-700 bg-red-50 px-2 py-1.5 rounded border border-red-100">
                                            <span className="font-medium">{t.test}:</span> {t.message}
                                        </div>
                                    ))}
                                </>
                            )}
                            {passedTests.length > 0 && (
                                <>
                                    <p className="text-xs font-semibold text-green-600 mt-2 mb-1 flex items-center gap-1">
                                        <CheckCircle size={12} />
                                        Passed ({passedTests.length})
                                    </p>
                                    {passedTests.map((t, i) => (
                                        <div key={i} className="text-xs text-green-700 bg-green-50 px-2 py-1.5 rounded border border-green-100">
                                            {t.test}
                                        </div>
                                    ))}
                                </>
                            )}
                            {failedTests.length === 0 && passedTests.length === 0 && (
                                <p className="text-xs text-gray-500">No SEO analysis available.</p>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </span>
    );
}
