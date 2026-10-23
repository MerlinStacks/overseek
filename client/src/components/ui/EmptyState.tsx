import { ReactNode } from 'react';
import { cn } from '../../utils/cn';
import { workspaceStyles } from './workspaceStyles';

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
            <div className="mb-5 p-3 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400">
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

            {/* Primary action */}
            {action && (
                <button
                    type="button"
                    onClick={action.onClick}
                    className={workspaceStyles.primary}
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
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
            <EmptyState {...props} />
        </div>
    );
}
