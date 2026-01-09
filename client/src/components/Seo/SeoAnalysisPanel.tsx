import { CheckCircle2, XCircle, AlertTriangle, TrendingUp, ArrowRight, Lightbulb } from 'lucide-react';

export interface SeoTest {
    test: string;
    passed: boolean;
    message: string;
}

interface SeoAnalysisPanelProps {
    score: number;
    tests: SeoTest[];
    focusKeyword?: string;
    onUpdateKeyword?: (keyword: string) => void;
}

export function SeoAnalysisPanel({ score, tests, focusKeyword }: SeoAnalysisPanelProps) {
    const passedTests = tests.filter(t => t.passed);
    const failedTests = tests.filter(t => !t.passed);

    // Color logic
    const scoreColor = score >= 80 ? 'text-green-600' : score >= 50 ? 'text-amber-500' : 'text-red-600';
    const progressBarColor = score >= 80 ? 'bg-green-500' : score >= 50 ? 'bg-amber-500' : 'bg-red-500';

    return (
        <div className="bg-white/70 backdrop-blur-md rounded-xl shadow-xs border border-white/50 overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Header / Score Card */}
            <div className="p-6 border-b border-gray-100 bg-white/50">
                <div className="flex items-start justify-between mb-4">
                    <div>
                        <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                            <TrendingUp className="text-blue-600" size={20} />
                            SEO Health Score
                        </h3>
                        <p className="text-sm text-gray-500 mt-1">
                            Optimize your product to improve search visibility.
                        </p>
                    </div>
                    <div className="text-right">
                        <div className={`text-3xl font-black ${scoreColor}`}>
                            {score}
                            <span className="text-lg text-gray-400 font-medium">/100</span>
                        </div>
                    </div>
                </div>

                {/* Progress Bar */}
                <div className="h-2 w-full bg-gray-100 rounded-full overflow-hidden">
                    <div
                        className={`h-full ${progressBarColor} transition-all duration-1000 ease-out`}
                        style={{ width: `${score}%` }}
                    />
                </div>
            </div>

            <div className="p-6 space-y-8">
                {/* Actionable Hints (Failed Tests) */}
                {failedTests.length > 0 && (
                    <div className="space-y-4">
                        <h4 className="text-sm font-bold text-gray-900 uppercase tracking-wide flex items-center gap-2">
                            <AlertTriangle size={16} className="text-amber-500" />
                            Action Items ({failedTests.length})
                        </h4>
                        <div className="space-y-3">
                            {failedTests.map((t, idx) => (
                                <div key={idx} className="group bg-white border border-l-4 border-l-amber-500 border-gray-100 rounded-lg p-4 shadow-xs hover:shadow-md transition-all">
                                    <div className="flex items-start gap-4">
                                        <div className="bg-amber-50 p-2 rounded-full shrink-0 group-hover:bg-amber-100 transition-colors">
                                            <Lightbulb className="text-amber-600" size={18} />
                                        </div>
                                        <div className="flex-1">
                                            <h5 className="font-semibold text-gray-900 text-sm mb-1">{t.test}</h5>
                                            <p className="text-sm text-gray-600 leading-relaxed">
                                                <span className="font-medium text-amber-700">Hint: </span>
                                                {t.message}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Passed Checks */}
                {passedTests.length > 0 && (
                    <div className="space-y-4">
                        <h4 className="text-sm font-bold text-gray-900 uppercase tracking-wide flex items-center gap-2">
                            <CheckCircle2 size={16} className="text-green-600" />
                            Passed Checks ({passedTests.length})
                        </h4>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {passedTests.map((t, idx) => (
                                <div key={idx} className="flex items-center gap-2 text-sm text-gray-700 bg-green-50/50 px-3 py-2 rounded-lg border border-green-100">
                                    <CheckCircle2 className="text-green-500 shrink-0" size={14} />
                                    <span className="truncate">{t.test}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {tests.length === 0 && (
                    <div className="text-center py-8 bg-gray-50 rounded-lg border-dashed border-2 border-gray-200">
                        <p className="text-gray-500 font-medium">Sync product to generate SEO analysis.</p>
                    </div>
                )}
            </div>
        </div>
    );
}
