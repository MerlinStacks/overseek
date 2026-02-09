import { useSyncStatus, SyncToast } from '../../context/SyncStatusContext';
import { CheckCircle, XCircle, RefreshCw, X } from 'lucide-react';

const TOAST_ICONS: Record<SyncToast['type'], React.ElementType> = {
    success: CheckCircle,
    error: XCircle,
    info: RefreshCw,
};

const TOAST_STYLES: Record<SyncToast['type'], string> = {
    success: 'border-green-200 dark:border-green-500/30 bg-green-50 dark:bg-green-500/10 text-green-800 dark:text-green-300',
    error: 'border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 text-red-800 dark:text-red-300',
    info: 'border-blue-200 dark:border-blue-500/30 bg-blue-50 dark:bg-blue-500/10 text-blue-800 dark:text-blue-300',
};

const ICON_STYLES: Record<SyncToast['type'], string> = {
    success: 'text-green-500 dark:text-green-400',
    error: 'text-red-500 dark:text-red-400',
    info: 'text-blue-500 dark:text-blue-400 animate-spin',
};

/**
 * Floating overlay that renders sync event toasts in the bottom-right corner.
 * Mounted inside SyncStatusProvider so it's visible app-wide.
 */
export function SyncToastOverlay() {
    const { syncToasts, dismissSyncToast } = useSyncStatus();

    if (syncToasts.length === 0) return null;

    return (
        <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2 pointer-events-none">
            {syncToasts.map(toast => {
                const Icon = TOAST_ICONS[toast.type];
                return (
                    <div
                        key={toast.id}
                        className={`
                            pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-xl
                            border shadow-lg backdrop-blur-sm min-w-[280px] max-w-[380px]
                            animate-in slide-in-from-bottom-3 fade-in duration-300
                            ${TOAST_STYLES[toast.type]}
                        `}
                    >
                        <Icon size={16} className={ICON_STYLES[toast.type]} />
                        <span className="text-sm font-medium flex-1">{toast.message}</span>
                        <button
                            onClick={() => dismissSyncToast(toast.id)}
                            className="opacity-50 hover:opacity-100 transition-opacity p-0.5"
                        >
                            <X size={14} />
                        </button>
                    </div>
                );
            })}
        </div>
    );
}
