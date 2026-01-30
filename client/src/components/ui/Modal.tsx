import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
    isOpen: boolean;
    onClose?: () => void;
    title?: React.ReactNode;
    children: React.ReactNode;
    maxWidth?: string;
}

export function Modal({ isOpen, onClose, title, children, maxWidth = 'max-w-lg' }: ModalProps) {
    const [isVisible, setIsVisible] = useState(false);

    useEffect(() => {
        // Defer state update to avoid cascading renders
        const timeoutId = setTimeout(() => {
            if (isOpen) {
                setIsVisible(true);
            } else {
                // Small delay for fade-out if we were to implement exit animations strictly,
                // but for now we'll just unmount after a tiny delay or immediately.
                // keeping it simple for now to match current patterns.
                setIsVisible(false);
            }
        }, 0);
        return () => clearTimeout(timeoutId);
    }, [isOpen]);

    if (!isOpen && !isVisible) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
            {/* Backdrop with stronger blur */}
            <div
                className="absolute inset-0 bg-slate-900/40 dark:bg-slate-950/60 backdrop-blur-md"
                onClick={onClose}
            />

            <div className={`bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full ${maxWidth} overflow-hidden border border-slate-200/80 dark:border-slate-700/50 flex flex-col max-h-[90vh] relative z-10 animate-in zoom-in-95 duration-200`}>

                {/* Header with subtle gradient */}
                {(title || onClose) && (
                    <div className="p-5 border-b border-slate-100 dark:border-slate-700/50 flex justify-between items-center bg-gradient-to-r from-slate-50 to-slate-100/50 dark:from-slate-800 dark:to-slate-800">
                        <div className="font-bold text-slate-900 dark:text-white text-lg">
                            {title}
                        </div>
                        {onClose && (
                            <button
                                onClick={onClose}
                                className="p-2 hover:bg-slate-200/80 dark:hover:bg-slate-700 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-all duration-200"
                            >
                                <X size={20} />
                            </button>
                        )}
                    </div>
                )}

                {/* Body */}
                <div className="p-6 overflow-y-auto custom-scrollbar">
                    {children}
                </div>
            </div>
        </div>
    );
}
