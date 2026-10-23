import type { ReactNode } from 'react';
import { cn } from '../../utils/cn';

interface MetricStripProps {
    children: ReactNode;
    label?: string;
    className?: string;
}

/** Compact summary, not a row of separate dashboard cards. Wraps instead of clipping. */
export function MetricStrip({ children, label = 'Summary', className }: MetricStripProps) {
    return <dl aria-label={label} className={cn('metric-strip', className)}>{children}</dl>;
}

interface MetricProps {
    label: ReactNode;
    value: ReactNode;
    hint?: ReactNode;
    className?: string;
    valueClassName?: string;
}

export function Metric({ label, value, hint, className, valueClassName }: MetricProps) {
    return <div className={cn('metric-strip-item', className)}>
        <dt className="break-words text-xs leading-snug text-slate-500 dark:text-slate-400">{label}</dt>
        <dd className="mt-1 flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className={cn('min-w-0 break-words text-xl font-semibold leading-tight tracking-tight tabular-nums text-slate-900 dark:text-slate-100', valueClassName)}>{value}</span>
            {hint != null && <span className="min-w-0 break-words text-xs leading-snug text-slate-500 dark:text-slate-400">{hint}</span>}
        </dd>
    </div>;
}
