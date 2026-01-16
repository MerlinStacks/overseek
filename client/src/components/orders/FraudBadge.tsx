/**
 * FraudBadge - Displays fraud risk score with color-coded indicator.
 */
import { useState, useEffect } from 'react';
import { Logger } from '../../utils/logger';
import { ShieldAlert, ShieldCheck, ShieldQuestion, AlertTriangle } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { cn } from '../../utils/cn';

interface FraudResult {
    score: number;
    level: 'low' | 'medium' | 'high';
    factors: string[];
}

interface FraudBadgeProps {
    orderId: string;
    className?: string;
}

export function FraudBadge({ orderId, className }: FraudBadgeProps) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [result, setResult] = useState<FraudResult | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [showTooltip, setShowTooltip] = useState(false);

    useEffect(() => {
        fetchFraudScore();
    }, [orderId, currentAccount]);

    const fetchFraudScore = async () => {
        if (!orderId || !token || !currentAccount) return;
        setIsLoading(true);
        try {
            const res = await fetch(`/api/orders/${orderId}/fraud-score`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'X-Account-ID': currentAccount.id
                }
            });
            if (res.ok) {
                setResult(await res.json());
            }
        } catch (e) {
            Logger.error('Failed to fetch fraud score:', { error: e });
        } finally {
            setIsLoading(false);
        }
    };

    if (isLoading) {
        return (
            <div className={cn("animate-pulse w-20 h-6 bg-gray-200 rounded", className)} />
        );
    }

    if (!result) return null;

    const config = {
        low: {
            bg: 'bg-green-100',
            text: 'text-green-700',
            border: 'border-green-200',
            icon: ShieldCheck,
            label: 'Low Risk'
        },
        medium: {
            bg: 'bg-yellow-100',
            text: 'text-yellow-700',
            border: 'border-yellow-200',
            icon: ShieldQuestion,
            label: 'Medium Risk'
        },
        high: {
            bg: 'bg-red-100',
            text: 'text-red-700',
            border: 'border-red-200',
            icon: ShieldAlert,
            label: 'High Risk'
        }
    };

    const { bg, text, border, icon: Icon, label } = config[result.level];

    return (
        <div className={cn("relative inline-block", className)}>
            <button
                onMouseEnter={() => setShowTooltip(true)}
                onMouseLeave={() => setShowTooltip(false)}
                className={cn(
                    "flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium transition-colors",
                    bg, text, border
                )}
            >
                <Icon size={14} />
                <span>{label}</span>
                <span className="opacity-70">({result.score})</span>
            </button>

            {showTooltip && result.factors.length > 0 && (
                <div className="absolute z-50 top-full left-0 mt-1 w-64 p-3 bg-white border border-gray-200 rounded-lg shadow-lg text-left">
                    <p className="text-xs font-semibold text-gray-700 mb-2">Risk Factors:</p>
                    <ul className="space-y-1">
                        {result.factors.map((factor, i) => (
                            <li key={i} className="flex items-start gap-2 text-xs text-gray-600">
                                <AlertTriangle size={12} className="text-amber-500 mt-0.5 flex-shrink-0" />
                                {factor}
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
}
