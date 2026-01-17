/**
 * Strategic Theme Card
 * 
 * Displays high-level optimization themes in the top horizontal scroll section.
 * Shows category, title, description, platform indicators, and estimated improvement.
 */

import { ReactNode } from 'react';
import {
    Target,
    Sparkles,
    TrendingUp,
    Users,
    DollarSign,
    Layers,
    BarChart3,
    Zap
} from 'lucide-react';

export interface StrategicTheme {
    id: string;
    category: 'performance' | 'creative' | 'efficiency' | 'audience' | 'budget' | 'structure';
    title: string;
    description: string;
    platforms: ('google' | 'meta')[];
    estimatedImprovement: {
        value: string;
        label: string;
    };
    recommendationCount: number;
}

interface StrategicThemeCardProps {
    theme: StrategicTheme;
    onClick: () => void;
    isActive?: boolean;
}

const categoryConfig: Record<string, {
    icon: ReactNode;
    label: string;
    tagBg: string;
    tagText: string;
    iconBg: string;
}> = {
    performance: {
        icon: <Target className="w-5 h-5" />,
        label: 'HIGH IMPACT',
        tagBg: 'bg-emerald-100',
        tagText: 'text-emerald-700',
        iconBg: 'bg-emerald-50'
    },
    creative: {
        icon: <Sparkles className="w-5 h-5 text-orange-500" />,
        label: 'CREATIVE',
        tagBg: 'bg-orange-100',
        tagText: 'text-orange-700',
        iconBg: 'bg-orange-50'
    },
    efficiency: {
        icon: <BarChart3 className="w-5 h-5 text-blue-500" />,
        label: 'EFFICIENCY',
        tagBg: 'bg-blue-100',
        tagText: 'text-blue-700',
        iconBg: 'bg-blue-50'
    },
    audience: {
        icon: <Users className="w-5 h-5 text-purple-500" />,
        label: 'AUDIENCE',
        tagBg: 'bg-purple-100',
        tagText: 'text-purple-700',
        iconBg: 'bg-purple-50'
    },
    budget: {
        icon: <DollarSign className="w-5 h-5 text-green-500" />,
        label: 'BUDGET',
        tagBg: 'bg-green-100',
        tagText: 'text-green-700',
        iconBg: 'bg-green-50'
    },
    structure: {
        icon: <Layers className="w-5 h-5 text-indigo-500" />,
        label: 'STRUCTURE',
        tagBg: 'bg-indigo-100',
        tagText: 'text-indigo-700',
        iconBg: 'bg-indigo-50'
    }
};

export function StrategicThemeCard({ theme, onClick, isActive }: StrategicThemeCardProps) {
    const config = categoryConfig[theme.category] || categoryConfig.performance;

    return (
        <button
            onClick={onClick}
            className={`
                flex-shrink-0 w-72 p-5 rounded-2xl border-2 text-left transition-all
                ${isActive
                    ? 'border-indigo-500 bg-white shadow-lg shadow-indigo-100'
                    : 'border-gray-200 bg-white hover:border-gray-300 hover:shadow-md'
                }
            `}
        >
            {/* Header */}
            <div className="flex items-start justify-between mb-4">
                <div className={`p-2.5 rounded-xl ${config.iconBg}`}>
                    {config.icon}
                </div>
                <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${config.tagBg} ${config.tagText}`}>
                    {config.label}
                </span>
            </div>

            {/* Title & Description */}
            <h3 className="font-bold text-gray-900 mb-2 line-clamp-2">
                {theme.title}
            </h3>
            <p className="text-sm text-gray-500 mb-4 line-clamp-3">
                {theme.description}
            </p>

            {/* Footer */}
            <div className="flex items-center justify-between pt-3 border-t border-gray-100">
                {/* Platform Indicators */}
                <div className="flex items-center gap-1">
                    {theme.platforms.includes('google') && (
                        <span className="w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center text-xs font-bold text-gray-600">
                            G
                        </span>
                    )}
                    {theme.platforms.includes('meta') && (
                        <span className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center text-xs font-bold text-blue-600">
                            M
                        </span>
                    )}
                </div>

                {/* Estimated Improvement */}
                <div className="text-right">
                    <p className="text-xs text-gray-400 uppercase tracking-wider">Est. Improvement</p>
                    <p className={`font-bold ${theme.estimatedImprovement.value.startsWith('+') ? 'text-emerald-600' :
                            theme.estimatedImprovement.value.startsWith('-') ? 'text-emerald-600' :
                                'text-blue-600'
                        }`}>
                        {theme.estimatedImprovement.value}
                    </p>
                </div>
            </div>
        </button>
    );
}
