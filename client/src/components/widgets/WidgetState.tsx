import { Loader2, AlertCircle } from 'lucide-react';

interface WidgetStateProps {
    message: string;
    className?: string;
}

interface WidgetErrorStateProps extends WidgetStateProps {
    onRetry?: () => void;
}

export function WidgetLoadingState({ message, className = '' }: WidgetStateProps) {
    return (
        <div role="status" className={`flex flex-col items-center justify-center gap-2 py-6 text-slate-500 dark:text-slate-400 ${className}`}>
            <Loader2 aria-hidden="true" className="h-5 w-5 animate-spin motion-reduce:animate-none" />
            <span className="text-sm">{message}</span>
        </div>
    );
}

export function WidgetEmptyState({ message, className = '' }: WidgetStateProps) {
    return (
        <div role="status" className={`flex items-center justify-center py-6 text-sm text-slate-500 dark:text-slate-400 ${className}`}>
            {message}
        </div>
    );
}

export function WidgetErrorState({ message, onRetry, className = '' }: WidgetErrorStateProps) {
    return (
        <div role="alert" className={`flex flex-col items-center justify-center gap-2 py-6 text-slate-500 dark:text-slate-400 ${className}`}>
            <AlertCircle aria-hidden="true" className="h-5 w-5 text-rose-500 dark:text-rose-400" />
            <span className="text-sm text-center">{message}</span>
            {onRetry && (
                <button
                    type="button"
                    onClick={onRetry}
                    className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600"
                >
                    Retry
                </button>
            )}
        </div>
    );
}
