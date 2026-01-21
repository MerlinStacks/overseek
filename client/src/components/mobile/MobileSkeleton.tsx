/**
 * MobileSkeleton - Premium shimmer loading states for mobile PWA.
 * 
 * Features:
 * - Gradient shimmer animation
 * - Multiple preset configurations
 * - Glassmorphism wrapper
 */

interface SkeletonProps {
    className?: string;
    variant?: 'text' | 'circle' | 'rect';
    width?: string | number;
    height?: string | number;
}

export function Skeleton({ className = '', variant = 'rect', width, height }: SkeletonProps) {
    const baseClasses = 'animate-shimmer bg-gradient-to-r from-slate-700 via-slate-600 to-slate-700 bg-[length:200%_100%]';

    const variantClasses = {
        text: 'h-4 rounded',
        circle: 'rounded-full',
        rect: 'rounded-xl'
    };

    return (
        <div
            className={`${baseClasses} ${variantClasses[variant]} ${className}`}
            style={{ width, height }}
        />
    );
}

export function DashboardSkeleton() {
    return (
        <div className="space-y-6 animate-fade-in">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="space-y-2">
                    <Skeleton className="h-8 w-32" />
                    <Skeleton className="h-4 w-48" />
                </div>
                <Skeleton variant="circle" width={40} height={40} />
            </div>

            {/* Stat Cards */}
            <div className="grid grid-cols-2 gap-3">
                {[...Array(4)].map((_, i) => (
                    <div
                        key={i}
                        className="bg-slate-800/50 backdrop-blur-sm border border-white/10 rounded-2xl p-4 space-y-3"
                    >
                        <Skeleton variant="circle" width={32} height={32} />
                        <Skeleton className="h-8 w-20" />
                        <Skeleton className="h-4 w-16" />
                        <Skeleton className="h-8 w-full" />
                    </div>
                ))}
            </div>

            {/* Quick Actions */}
            <div className="space-y-3">
                <Skeleton className="h-4 w-24" />
                <div className="grid grid-cols-4 gap-3">
                    {[...Array(4)].map((_, i) => (
                        <div key={i} className="flex flex-col items-center gap-2">
                            <Skeleton className="h-12 w-12" />
                            <Skeleton className="h-3 w-10" />
                        </div>
                    ))}
                </div>
            </div>

            {/* Activity List */}
            <div className="space-y-3">
                <Skeleton className="h-4 w-32" />
                <div className="bg-slate-800/50 backdrop-blur-sm border border-white/10 rounded-2xl divide-y divide-white/5">
                    {[...Array(4)].map((_, i) => (
                        <div key={i} className="p-4 flex items-center gap-3">
                            <Skeleton variant="circle" width={40} height={40} />
                            <div className="flex-1 space-y-2">
                                <Skeleton className="h-4 w-32" />
                                <Skeleton className="h-3 w-24" />
                            </div>
                            <Skeleton className="h-3 w-12" />
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

export function ListSkeleton({ count = 5 }: { count?: number }) {
    return (
        <div className="space-y-3 animate-fade-in">
            {[...Array(count)].map((_, i) => (
                <div
                    key={i}
                    className="bg-slate-800/50 backdrop-blur-sm border border-white/10 rounded-2xl p-4 flex items-center gap-3"
                >
                    <Skeleton variant="circle" width={44} height={44} />
                    <div className="flex-1 space-y-2">
                        <Skeleton className="h-4 w-3/4" />
                        <Skeleton className="h-3 w-1/2" />
                    </div>
                    <Skeleton className="h-6 w-16 rounded-full" />
                </div>
            ))}
        </div>
    );
}

/**
 * OrdersSkeleton - Loading skeleton for orders list page.
 * Matches the MobileOrders layout with search, filters, and order cards.
 */
export function OrdersSkeleton() {
    return (
        <div className="space-y-4 animate-fade-in">
            {/* Search Bar */}
            <div className="bg-slate-800/50 backdrop-blur-sm border border-white/10 rounded-2xl p-3">
                <Skeleton className="h-10 w-full rounded-xl" />
            </div>

            {/* Filter Pills */}
            <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
                {['All', 'Pending', 'Processing', 'Shipped', 'Completed'].map((_, i) => (
                    <Skeleton
                        key={i}
                        className="h-8 flex-shrink-0 rounded-full"
                        width={i === 0 ? 50 : 80}
                    />
                ))}
            </div>

            {/* Order Cards */}
            <div className="space-y-3">
                {[...Array(5)].map((_, i) => (
                    <div
                        key={i}
                        className="bg-slate-800/50 backdrop-blur-sm border border-white/10 rounded-2xl p-4"
                        style={{ animationDelay: `${i * 50}ms` }}
                    >
                        <div className="flex items-start justify-between mb-3">
                            <div className="flex items-center gap-3">
                                <Skeleton className="h-10 w-10 rounded-xl" />
                                <div className="space-y-1.5">
                                    <Skeleton className="h-4 w-24" />
                                    <Skeleton className="h-3 w-32" />
                                </div>
                            </div>
                            <Skeleton className="h-6 w-20 rounded-full" />
                        </div>
                        <div className="flex items-center justify-between pt-3 border-t border-white/5">
                            <Skeleton className="h-3 w-16" />
                            <Skeleton className="h-5 w-20" />
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

/**
 * InboxSkeleton - Loading skeleton for inbox/chat list.
 */
export function InboxSkeleton() {
    return (
        <div className="min-h-full flex flex-col space-y-4 animate-fade-in">
            {/* Header */}
            <div className="flex items-center justify-between">
                <Skeleton className="h-6 w-24" />
                <Skeleton className="h-9 w-9 rounded-xl" />
            </div>

            {/* Search */}
            <Skeleton className="h-11 w-full rounded-xl" />

            {/* Conversation List */}
            <div className="flex-1 space-y-2">
                {[...Array(6)].map((_, i) => (
                    <div
                        key={i}
                        className="bg-slate-800/50 backdrop-blur-sm border border-white/10 rounded-2xl p-4 flex items-center gap-3"
                    >
                        <Skeleton variant="circle" width={48} height={48} />
                        <div className="flex-1 space-y-2">
                            <div className="flex items-center justify-between">
                                <Skeleton className="h-4 w-28" />
                                <Skeleton className="h-3 w-12" />
                            </div>
                            <Skeleton className="h-3 w-full" />
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
