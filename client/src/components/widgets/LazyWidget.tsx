/**
 * LazyWidget Component
 * 
 * Suspense wrapper for lazy-loaded dashboard widgets with a skeleton loading state.
 * Enables code-splitting so heavy widgets (like charts with echarts) only load when used.
 */

import { Suspense, ComponentType } from 'react';
import { Loader2 } from 'lucide-react';

interface WidgetProps {
    settings?: any;
    className?: string;
    dateRange: { startDate: string; endDate: string };
    comparison?: { startDate: string; endDate: string } | null;
}

interface LazyWidgetProps extends WidgetProps {
    component: ComponentType<WidgetProps>;
}

/**
 * Skeleton loading state for widgets.
 * Matches the card-premium styling to prevent layout shift.
 */
function WidgetSkeleton() {
    return (
        <div className="card-premium h-full flex items-center justify-center">
            <div className="flex flex-col items-center gap-2 text-slate-400">
                <Loader2 className="animate-spin" size={24} />
                <span className="text-xs">Loading widget...</span>
            </div>
        </div>
    );
}

/**
 * Wraps a lazy-loaded widget component with Suspense boundary.
 */
export function LazyWidget({ component: Component, ...props }: LazyWidgetProps) {
    return (
        <Suspense fallback={<WidgetSkeleton />}>
            <Component {...props} />
        </Suspense>
    );
}

export default LazyWidget;
