/**
 * FraudIcon - Compact fraud risk indicator for order lists.
 * Shows a small shield icon that fetches and displays risk level on hover.
 */
import { useState, useEffect } from 'react';
import { Logger } from '../../utils/logger';
import { ShieldAlert, ShieldCheck, ShieldQuestion } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { cn } from '../../utils/cn';

interface FraudResult {
    score: number;
    level: 'low' | 'medium' | 'high';
    factors: string[];
}

interface FraudIconProps {
    orderId: number | string;
    className?: string;
}

export function FraudIcon({ orderId, className }: FraudIconProps) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [result, setResult] = useState<FraudResult | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [hasFetched, setHasFetched] = useState(false);
    const [showTooltip, setShowTooltip] = useState(false);

    // Fetch on first hover to avoid loading all at once
    const handleMouseEnter = () => {
        setShowTooltip(true);
        if (!hasFetched && !isLoading) {
            fetchFraudScore();
        }
    };

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
            setHasFetched(true);
        }
    };

    const config = {
        low: {
            color: 'text-green-500',
            icon: ShieldCheck,
            label: 'Low Risk'
        },
        medium: {
            color: 'text-yellow-500',
            icon: ShieldQuestion,
            label: 'Medium Risk'
        },
        high: {
            color: 'text-red-500',
            icon: ShieldAlert,
            label: 'High Risk'
        }
    };

    // Default to neutral before fetching
    const level = result?.level || 'low';
    const { color, icon: Icon, label } = config[level];

    return (
        <div
            className={cn("relative inline-flex items-center", className)}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={() => setShowTooltip(false)}
        >
            <Icon
                size={16}
                className={cn(
                    "transition-colors cursor-pointer",
                    hasFetched ? color : "text-gray-300"
                )}
            />

            {showTooltip && (
                <div className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-gray-900 text-white text-xs rounded whitespace-nowrap">
                    {isLoading ? 'Loading...' : (
                        result ? `${label} (${result.score})` : 'Hover to check'
                    )}
                    <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900" />
                </div>
            )}
        </div>
    );
}
