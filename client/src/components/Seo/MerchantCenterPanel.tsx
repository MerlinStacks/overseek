import { ShoppingBag, AlertTriangle, CheckCircle } from 'lucide-react';

export interface MerchantIssue {
    severity: 'error' | 'warning';
    message: string;
    attribute?: string;
}

interface MerchantCenterPanelProps {
    score: number; // 0-100 compliance
    issues: MerchantIssue[];
}

export function MerchantCenterPanel({ score: _score, issues }: MerchantCenterPanelProps) {
    const criticalIssues = issues.filter(i => i.severity === 'error');
    const warnings = issues.filter(i => i.severity === 'warning');
    const isCompliant = criticalIssues.length === 0;

    return (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="p-4 border-b border-gray-100 bg-gray-50 flex justify-between items-center">
                <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                    <ShoppingBag size={18} className="text-blue-600" />
                    Google Merchant Center
                </h3>
                {isCompliant ? (
                    <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-green-100 text-green-700">
                        <CheckCircle size={12} /> Compliant
                    </span>
                ) : (
                    <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-red-100 text-red-700">
                        <AlertTriangle size={12} /> {criticalIssues.length} Errors
                    </span>
                )}
            </div>

            <div className="p-4">
                {issues.length === 0 ? (
                    <div className="text-center py-6">
                        <div className="w-12 h-12 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-2">
                            <CheckCircle size={24} />
                        </div>
                        <p className="text-gray-900 font-medium">Ready for sync</p>
                        <p className="text-sm text-gray-500">This product meets all core requirements.</p>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {criticalIssues.map((issue, idx) => (
                            <div key={`err-${idx}`} className="flex gap-3 text-sm text-red-700 bg-red-50 p-3 rounded-md border border-red-100">
                                <AlertTriangle className="shrink-0 mt-0.5" size={16} />
                                <div>
                                    <span className="font-semibold block">Critical Issue ({issue.attribute})</span>
                                    {issue.message}
                                </div>
                            </div>
                        ))}
                        {warnings.map((issue, idx) => (
                            <div key={`warn-${idx}`} className="flex gap-3 text-sm text-yellow-800 bg-yellow-50 p-3 rounded-md border border-yellow-100">
                                <AlertTriangle className="shrink-0 mt-0.5" size={16} />
                                <div>
                                    <span className="font-semibold block">Warning ({issue.attribute})</span>
                                    {issue.message}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
