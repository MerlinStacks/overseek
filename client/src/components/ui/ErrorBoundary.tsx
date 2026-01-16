import { Component, ErrorInfo, ReactNode } from 'react';
import { Logger } from '../../utils/logger';
import { AlertCircle, RotateCw } from 'lucide-react';

interface Props {
    children?: ReactNode;
    fallback?: ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
    public state: State = {
        hasError: false,
        error: null
    };

    public static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error('Uncaught error:', error, errorInfo);
    }

    private handleRetry = () => {
        this.setState({ hasError: false, error: null });
        window.location.reload();
    };

    public render() {
        if (this.state.hasError) {
            if (this.props.fallback) {
                return this.props.fallback;
            }

            return (
                <div className="p-6 rounded-xl border border-red-200 bg-red-50 text-red-900 flex flex-col items-center justify-center text-center space-y-4 shadow-sm">
                    <div className="p-3 bg-red-100 rounded-full">
                        <AlertCircle className="w-8 h-8 text-red-600" />
                    </div>
                    <div>
                        <h3 className="text-lg font-semibold text-red-800">Something went wrong</h3>
                        <p className="text-sm text-red-600 mt-2 max-w-md">
                            {this.state.error?.message || 'An unexpected error occurred while rendering this component.'}
                        </p>
                    </div>
                    <button
                        onClick={this.handleRetry}
                        className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors shadow-sm"
                    >
                        <RotateCw size={16} />
                        Reload Page
                    </button>
                    <p className="text-xs text-red-400 mt-4">
                        If this persists, please contact support.
                    </p>
                </div>
            );
        }

        return this.props.children;
    }
}
