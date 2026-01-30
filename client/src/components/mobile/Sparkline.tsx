/**
 * Sparkline - Minimal inline chart for stat cards.
 * 
 * Features:
 * - Gradient fill under line
 * - Smooth curve interpolation
 * - Trend indicator dot at end
 */

interface SparklineProps {
    data: number[];
    color?: string;
    height?: number;
    showTrend?: boolean;
}

export function Sparkline({
    data,
    color = '#818cf8',
    height = 32,
    showTrend = true
}: SparklineProps) {
    if (!data || data.length < 2) {
        return <div style={{ height }} />;
    }

    const width = 100;
    const padding = 2;

    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;

    // Calculate points
    const points = data.map((value, index) => {
        const x = padding + (index / (data.length - 1)) * (width - padding * 2);
        const y = height - padding - ((value - min) / range) * (height - padding * 2);
        return { x, y };
    });

    // Create smooth path using bezier curves
    const linePath = points.reduce((path, point, index) => {
        if (index === 0) {
            return `M ${point.x},${point.y}`;
        }
        const prev = points[index - 1];
        const cp1x = prev.x + (point.x - prev.x) / 3;
        const cp2x = prev.x + (point.x - prev.x) * 2 / 3;
        return `${path} C ${cp1x},${prev.y} ${cp2x},${point.y} ${point.x},${point.y}`;
    }, '');

    // Create fill path
    const fillPath = `${linePath} L ${points[points.length - 1].x},${height} L ${points[0].x},${height} Z`;

    const lastPoint = points[points.length - 1];
    const trend = data[data.length - 1] >= data[0] ? 'up' : 'down';

    return (
        <svg
            viewBox={`0 0 ${width} ${height}`}
            className="w-full overflow-visible"
            style={{ height }}
            preserveAspectRatio="none"
        >
            <defs>
                <linearGradient id={`sparkline-gradient-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={color} stopOpacity="0.3" />
                    <stop offset="100%" stopColor={color} stopOpacity="0" />
                </linearGradient>
            </defs>

            {/* Gradient fill */}
            <path
                d={fillPath}
                fill={`url(#sparkline-gradient-${color.replace('#', '')})`}
            />

            {/* Line */}
            <path
                d={linePath}
                fill="none"
                stroke={color}
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="drop-shadow-sm"
            />

            {/* End dot with glow */}
            {showTrend && (
                <>
                    <circle
                        cx={lastPoint.x}
                        cy={lastPoint.y}
                        r="4"
                        fill={trend === 'up' ? '#10b981' : '#f43f5e'}
                        className="drop-shadow-md"
                    />
                    <circle
                        cx={lastPoint.x}
                        cy={lastPoint.y}
                        r="6"
                        fill={trend === 'up' ? '#10b981' : '#f43f5e'}
                        opacity="0.3"
                    />
                </>
            )}
        </svg>
    );
}

/**
 * TrendBadge - Shows percentage change with color coding.
 */
interface TrendBadgeProps {
    value: number;
    suffix?: string;
}

export function TrendBadge({ value, suffix = '%' }: TrendBadgeProps) {
    const isPositive = value >= 0;
    const color = isPositive ? 'text-emerald-400' : 'text-rose-400';
    const bg = isPositive ? 'bg-emerald-500/20' : 'bg-rose-500/20';

    return (
        <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-xs font-medium ${color} ${bg}`}>
            <span className="text-[10px]">{isPositive ? '▲' : '▼'}</span>
            {Math.abs(value).toFixed(1)}{suffix}
        </span>
    );
}
