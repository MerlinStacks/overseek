import { useEffect } from 'react';
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
    useEffect(() => {
        if (isVisible) {
            const timer = setTimeout(() => {
                onClose();
            }, duration);
            return () => clearTimeout(timer);
        }
    }, [isVisible, duration, onClose]);

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
        <div className="fixed bottom-6 right-6 z-50 animate-in slide-in-from-bottom-5 fade-in duration-300">
            <div className={`${bgColors[type]} text-white px-4 py-3 rounded-lg shadow-lg flex items-center gap-3 min-w-[300px]`}>
                <div className={`${iconBgColors[type]} rounded-full p-1`}>
                    {icons[type]}
                </div>
                <span className="font-medium text-sm flex-1">{message}</span>
                <button onClick={onClose} className="text-gray-400 hover:text-white ml-2 transition-colors">
                    <X size={16} />
                </button>
            </div>
        </div>
    );
}
