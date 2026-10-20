import { useEffect, useRef } from 'react';
import { Check, X, AlertCircle } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'info';

interface ToastProps {
    message: string;
    isVisible: boolean;
    onClose: () => void;
    duration?: number;
    type?: ToastType;
}

export function Toast({ message, isVisible, onClose, duration = 3000, type = 'success' }: ToastProps) {
    const close = useRef(onClose);
    useEffect(() => { close.current = onClose; }, [onClose]);
    useEffect(() => {
        if (isVisible && duration !== 0) {
            const timer = setTimeout(() => {
                close.current();
            }, Number.isFinite(duration) && duration > 0 ? duration : 3000);
            return () => clearTimeout(timer);
        }
    }, [isVisible, duration, message, type]);

    if (!isVisible) return null;

    const bgColors = {
        success: 'bg-gray-900',
        error: 'bg-red-600',
        info: 'bg-blue-600'
    };

    const icons = {
        success: <Check size={12} className="text-white" />,
        error: <AlertCircle size={12} className="text-white" />,
        info: <AlertCircle size={12} className="text-white" />
    };

    const iconBgColors = {
        success: 'bg-green-500',
        error: 'bg-white/20',
        info: 'bg-white/20'
    };

    return (
        <div className="animate-in slide-in-from-bottom-5 fade-in duration-300 motion-reduce:animate-none" role={type === 'error' ? 'alert' : 'status'} aria-atomic="true">
            <div className={`${bgColors[type]} text-white px-4 py-3 rounded-lg shadow-lg flex items-center gap-3 w-full max-w-full`}>
                <div className={`${iconBgColors[type]} rounded-full p-1`}>
                    {icons[type]}
                </div>
                <span className="font-medium text-sm flex-1 min-w-0 break-words">{message}</span>
                <button type="button" aria-label="Dismiss notification" onClick={onClose} className="text-white/80 hover:text-white ml-2 transition-colors">
                    <X size={16} />
                </button>
            </div>
        </div>
    );
}
