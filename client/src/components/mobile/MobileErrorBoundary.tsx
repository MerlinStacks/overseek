import { Component, ReactNode } from 'react';
import { WifiOff, RefreshCw, Home } from 'lucide-react';
import * as Sentry from '@sentry/react';

/**
 * MobileErrorBoundary - Catches React errors in mobile pages and displays a friendly fallback.
 * 
 * Features:
 * - Prevents blank screens on component crashes
 * - Provides retry and home navigation options
 * - Logs errors to console (extend to send to monitoring service)
 */

interface Props {
    children: ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
}

export class MobileErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
        // Log error for debugging
        console.error('[MobileErrorBoundary] Caught error:', error);
        console.error('[MobileErrorBoundary] Error info:', errorInfo.componentStack);

        // Send to error monitoring service (e.g., Sentry)
        Sentry.captureException(error, { extra: errorInfo });
    }

    handleRetry = (): void => {
        this.setState({ hasError: false, error: null });
    };

    handleGoHome = (): void => {
        window.location.href = '/m/dashboard';
    };

    render(): ReactNode {
        if (this.state.hasError) {
            return (
                <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-6">
                    <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center mb-6">
                        <WifiOff size={40} className="text-red-500" />
                    </div>

                    <h1 className="text-xl font-bold text-gray-900 mb-2 text-center">
                        Something went wrong
                    </h1>

                    <p className="text-gray-500 text-center mb-8 max-w-xs">
                        We're sorry, but something unexpected happened. Please try again.
                    </p>

                    <div className="flex gap-3">
                        <button
                            onClick={this.handleRetry}
                            className="flex items-center gap-2 px-5 py-3 bg-indigo-600 text-white rounded-xl font-medium active:scale-95 transition-transform"
                        >
                            <RefreshCw size={18} />
                            Try Again
                        </button>

                        <button
                            onClick={this.handleGoHome}
                            className="flex items-center gap-2 px-5 py-3 bg-gray-200 text-gray-700 rounded-xl font-medium active:scale-95 transition-transform"
                        >
                            <Home size={18} />
                            Home
                        </button>
                    </div>

                    {process.env.NODE_ENV === 'development' && this.state.error && (
                        <div className="mt-8 p-4 bg-gray-100 rounded-xl max-w-sm">
                            <p className="text-xs font-mono text-red-600 break-all">
                                {this.state.error.message}
                            </p>
                        </div>
                    )}
                </div>
            );
        }

        return this.props.children;
    }
}
