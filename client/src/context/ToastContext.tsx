import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import { type ToastType } from '../components/ui/Toast';
import { Check, X, AlertCircle } from 'lucide-react';
/* eslint-disable react-refresh/only-export-components */

interface ToastItem {
    id: number;
    message: string;
    type: ToastType;
    duration: number;
}

interface ToastContextValue {
    toast: (message: string, type?: ToastType, duration?: number) => void;
    success: (message: string) => void;
    error: (message: string) => void;
    info: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const MAX_TOASTS = 5;
let nextId = 0;

/** Self-contained toast item that manages its own auto-dismiss timer */
function ToastEntry({ item, onRemove }: { item: ToastItem; onRemove: (id: number) => void }) {
    useEffect(() => {
        const timer = setTimeout(() => onRemove(item.id), item.duration);
        return () => clearTimeout(timer);
    }, [item.id, item.duration, onRemove]);

    const bgColors = { success: 'bg-gray-900', error: 'bg-red-600', info: 'bg-blue-600' };
    const iconBgColors = { success: 'bg-green-500', error: 'bg-white/20', info: 'bg-white/20' };
    const icons = {
        success: <Check size={12} className="text-white" />,
        error: <AlertCircle size={12} className="text-white" />,
        info: <AlertCircle size={12} className="text-white" />,
    };

    return (
        <div className="animate-in slide-in-from-bottom-5 fade-in duration-300" role="alert">
            <div className={`${bgColors[item.type]} text-white px-4 py-3 rounded-lg shadow-lg flex items-center gap-3 min-w-[300px]`}>
                <div className={`${iconBgColors[item.type]} rounded-full p-1`}>
                    {icons[item.type]}
                </div>
                <span className="font-medium text-sm flex-1">{item.message}</span>
                <button onClick={() => onRemove(item.id)} className="text-gray-400 hover:text-white ml-2 transition-colors">
                    <X size={16} />
                </button>
            </div>
        </div>
    );
}

export function ToastProvider({ children }: { children: ReactNode }) {
    const [toasts, setToasts] = useState<ToastItem[]>([]);

    const toast = useCallback((message: string, type: ToastType = 'success', duration = 3000) => {
        const id = ++nextId;
        setToasts(prev => [...prev.slice(-(MAX_TOASTS - 1)), { id, message, type, duration }]);
    }, []);

    const removeToast = useCallback((id: number) => {
        setToasts(prev => prev.filter(t => t.id !== id));
    }, []);

    const success = useCallback((message: string) => toast(message, 'success'), [toast]);
    const error = useCallback((message: string) => toast(message, 'error', 4000), [toast]);
    const info = useCallback((message: string) => toast(message, 'info'), [toast]);

    return (
        <ToastContext.Provider value={{ toast, success, error, info }}>
            {children}
            <div className="fixed bottom-6 right-6 z-50 flex flex-col-reverse gap-2 pointer-events-none">
                {toasts.map(t => (
                    <div key={t.id} className="pointer-events-auto">
                        <ToastEntry item={t} onRemove={removeToast} />
                    </div>
                ))}
            </div>
        </ToastContext.Provider>
    );
}

export function useToast(): ToastContextValue {
    const ctx = useContext(ToastContext);
    if (!ctx) throw new Error('useToast must be used within ToastProvider');
    return ctx;
}
