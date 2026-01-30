import { cn } from '../../utils/cn';

interface SkeletonProps {
    /** Additional CSS classes */
    className?: string;
    /** Width (e.g., 'w-24', '100px') */
    width?: string;
    /** Height (e.g., 'h-4', '20px') */
    height?: string;
    /** Whether to use rounded corners */
    rounded?: 'none' | 'sm' | 'md' | 'lg' | 'full';
}

/**
 * Skeleton - Base animated placeholder for loading states.
 * Use instead of spinners for data-heavy screens to improve perceived performance.
 * 
 * @example
 * <Skeleton className="w-32 h-4" />
 */
export function Skeleton({
    className,
    width,
    height,
    rounded = 'md'
}: SkeletonProps) {
    const roundedClasses = {
        none: '',
        sm: 'rounded-sm',
        md: 'rounded-md',
        lg: 'rounded-lg',
        full: 'rounded-full'
    };

    return (
        <div
            className={cn(
                "animate-pulse bg-gradient-to-r from-slate-200 via-slate-100 to-slate-200 dark:from-slate-700 dark:via-slate-600 dark:to-slate-700 bg-[length:200%_100%]",
                roundedClasses[rounded],
                className
            )}
            style={{
                width: width || undefined,
                height: height || undefined
            }}
        />
    );
}

/**
 * SkeletonText - Text line placeholder with realistic proportions
 */
export function SkeletonText({
    lines = 1,
    className
}: {
    lines?: number;
    className?: string;
}) {
    return (
        <div className={cn("space-y-2", className)}>
            {Array.from({ length: lines }).map((_, i) => (
                <Skeleton
                    key={i}
                    className={cn(
                        "h-4",
                        // Last line is shorter for realism
                        i === lines - 1 && lines > 1 ? "w-3/4" : "w-full"
                    )}
                />
            ))}
        </div>
    );
}

/**
 * SkeletonAvatar - Circular avatar placeholder
 */
export function SkeletonAvatar({
    size = 'md',
    className
}: {
    size?: 'sm' | 'md' | 'lg';
    className?: string;
}) {
    const sizeClasses = {
        sm: 'w-8 h-8',
        md: 'w-10 h-10',
        lg: 'w-12 h-12'
    };

    return (
        <Skeleton
            className={cn(sizeClasses[size], className)}
            rounded="full"
        />
    );
}

/**
 * TableRowSkeleton - Complete table row skeleton for data tables
 */
export function TableRowSkeleton({
    columns = 5,
    className,
    showAvatar = false
}: {
    columns?: number;
    className?: string;
    showAvatar?: boolean;
}) {
    return (
        <tr className={cn("animate-pulse", className)}>
            {Array.from({ length: columns }).map((_, i) => (
                <td key={i} className="px-6 py-4">
                    {i === 0 && showAvatar ? (
                        <div className="flex items-center gap-3">
                            <SkeletonAvatar size="md" />
                            <div className="space-y-2">
                                <Skeleton className="h-4 w-24" />
                                <Skeleton className="h-3 w-32" />
                            </div>
                        </div>
                    ) : (
                        <Skeleton
                            className="h-4"
                            width={`${60 + Math.random() * 40}%`}
                        />
                    )}
                </td>
            ))}
        </tr>
    );
}

/**
 * TableSkeleton - Multiple rows of table skeletons
 */
export function TableSkeleton({
    rows = 5,
    columns = 5,
    showAvatar = false
}: {
    rows?: number;
    columns?: number;
    showAvatar?: boolean;
}) {
    return (
        <>
            {Array.from({ length: rows }).map((_, i) => (
                <TableRowSkeleton
                    key={i}
                    columns={columns}
                    showAvatar={showAvatar}
                />
            ))}
        </>
    );
}

/**
 * CardSkeleton - Dashboard card loading state
 */
export function CardSkeleton({ className }: { className?: string }) {
    return (
        <div className={cn(
            "bg-white dark:bg-slate-800/90 rounded-2xl border border-slate-200/80 dark:border-slate-700/50 p-6 animate-pulse",
            "shadow-[0_1px_3px_rgba(0,0,0,0.05),0_1px_2px_rgba(0,0,0,0.03)] dark:shadow-[0_1px_3px_rgba(0,0,0,0.2)]",
            className
        )}>
            <div className="flex items-center justify-between mb-4">
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-10 w-10" rounded="lg" />
            </div>
            <Skeleton className="h-8 w-24 mb-2" />
            <Skeleton className="h-4 w-28" />
        </div>
    );
}
