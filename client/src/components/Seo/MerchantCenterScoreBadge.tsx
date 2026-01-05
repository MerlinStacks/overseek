import { ShoppingBag } from 'lucide-react';

interface MerchantCenterScoreBadgeProps {
    score: number;
    size?: 'sm' | 'md' | 'lg';
}

export function MerchantCenterScoreBadge({ score, size = 'md' }: MerchantCenterScoreBadgeProps) {
    // 0-40 Red, 41-70 Yellow, 71-100 Green
    let color = 'text-red-600 bg-red-50 border-red-200';
    if (score > 40) color = 'text-yellow-600 bg-yellow-50 border-yellow-200';
    if (score > 70) color = 'text-green-600 bg-green-50 border-green-200';

    const sizeClasses = {
        sm: 'text-xs px-2 py-0.5',
        md: 'text-sm px-2.5 py-1',
        lg: 'text-base px-3 py-1.5'
    };

    return (
        <span className={`inline-flex items-center gap-1.5 font-semibold rounded-full border ${color} ${sizeClasses[size]}`}>
            <ShoppingBag size={size === 'sm' ? 12 : 14} />
            MC: {score}/100
        </span>
    );
}
