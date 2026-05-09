import { CardSkeleton, Skeleton, SkeletonAvatar, SkeletonText, TableSkeleton } from './Skeleton';

export function DashboardPageSkeleton() {
    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
                <Skeleton className="h-8 w-56" />
                <div className="flex items-center gap-2">
                    <Skeleton className="h-9 w-28" rounded="lg" />
                    <Skeleton className="h-9 w-10" rounded="lg" />
                </div>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                {Array.from({ length: 4 }).map((_, i) => (
                    <CardSkeleton key={i} />
                ))}
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
                <div className="lg:col-span-8 bg-white dark:bg-slate-800/90 rounded-2xl border border-slate-200/80 dark:border-slate-700/50 p-6">
                    <Skeleton className="h-5 w-40 mb-4" />
                    <Skeleton className="h-64 w-full" rounded="lg" />
                </div>
                <div className="lg:col-span-4 bg-white dark:bg-slate-800/90 rounded-2xl border border-slate-200/80 dark:border-slate-700/50 p-6 space-y-4">
                    <Skeleton className="h-5 w-32" />
                    <SkeletonText lines={4} />
                    <Skeleton className="h-40 w-full" rounded="lg" />
                </div>
            </div>
        </div>
    );
}

export function OrderDetailPageSkeleton() {
    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                    <Skeleton className="h-9 w-9" rounded="lg" />
                    <div className="space-y-2">
                        <Skeleton className="h-6 w-48" />
                        <Skeleton className="h-4 w-32" />
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <Skeleton className="h-9 w-24" rounded="lg" />
                    <Skeleton className="h-9 w-24" rounded="lg" />
                </div>
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                <div className="lg:col-span-2 space-y-6">
                    <div className="bg-white dark:bg-slate-800/90 rounded-2xl border border-slate-200/80 dark:border-slate-700/50 p-6">
                        <Skeleton className="h-5 w-40 mb-4" />
                        <div className="grid grid-cols-2 gap-4">
                            <Skeleton className="h-20" rounded="lg" />
                            <Skeleton className="h-20" rounded="lg" />
                            <Skeleton className="h-20" rounded="lg" />
                            <Skeleton className="h-20" rounded="lg" />
                        </div>
                    </div>
                    <div className="bg-white dark:bg-slate-800/90 rounded-2xl border border-slate-200/80 dark:border-slate-700/50 overflow-hidden">
                        <div className="p-6 border-b border-slate-200/80 dark:border-slate-700/50">
                            <Skeleton className="h-5 w-44" />
                        </div>
                        <div className="p-6">
                            <table className="w-full">
                                <tbody>
                                    <TableSkeleton rows={4} columns={4} />
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
                <div className="space-y-6">
                    <div className="bg-white dark:bg-slate-800/90 rounded-2xl border border-slate-200/80 dark:border-slate-700/50 p-6">
                        <Skeleton className="h-5 w-28 mb-4" />
                        <SkeletonText lines={3} />
                    </div>
                    <div className="bg-white dark:bg-slate-800/90 rounded-2xl border border-slate-200/80 dark:border-slate-700/50 p-6">
                        <Skeleton className="h-5 w-32 mb-4" />
                        <div className="space-y-3">
                            {Array.from({ length: 3 }).map((_, i) => (
                                <div key={i} className="flex items-center gap-3">
                                    <SkeletonAvatar size="sm" />
                                    <Skeleton className="h-4 w-full" />
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

export function PoliciesPageSkeleton() {
    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <Skeleton className="h-8 w-40" />
                <Skeleton className="h-9 w-28" rounded="lg" />
            </div>
            <div className="bg-white dark:bg-slate-800/90 rounded-2xl border border-slate-200/80 dark:border-slate-700/50 overflow-hidden">
                <div className="p-6 border-b border-slate-200/80 dark:border-slate-700/50">
                    <Skeleton className="h-5 w-44" />
                </div>
                <div className="p-6">
                    <table className="w-full">
                        <tbody>
                            <TableSkeleton rows={5} columns={4} />
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}

export function SettingsPageSkeleton() {
    return (
        <div className="min-h-[calc(100vh-6rem)] space-y-6">
            <Skeleton className="h-8 w-40" />

            <div className="hidden lg:flex gap-8">
                <aside className="w-64 shrink-0 space-y-6">
                    {Array.from({ length: 3 }).map((_, groupIndex) => (
                        <div key={groupIndex} className="space-y-3">
                            <Skeleton className="h-3 w-20" />
                            <div className="space-y-2">
                                {Array.from({ length: 4 }).map((_, itemIndex) => (
                                    <div key={itemIndex} className="flex items-center gap-3">
                                        <Skeleton className="h-8 w-8" rounded="md" />
                                        <Skeleton className="h-4 w-32" />
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                </aside>
                <section className="flex-1 space-y-6">
                    <div className="bg-white dark:bg-slate-800/90 rounded-2xl border border-slate-200/80 dark:border-slate-700/50 p-6">
                        <Skeleton className="h-5 w-52 mb-4" />
                        <SkeletonText lines={4} />
                        <div className="mt-6 grid grid-cols-2 gap-4">
                            <Skeleton className="h-20" rounded="lg" />
                            <Skeleton className="h-20" rounded="lg" />
                        </div>
                    </div>
                </section>
            </div>

            <div className="lg:hidden space-y-4">
                <div className="flex gap-2 overflow-x-auto">
                    {Array.from({ length: 4 }).map((_, i) => (
                        <Skeleton key={i} className="h-8 w-24" rounded="full" />
                    ))}
                </div>
                <div className="bg-white dark:bg-slate-800/90 rounded-2xl border border-slate-200/80 dark:border-slate-700/50 p-6">
                    <Skeleton className="h-5 w-44 mb-4" />
                    <SkeletonText lines={5} />
                </div>
            </div>
        </div>
    );
}

export function TeamPageSkeleton() {
    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <Skeleton className="h-8 w-40" />
                <Skeleton className="h-9 w-32" rounded="lg" />
            </div>
            <div className="bg-white dark:bg-slate-800/90 rounded-2xl border border-slate-200/80 dark:border-slate-700/50 overflow-hidden">
                <div className="p-6 border-b border-slate-200/80 dark:border-slate-700/50">
                    <Skeleton className="h-5 w-40" />
                </div>
                <div className="p-6">
                    <table className="w-full">
                        <tbody>
                            <TableSkeleton rows={5} columns={5} showAvatar />
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
