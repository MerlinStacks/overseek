import { Component, ErrorInfo, ReactNode } from 'react';
import { Logger } from '../../utils/logger';
import { isChunkLoadError, handleChunkLoadError } from '../../utils/deploymentRecovery';
import { AlertCircle, RotateCw, RefreshCw } from 'lucide-react';

interface Props {
    children?: ReactNode;
    /** Custom fallback UI to render on error */
    fallback?: ReactNode;
    /** Callback when error occurs (for analytics/logging) */
    onError?: (error: Error, errorInfo: ErrorInfo) => void;
    /** Callback when user attempts reset */
    onReset?: () => void;
    /** Allow soft reset (retry without reload). Default: true */
    allowSoftReset?: boolean;
    /** Max soft reset attempts before forcing full reload. Default: 3 */
    maxSoftResets?: number;
}

interface State {
    hasError: boolean;
    error: Error | null;
    softResetCount: number;
}

/**
 * ErrorBoundary - Catches React errors and displays a recovery UI.
 * 
 * Features:
 * - Soft reset: Retry rendering without page reload (up to maxSoftResets)
 * - Hard reset: Full page reload after soft reset limit
 * - Chunk load error detection: Auto-reload on stale deployment
 * - Customizable fallback and callbacks
 * 
 * @example
 * // Basic usage (wraps a page or component)
 * <ErrorBoundary>
 *   <MyComponent />
 * </ErrorBoundary>
 * 
 * @example
 * // With custom recovery
 * <ErrorBoundary 
 *   onReset={() => queryClient.invalidateQueries()}
 *   maxSoftResets={2}
 * >
 *   <DataTable />
 * </ErrorBoundary>
 */
export class ErrorBoundary extends Component<Props, State> {
    public state: State = {
        hasError: false,
        error: null,
        softResetCount: 0
    };

    public static getDerivedStateFromError(error: Error): Partial<State> {
        return { hasError: true, error };
    }

    public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        Logger.error('ErrorBoundary caught error:', {
            error: error.message,
            stack: error.stack,
            componentStack: errorInfo.componentStack
        });

        // Notify parent if callback provided
        this.props.onError?.(error, errorInfo);

        // Auto-reload on chunk load errors (stale deployment cache)
        if (isChunkLoadError(error)) {
            handleChunkLoadError(error);
            return; // Skip normal error handling, will reload
        }
    }

    private handleSoftReset = () => {
        const { onReset, maxSoftResets = 3 } = this.props;
        const { softResetCount } = this.state;

        // If exceeded soft reset limit, do hard reset
        if (softResetCount >= maxSoftResets) {
            this.handleHardReset();
            return;
        }

        // Execute custom reset logic
        onReset?.();

        // Clear error state and increment counter
        this.setState(prev => ({
            hasError: false,
            error: null,
            softResetCount: prev.softResetCount + 1
        }));
    };

    private handleHardReset = () => {
        window.location.reload();
    };

    public render() {
        const { allowSoftReset = true, maxSoftResets = 3 } = this.props;
        const { hasError, error, softResetCount } = this.state;

        if (hasError) {
            if (this.props.fallback) {
                return this.props.fallback;
            }

            const canSoftReset = allowSoftReset && softResetCount < maxSoftResets;

            return (
                <div className="p-6 rounded-xl border border-red-200 bg-red-50 dark:bg-red-900/20 dark:border-red-800/50 text-red-900 dark:text-red-200 flex flex-col items-center justify-center text-center space-y-4 shadow-sm">
                    <div className="p-3 bg-red-100 dark:bg-red-800/30 rounded-full">
                        <AlertCircle className="w-8 h-8 text-red-600 dark:text-red-400" />
                    </div>
                    <div>
                        <h3 className="text-lg font-semibold text-red-800 dark:text-red-300">Something went wrong</h3>
                        <p className="text-sm text-red-600 dark:text-red-400 mt-2 max-w-md">
                            {error?.message || 'An unexpected error occurred while rendering this component.'}
                        </p>
                    </div>
                    <div className="flex gap-3">
                        {canSoftReset && (
                            <button
                                onClick={this.handleSoftReset}
                                className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-700 text-red-600 dark:text-red-300 border border-red-300 dark:border-red-600 rounded-lg hover:bg-red-50 dark:hover:bg-slate-600 transition-colors shadow-sm"
                            >
                                <RefreshCw size={16} />
                                Try Again
                            </button>
                        )}
                        <button
                            onClick={this.handleHardReset}
                            className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors shadow-sm"
                        >
                            <RotateCw size={16} />
                            Reload Page
                        </button>
                    </div>
                    {softResetCount > 0 && (
                        <p className="text-xs text-red-400 dark:text-red-500">
                            Retry attempts: {softResetCount}/{maxSoftResets}
                        </p>
                    )}
                    <p className="text-xs text-red-400 dark:text-red-500 mt-2">
                        If this persists, please contact support.
                    </p>
                </div>
            );
        }

        return this.props.children;
    }
}

