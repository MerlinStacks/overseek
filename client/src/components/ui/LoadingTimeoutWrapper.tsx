/**
 * LoadingTimeoutWrapper Component
 * 
 * EDGE CASE FIX: Handle skeleton infinite loading in offline mode.
 * Wraps loading skeletons and shows an offline/timeout message
 * when loading takes too long.
 */

import { ReactNode } from 'react';
import { WifiOff, RefreshCw, AlertCircle } from 'lucide-react';
import { useLoadingTimeout } from '../../hooks/useLoadingTimeout';

interface LoadingTimeoutWrapperProps {
    /** Whether content is currently loading */
    isLoading: boolean;
    /** The skeleton/loading component to show while loading */
    skeleton: ReactNode;
    /** The actual content to show when loaded */
    children: ReactNode;
    /** Timeout in milliseconds before showing offline message (default: 10000ms) */
    timeoutMs?: number;
    /** Callback to retry loading */
    onRetry?: () => void;
}

/**
 * Wraps loading states with timeout detection and offline-aware messaging.
 * 
 * @example
 * ```tsx
 * <LoadingTimeoutWrapper
 *     isLoading={isLoading}
 *     skeleton={<TableSkeleton rows={5} />}
 *     onRetry={() => refetch()}
 * >
 *     <DataTable data={data} />
 * </LoadingTimeoutWrapper>
 * ```
 */
export function LoadingTimeoutWrapper({
    isLoading,
    skeleton,
    children,
    timeoutMs = 10000,
    onRetry
}: LoadingTimeoutWrapperProps) {
    const { hasTimedOut, isOffline, message } = useLoadingTimeout({
        isLoading,
        timeoutMs
    });

    // Show content when not loading
    if (!isLoading) {
        return <>{children}</>;
    }

    // Show timeout/offline message after timeout
    if (hasTimedOut) {
        return (
            <div className="flex flex-col items-center justify-center p-8 text-center">
                <div className="w-16 h-16 rounded-full bg-slate-800/50 flex items-center justify-center mb-4">
                    {isOffline ? (
                        <WifiOff className="w-8 h-8 text-amber-500" />
                    ) : (
                        <AlertCircle className="w-8 h-8 text-amber-500" />
                    )}
                </div>
                <h3 className="text-lg font-medium text-slate-200 mb-2">
                    {isOffline ? 'You\'re Offline' : 'Loading Issue'}
                </h3>
                <p className="text-sm text-slate-400 mb-4 max-w-md">
                    {message}
                </p>
                {onRetry && (
                    <button
                        onClick={onRetry}
                        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors"
                    >
                        <RefreshCw className="w-4 h-4" />
                        Try Again
                    </button>
                )}
            </div>
        );
    }

    // Show skeleton while loading (before timeout)
    return <>{skeleton}</>;
}
