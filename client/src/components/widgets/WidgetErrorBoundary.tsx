import { Component, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { widgetCardClass } from './widgetStyles';

interface Props {
    children: ReactNode;
    widgetKey: string;
    resetKey?: string;
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

    componentDidUpdate(previous: Props) {
        if (previous.widgetKey !== this.props.widgetKey || previous.resetKey !== this.props.resetKey) {
            this.setState({ hasError: false, error: null });
        }
    }

    handleRetry = () => {
        this.setState({ hasError: false, error: null });
    };

    render() {
        if (this.state.hasError) {
            const isChunkError = this.state.error?.message?.includes('Loading chunk') ||
                this.state.error?.message?.includes('dynamically imported module') ||
                /ChunkLoadError|module script|Importing a module script/i.test(this.state.error?.message ?? '');

            return (
                <div role="alert" className={`${widgetCardClass} h-full flex flex-col items-center justify-center gap-3 p-4`}>
                    <div className="p-2 bg-red-50 dark:bg-red-500/10 rounded-full">
                        <AlertTriangle aria-hidden="true" className="w-5 h-5 text-red-500 dark:text-red-400" />
                    </div>
                    <p className="text-sm font-medium text-slate-700 dark:text-slate-300 text-center">
                        {isChunkError ? 'Failed to load widget' : 'Widget crashed'}
                    </p>
                    <p className="text-xs text-slate-400 dark:text-slate-500 text-center max-w-[200px]">
                        {isChunkError
                            ? 'Network error or new deployment. Reload the page to fetch the widget again.'
                            : `Error in "${this.props.widgetKey}"`
                        }
                    </p>
                    <button
                        type="button"
                        onClick={isChunkError ? () => window.location.reload() : this.handleRetry}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-[var(--brand-subtle)] text-[var(--brand-text)] border border-[var(--brand-border)] hover:underline focus-visible:outline-[var(--focus-color)] transition-colors"
                    >
                        <RefreshCw aria-hidden="true" className="w-3 h-3" />
                        {isChunkError ? 'Reload page' : 'Retry'}
                    </button>
                </div>
            );
        }
        return this.props.children;
    }
}
