import { cn } from '../../utils/cn';
import { Skeleton, SkeletonText, SkeletonAvatar, TableSkeleton, CardSkeleton } from './Skeleton';

/**
 * PageSkeletons - Composed skeleton loaders for specific pages.
 * Use these instead of spinners for data-heavy pages to improve perceived performance.
 */

/**
 * OrdersPageSkeleton - Status tabs + orders table
 */
export function OrdersPageSkeleton({ className }: { className?: string }) {
    return (
        <div className={cn("space-y-6", className)}>
            {/* Status tabs skeleton */}
            <div className="flex gap-2 overflow-x-auto pb-2">
                {Array.from({ length: 6 }).map((_, i) => (
                    <Skeleton key={i} className="h-10 w-28 shrink-0" rounded="lg" />
                ))}
            </div>

            {/* Search + filters */}
            <div className="flex gap-4">
                <Skeleton className="h-10 flex-1 max-w-md" rounded="lg" />
                <Skeleton className="h-10 w-32" rounded="lg" />
            </div>

            {/* Table */}
            <div className="bg-white dark:bg-slate-800/90 rounded-2xl border border-slate-200/80 dark:border-slate-700/50 overflow-hidden">
                <table className="w-full">
                    <thead>
                        <tr className="border-b border-slate-200/80 dark:border-slate-700/50">
                            {['Order', 'Customer', 'Status', 'Total', 'Date'].map((_, i) => (
                                <th key={i} className="px-6 py-4 text-left">
                                    <Skeleton className="h-4 w-20" />
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        <TableSkeleton rows={8} columns={5} showAvatar />
                    </tbody>
                </table>
            </div>
        </div>
    );
}

/**
 * CustomersPageSkeleton - Search bar + customers table
 */
export function CustomersPageSkeleton({ className }: { className?: string }) {
    return (
        <div className={cn("space-y-6", className)}>
            {/* Search + filters */}
            <div className="flex gap-4">
                <Skeleton className="h-10 flex-1 max-w-md" rounded="lg" />
                <Skeleton className="h-10 w-32" rounded="lg" />
            </div>

            {/* Stats summary */}
            <div className="grid grid-cols-4 gap-4">
                {Array.from({ length: 4 }).map((_, i) => (
                    <CardSkeleton key={i} />
                ))}
            </div>

            {/* Table */}
            <div className="bg-white dark:bg-slate-800/90 rounded-2xl border border-slate-200/80 dark:border-slate-700/50 overflow-hidden">
                <table className="w-full">
                    <thead>
                        <tr className="border-b border-slate-200/80 dark:border-slate-700/50">
                            {['Customer', 'Email', 'Orders', 'Total Spent', 'Last Order'].map((_, i) => (
                                <th key={i} className="px-6 py-4 text-left">
                                    <Skeleton className="h-4 w-20" />
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        <TableSkeleton rows={10} columns={5} showAvatar />
                    </tbody>
                </table>
            </div>
        </div>
    );
}

/**
 * InventoryPageSkeleton - Filters + products table
 */
export function InventoryPageSkeleton({ className }: { className?: string }) {
    return (
        <div className={cn("space-y-6", className)}>
            {/* Search + filters */}
            <div className="flex flex-wrap gap-4">
                <Skeleton className="h-10 flex-1 min-w-[200px] max-w-md" rounded="lg" />
                <Skeleton className="h-10 w-32" rounded="lg" />
                <Skeleton className="h-10 w-32" rounded="lg" />
                <Skeleton className="h-10 w-24" rounded="lg" />
            </div>

            {/* Table */}
            <div className="bg-white dark:bg-slate-800/90 rounded-2xl border border-slate-200/80 dark:border-slate-700/50 overflow-hidden">
                <table className="w-full">
                    <thead>
                        <tr className="border-b border-slate-200/80 dark:border-slate-700/50">
                            {['Product', 'SKU', 'Stock', 'Price', 'Status'].map((_, i) => (
                                <th key={i} className="px-6 py-4 text-left">
                                    <Skeleton className="h-4 w-16" />
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        <TableSkeleton rows={12} columns={5} showAvatar />
                    </tbody>
                </table>
            </div>
        </div>
    );
}

/**
 * InboxPageSkeleton - Conversation list + message area
 */
export function InboxPageSkeleton({ className }: { className?: string }) {
    return (
        <div className={cn("flex h-[calc(100vh-120px)] gap-4", className)}>
            {/* Conversation list */}
            <div className="w-80 bg-white dark:bg-slate-800/90 rounded-2xl border border-slate-200/80 dark:border-slate-700/50 p-4 space-y-4">
                <Skeleton className="h-10 w-full" rounded="lg" />
                <div className="space-y-3">
                    {Array.from({ length: 8 }).map((_, i) => (
                        <div key={i} className="flex items-center gap-3 p-3">
                            <SkeletonAvatar size="md" />
                            <div className="flex-1 space-y-2">
                                <Skeleton className="h-4 w-24" />
                                <Skeleton className="h-3 w-full" />
                            </div>
                            <Skeleton className="h-3 w-12" />
                        </div>
                    ))}
                </div>
            </div>

            {/* Message area */}
            <div className="flex-1 bg-white dark:bg-slate-800/90 rounded-2xl border border-slate-200/80 dark:border-slate-700/50 p-6 flex flex-col">
                {/* Header */}
                <div className="flex items-center gap-3 pb-4 border-b border-slate-200/80 dark:border-slate-700/50">
                    <SkeletonAvatar size="lg" />
                    <div className="space-y-2">
                        <Skeleton className="h-5 w-32" />
                        <Skeleton className="h-3 w-24" />
                    </div>
                </div>

                {/* Messages */}
                <div className="flex-1 py-6 space-y-4">
                    {Array.from({ length: 4 }).map((_, i) => (
                        <div key={i} className={cn("flex", i % 2 === 0 ? "justify-start" : "justify-end")}>
                            <Skeleton
                                className={cn("h-16", i % 2 === 0 ? "w-2/3" : "w-1/2")}
                                rounded="lg"
                            />
                        </div>
                    ))}
                </div>

                {/* Composer */}
                <Skeleton className="h-12 w-full" rounded="lg" />
            </div>
        </div>
    );
}

/**
 * ReportsPageSkeleton - Cards grid + chart area
 */
export function ReportsPageSkeleton({ className }: { className?: string }) {
    return (
        <div className={cn("space-y-6", className)}>
            {/* Date range + filters */}
            <div className="flex gap-4">
                <Skeleton className="h-10 w-64" rounded="lg" />
                <Skeleton className="h-10 w-32" rounded="lg" />
            </div>

            {/* Stats cards */}
            <div className="grid grid-cols-4 gap-4">
                {Array.from({ length: 4 }).map((_, i) => (
                    <CardSkeleton key={i} />
                ))}
            </div>

            {/* Chart area */}
            <div className="bg-white dark:bg-slate-800/90 rounded-2xl border border-slate-200/80 dark:border-slate-700/50 p-6">
                <div className="flex justify-between items-center mb-6">
                    <Skeleton className="h-6 w-40" />
                    <div className="flex gap-2">
                        <Skeleton className="h-8 w-20" rounded="lg" />
                        <Skeleton className="h-8 w-20" rounded="lg" />
                    </div>
                </div>
                <Skeleton className="h-64 w-full" rounded="lg" />
            </div>
        </div>
    );
}

/**
 * DashboardPageSkeleton - Widgets grid for desktop dashboard
 */
export function DashboardPageSkeleton({ className }: { className?: string }) {
    return (
        <div className={cn("space-y-6", className)}>
            {/* Header */}
            <div className="flex justify-between items-center">
                <div className="space-y-2">
                    <Skeleton className="h-8 w-48" />
                    <Skeleton className="h-4 w-64" />
                </div>
                <Skeleton className="h-10 w-32" rounded="lg" />
            </div>

            {/* Widgets grid */}
            <div className="grid grid-cols-3 gap-6">
                {Array.from({ length: 6 }).map((_, i) => (
                    <CardSkeleton key={i} className={i === 0 ? "col-span-2" : ""} />
                ))}
            </div>
        </div>
    );
}
