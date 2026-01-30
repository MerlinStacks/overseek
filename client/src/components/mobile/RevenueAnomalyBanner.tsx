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
    if (!anomaly || !anomaly.isAnomaly) {
        return null;
    }

    const isPositive = anomaly.direction === 'above';

    return (
        <button
            onClick={() => navigate('/m/analytics')}
            className={`w-full p-4 rounded-xl flex items-center gap-3 text-left transition-transform active:scale-[0.98] ${isPositive
                    ? 'bg-gradient-to-r from-emerald-500 to-green-600 text-white'
                    : 'bg-gradient-to-r from-amber-500 to-orange-500 text-white'
                }`}
            aria-label={`Revenue anomaly alert: ${anomaly.message}`}
        >
            <div className={`p-2 rounded-lg ${isPositive ? 'bg-white/20' : 'bg-white/20'}`}>
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
