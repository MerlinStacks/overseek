import { ReactNode } from 'react';
import { cn } from '../../utils/cn';

interface EmptyStateProps {
    /** Icon component to display */
    icon: ReactNode;
    /** Main heading text */
    title: string;
    /** Descriptive message */
    description?: string;
    /** Primary action button */
    action?: {
        label: string;
        onClick: () => void;
        icon?: ReactNode;
    };
    /** Secondary action or link */
    secondaryAction?: ReactNode;
    /** Additional CSS classes */
    className?: string;
}

/**
 * EmptyState - Consistent empty state component with guided actions.
 * Use this instead of ad-hoc empty state implementations.
 * 
 * @example
 * <EmptyState
 *   icon={<Package size={48} />}
 *   title="No orders yet"
 *   description="Orders will appear here once customers make purchases."
 *   action={{ label: "Sync Orders", onClick: handleSync, icon: <RefreshCw size={16} /> }}
 * />
 */
export function EmptyState({
    icon,
    title,
    description,
    action,
    secondaryAction,
    className
}: EmptyStateProps) {
    return (
        <div className={cn(
            "flex flex-col items-center justify-center py-16 px-8 text-center",
            className
        )}>
            {/* Icon with gradient background */}
            <div className="mb-5 p-4 rounded-2xl bg-gradient-to-br from-slate-100 to-slate-200/50 dark:from-slate-700 dark:to-slate-800 text-slate-400 dark:text-slate-500">
                {icon}
            </div>

            {/* Title */}
            <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-200 mb-2">
                {title}
            </h3>

            {/* Description */}
            {description && (
                <p className="text-sm text-slate-500 dark:text-slate-400 max-w-md mb-6 leading-relaxed">
                    {description}
                </p>
            )}

            {/* Primary Action - Gradient Button */}
            {action && (
                <button
                    onClick={action.onClick}
                    className="inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-blue-500 to-violet-500 hover:from-blue-600 hover:to-violet-600 text-white text-sm font-medium rounded-xl transition-all duration-200 shadow-lg shadow-blue-500/25 hover:shadow-blue-500/35 hover:-translate-y-0.5"
                >
                    {action.icon}
                    {action.label}
                </button>
            )}

            {/* Secondary Action */}
            {secondaryAction && (
                <div className="mt-4 text-sm text-slate-500 dark:text-slate-400">
                    {secondaryAction}
                </div>
            )}
        </div>
    );
}

/**
 * EmptyStateCard - EmptyState wrapped in a card container
 */
export function EmptyStateCard(props: EmptyStateProps) {
    return (
        <div className="bg-white dark:bg-slate-800/90 rounded-2xl border border-slate-200/80 dark:border-slate-700/50 shadow-[0_1px_3px_rgba(0,0,0,0.05),0_1px_2px_rgba(0,0,0,0.03)] dark:shadow-[0_1px_3px_rgba(0,0,0,0.2)]">
            <EmptyState {...props} />
        </div>
    );
}
