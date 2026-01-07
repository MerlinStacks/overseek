import { ShoppingBag, AlertTriangle, CheckCircle } from 'lucide-react';

export interface MerchantCenterIssue {
    severity: 'error' | 'warning';
    message: string;
    attribute?: string;
}

interface MerchantCenterScoreBadgeProps {
    score: number;
    size?: 'sm' | 'md' | 'lg';
    /** Optional MC issues - when provided, hovering displays fixes needed */
    issues?: MerchantCenterIssue[];
}

/**
 * Displays a Merchant Center score badge with optional hover tooltip showing issues.
 * When issues are provided, hovering reveals errors and warnings.
 */
export function MerchantCenterScoreBadge({ score, size = 'md', issues }: MerchantCenterScoreBadgeProps) {
    // 0-40 Red, 41-70 Yellow, 71-100 Green
    let color = 'text-red-600 bg-red-50 border-red-200';
    if (score > 40) color = 'text-yellow-600 bg-yellow-50 border-yellow-200';
    if (score > 70) color = 'text-green-600 bg-green-50 border-green-200';

    const sizeClasses = {
        sm: 'text-xs px-2 py-0.5',
        md: 'text-sm px-2.5 py-1',
        lg: 'text-base px-3 py-1.5'
    };

    const criticalIssues = issues?.filter(i => i.severity === 'error') || [];
    const warnings = issues?.filter(i => i.severity === 'warning') || [];
    const hasTooltip = issues !== undefined; // Show tooltip even if empty (to show "All good")
    const isCompliant = criticalIssues.length === 0 && warnings.length === 0;

    return (
        <span className={`relative group inline-flex items-center gap-1.5 font-semibold rounded-full border ${color} ${sizeClasses[size]} ${hasTooltip ? 'cursor-help' : ''}`}>
            <ShoppingBag size={size === 'sm' ? 12 : 14} />
            MC: {score}/100

            {/* Hover tooltip for Merchant Center fixes */}
            {hasTooltip && (
                <div className="absolute left-0 top-full mt-2 z-50 hidden group-hover:block w-72 animate-in fade-in zoom-in-95 duration-150">
                    <div className="bg-white rounded-lg shadow-xl border border-gray-200 overflow-hidden">
                        <div className="bg-gray-50 px-3 py-2 border-b border-gray-100 flex justify-between items-center">
                            <h4 className="text-xs font-bold text-gray-700 uppercase tracking-wide">Merchant Center</h4>
                            {isCompliant ? (
                                <span className="inline-flex items-center gap-1 text-xs font-medium text-green-600">
                                    <CheckCircle size={10} /> Compliant
                                </span>
                            ) : (
                                <span className="inline-flex items-center gap-1 text-xs font-medium text-red-600">
                                    <AlertTriangle size={10} /> {criticalIssues.length + warnings.length} Issues
                                </span>
                            )}
                        </div>
                        <div className="p-3 max-h-64 overflow-y-auto space-y-2">
                            {isCompliant ? (
                                <div className="text-center py-3">
                                    <div className="w-8 h-8 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-2">
                                        <CheckCircle size={16} />
                                    </div>
                                    <p className="text-xs font-medium text-gray-700">Ready for sync</p>
                                    <p className="text-xs text-gray-500">Meets all requirements</p>
                                </div>
                            ) : (
                                <>
                                    {criticalIssues.length > 0 && (
                                        <>
                                            <p className="text-xs font-semibold text-red-600 mb-1 flex items-center gap-1">
                                                <AlertTriangle size={12} />
                                                Critical ({criticalIssues.length})
                                            </p>
                                            {criticalIssues.map((issue, i) => (
                                                <div key={i} className="text-xs text-red-700 bg-red-50 px-2 py-1.5 rounded border border-red-100">
                                                    {issue.attribute && <span className="font-medium">{issue.attribute}: </span>}
                                                    {issue.message}
                                                </div>
                                            ))}
                                        </>
                                    )}
                                    {warnings.length > 0 && (
                                        <>
                                            <p className="text-xs font-semibold text-yellow-600 mt-2 mb-1 flex items-center gap-1">
                                                <AlertTriangle size={12} />
                                                Warnings ({warnings.length})
                                            </p>
                                            {warnings.map((issue, i) => (
                                                <div key={i} className="text-xs text-yellow-700 bg-yellow-50 px-2 py-1.5 rounded border border-yellow-100">
                                                    {issue.attribute && <span className="font-medium">{issue.attribute}: </span>}
                                                    {issue.message}
                                                </div>
                                            ))}
                                        </>
                                    )}
                                </>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </span>
    );
}
