import { useNavigate } from 'react-router-dom';
import { Rocket, AlertTriangle } from 'lucide-react';

/**
 * RevenueAnomalyBanner - Displays alert when revenue is significantly above/below baseline.
 * Tapping navigates to the analytics page for deeper insights.
 */

interface AnomalyData {
    isAnomaly: boolean;
    direction: 'above' | 'below' | 'normal';
    percentChange: number;
    message: string;
}

interface RevenueAnomalyBannerProps {
    anomaly: AnomalyData | null;
}

export function RevenueAnomalyBanner({ anomaly }: RevenueAnomalyBannerProps) {
    const navigate = useNavigate();

    // Don't render if no anomaly or normal state
    if (!anomaly || !anomaly.isAnomaly || !['above', 'below'].includes(anomaly.direction) || !Number.isFinite(anomaly.percentChange) || !anomaly.message.trim()) {
        return null;
    }

    const isPositive = anomaly.direction === 'above';

    return (
        <button
            type="button"
            onClick={() => navigate('/m/analytics')}
            className={`w-full p-4 rounded-xl flex items-center gap-3 text-left transition-transform active:scale-[0.98] motion-reduce:transition-none motion-reduce:transform-none ${isPositive
                    ? 'bg-gradient-to-r from-emerald-500 to-green-600 text-white'
                    : 'bg-gradient-to-r from-amber-500 to-orange-500 text-white'
                }`}
            aria-label={`Revenue anomaly alert: ${anomaly.message}`}
        >
            <div aria-hidden="true" className="p-2 rounded-lg bg-white/20">
                {isPositive ? (
                    <Rocket size={24} className="text-white" />
                ) : (
                    <AlertTriangle size={24} className="text-white" />
                )}
            </div>
            <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm">{anomaly.message}</p>
                <p className="text-xs opacity-80">Tap to view analytics</p>
            </div>
        </button>
    );
}
