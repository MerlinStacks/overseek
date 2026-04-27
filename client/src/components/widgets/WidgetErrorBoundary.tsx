import { Component, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { widgetCardClass } from './widgetStyles';

interface Props {
    children: ReactNode;
    widgetKey: string;
}

interface State {
    hasError: boolean;
    error: Error | null;
}

/**
 * Catches render errors and chunk-load failures in lazy-loaded widgets.
 * Isolates failures to a single widget instead of crashing the whole dashboard.
 */
export class WidgetErrorBoundary extends Component<Props, State> {
    state: State = { hasError: false, error: null };

    static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    handleRetry = () => {
        this.setState({ hasError: false, error: null });
    };

    render() {
        if (this.state.hasError) {
            const isChunkError = this.state.error?.message?.includes('Loading chunk') ||
                this.state.error?.message?.includes('dynamically imported module');

            return (
                <div className={`${widgetCardClass} h-full flex flex-col items-center justify-center gap-3 p-4`}>
                    <div className="p-2 bg-red-50 dark:bg-red-500/10 rounded-full">
                        <AlertTriangle className="w-5 h-5 text-red-500 dark:text-red-400" />
                    </div>
                    <p className="text-sm font-medium text-slate-700 dark:text-slate-300 text-center">
                        {isChunkError ? 'Failed to load widget' : 'Widget crashed'}
                    </p>
                    <p className="text-xs text-slate-400 dark:text-slate-500 text-center max-w-[200px]">
                        {isChunkError
                            ? 'Network error or new deployment. Try refreshing.'
                            : `Error in "${this.props.widgetKey}"`
                        }
                    </p>
                    <button
                        onClick={this.handleRetry}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-500/20 transition-colors"
                    >
                        <RefreshCw className="w-3 h-3" />
                        Retry
                    </button>
                </div>
            );
        }
        return this.props.children;
    }
}
