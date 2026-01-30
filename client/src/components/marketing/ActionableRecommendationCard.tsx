
import {
    TrendingUp,
    TrendingDown,
    DollarSign,
    Search,
    ShoppingBag,
    Target,
    ArrowRight,
    Check,
    X,
    Calendar,
    AlertTriangle,
    MinusCircle
} from 'lucide-react';
import {
    ActionableRecommendation,
    BudgetAction,
    KeywordAction,
    ProductAction,
    isBudgetAction,
    isKeywordAction,
    isProductAction
} from '../../types/ActionableTypes';

interface ActionableRecommendationCardProps {
    recommendation: ActionableRecommendation;
    onApply?: (recommendation: ActionableRecommendation) => void;
    onDismiss?: (recommendation: ActionableRecommendation) => void;
    onSchedule?: (recommendation: ActionableRecommendation) => void;
}

export function ActionableRecommendationCard({
    recommendation,
    onApply,
    onDismiss,
    onSchedule
}: ActionableRecommendationCardProps) {
    const { action, headline, explanation, dataPoints, priority } = recommendation;

    const getIcon = () => {
        if (isBudgetAction(action)) return <DollarSign className="w-5 h-5" />;
        if (isKeywordAction(action)) return <Search className="w-5 h-5" />;
        if (isProductAction(action)) return <ShoppingBag className="w-5 h-5" />;
        return <Target className="w-5 h-5" />;
    };

    const getColors = () => {
        if (priority === 1) return 'bg-red-50 border-red-200 text-red-700 hover:bg-red-100';
        if (isBudgetAction(action) && action.changeAmount > 0) return 'bg-green-50 border-green-200 text-green-700 hover:bg-green-100';
        if (isBudgetAction(action) && action.changeAmount < 0) return 'bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100';
        return 'bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100';
    };

    const getImpactText = () => {
        if (!recommendation.estimatedImpact) return null;
        const { revenueChange, roasChange, spendChange } = recommendation.estimatedImpact;

        if (revenueChange) return `+${revenueChange.toLocaleString('en-US', { style: 'currency', currency: 'USD' })} est. revenue`;
        if (roasChange) return `+${roasChange.toFixed(1)}x est. ROAS`;
        if (spendChange && spendChange < 0) return `${spendChange.toLocaleString('en-US', { style: 'currency', currency: 'USD' })} spend savings`;
        return null;
    };

    const renderActionDetails = () => {
        if (isBudgetAction(action)) {
            return (
                <div className="mt-3 flex items-center gap-4 text-sm">
                    <div className="flex flex-col">
                        <span className="text-gray-500 uppercase text-xs font-bold tracking-wider">Current</span>
                        <span className="font-mono text-gray-700">${action.currentBudget.toFixed(2)}</span>
                    </div>
                    <div className="flex flex-col">
                        <span className="text-gray-500 uppercase text-xs font-bold tracking-wider">Suggested</span>
                        <span className="font-mono font-bold text-green-600">${action.suggestedBudget.toFixed(2)}</span>
                    </div>
                    <div className="flex flex-col">
                        <span className="text-gray-500 uppercase text-xs font-bold tracking-wider">Change</span>
                        <span className={`font-mono font-bold ${action.changeAmount > 0 ? 'text-green-600' : 'text-amber-600'}`}>
                            {action.changeAmount > 0 ? '+' : ''}{action.changeAmount.toFixed(0)} (${Math.abs(action.changePercent)}%)
                        </span>
                    </div>
                </div>
            );
        }

        if (isKeywordAction(action)) {
            return (
                <div className="mt-3 flex items-center gap-4 text-sm">
                    <div className="flex flex-col">
                        <span className="text-gray-500 uppercase text-xs font-bold tracking-wider">Keyword</span>
                        <span className="font-mono text-gray-700 border px-1 rounded bg-gray-50">{action.keyword}</span>
                    </div>
                    <div className="flex flex-col">
                        <span className="text-gray-500 uppercase text-xs font-bold tracking-wider">Match</span>
                        <span className="text-gray-700">{action.matchType}</span>
                    </div>
                    <div className="flex flex-col">
                        <span className="text-gray-500 uppercase text-xs font-bold tracking-wider">Max CPC</span>
                        <span className="font-mono font-bold text-blue-600">${action.suggestedCpc.toFixed(2)}</span>
                    </div>
                </div>
            );
        }

        if (isProductAction(action)) {
            return (
                <div className="mt-3 flex items-center gap-4 text-sm">
                    <div className="flex flex-col">
                        <span className="text-gray-500 uppercase text-xs font-bold tracking-wider">Velocity</span>
                        <span className="font-mono text-gray-700">{action.salesVelocity?.toFixed(1)}/day</span>
                    </div>
                    {action.margin && (
                        <div className="flex flex-col">
                            <span className="text-gray-500 uppercase text-xs font-bold tracking-wider">Margin</span>
                            <span className="font-mono text-green-600">{action.margin.toFixed(0)}%</span>
                        </div>
                    )}
                </div>
            );
        }
        return null;
    };

    return (
        <div className="group relative bg-white/80 backdrop-blur-xl border border-white/20 shadow-sm hover:shadow-md rounded-2xl p-5 transition-all duration-300">
            {/* Glassmorphism gradient glow on hover */}
            <div className={`absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-5 transition-opacity duration-300 ${getColors().split(' ')[0]}`}></div>

            <div className="relative flex justify-between items-start gap-4">
                <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                        <div className={`p-2 rounded-lg ${getColors()}`}>
                            {getIcon()}
                        </div>
                        <span className="text-xs font-bold uppercase tracking-wider text-gray-400">
                            {recommendation.platform} • {recommendation.category}
                        </span>
                        {priority === 1 && (
                            <span className="bg-red-100 text-red-700 text-xs px-2 py-0.5 rounded-full font-bold flex items-center gap-1">
                                <AlertTriangle className="w-3 h-3" /> Urgent
                            </span>
                        )}
                        {getImpactText() && (
                            <span className="bg-green-100 text-green-700 text-xs px-2 py-0.5 rounded-full font-bold flex items-center gap-1">
                                <TrendingUp className="w-3 h-3" /> {getImpactText()}
                            </span>
                        )}
                    </div>

                    <h3 className="text-lg font-bold text-gray-900 leading-tight mb-1">
                        {headline}
                    </h3>

                    <p className="text-gray-600 text-sm leading-relaxed mb-3">
                        {explanation}
                    </p>

                    {/* Data Points */}
                    {dataPoints.length > 0 && (
                        <div className="flex flex-wrap gap-2 mt-2">
                            {dataPoints.map((dp, idx) => (
                                <span key={idx} className="inline-flex items-center px-2 py-1 rounded bg-gray-100 text-gray-600 text-xs font-medium">
                                    {dp}
                                </span>
                            ))}
                        </div>
                    )}

                    {renderActionDetails()}
                </div>

                {/* Action Buttons */}
                <div className="flex flex-col gap-2 min-w-[120px]">
                    <button
                        onClick={() => onApply?.(recommendation)}
                        className="w-full py-2 px-3 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg shadow-sm transition-colors flex items-center justify-center gap-2"
                    >
                        <Check className="w-4 h-4" /> Apply
                    </button>
                    {isBudgetAction(action) && (
                        <button
                            onClick={() => onSchedule?.(recommendation)}
                            className="w-full py-2 px-3 bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
                        >
                            <Calendar className="w-4 h-4" /> Schedule
                        </button>
                    )}
                    <button
                        onClick={() => onDismiss?.(recommendation)}
                        className="w-full py-2 px-3 text-gray-400 hover:text-gray-600 hover:bg-gray-50 text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
                    >
                        <X className="w-4 h-4" /> Dismiss
                    </button>
                </div>
            </div>

            {/* Confidence indicator */}
            <div className="absolute top-4 right-4" title={`Confidence: ${recommendation.confidence}%`}>
                <div className="relative w-8 h-8 flex items-center justify-center">
                    <svg className="w-full h-full transform -rotate-90">
                        <circle
                            cx="16"
                            cy="16"
                            r="14"
                            className="stroke-gray-100"
                            strokeWidth="3"
                            fill="none"
                        />
                        <circle
                            cx="16"
                            cy="16"
                            r="14"
                            className={`${recommendation.confidence > 80 ? 'stroke-green-500' : 'stroke-blue-500'}`}
                            strokeWidth="3"
                            fill="none"
                            strokeDasharray={88}
                            strokeDashoffset={88 - (88 * recommendation.confidence) / 100}
                        />
                    </svg>
                    <span className="absolute text-[10px] font-bold text-gray-500">
                        {recommendation.confidence}
                    </span>
                </div>
            </div>
        </div>
    );
}
