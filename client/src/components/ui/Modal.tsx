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
        if (isOpen) {
            setIsVisible(true);
        } else {
            // Small delay for fade-out if we were to implement exit animations strictly,
            // but for now we'll just unmount after a tiny delay or immediately.
            // keeping it simple for now to match current patterns.
            setIsVisible(false);
        }
    }, [isOpen]);

    if (!isOpen && !isVisible) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 animate-in fade-in duration-200">
            {/* Backdrop click to close */}
            <div className="absolute inset-0" onClick={onClose} />

            <div className={`bg-white rounded-2xl shadow-2xl w-full ${maxWidth} overflow-hidden border border-gray-100 flex flex-col max-h-[90vh] relative z-10 animate-in zoom-in-95 duration-200`}>

                {/* Header */}
                {(title || onClose) && (
                    <div className="p-5 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
                        <div className="font-bold text-gray-900 text-lg">
                            {title}
                        </div>
                        {onClose && (
                            <button
                                onClick={onClose}
                                className="p-2 hover:bg-gray-100 rounded-full text-gray-400 hover:text-gray-600 transition-colors"
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
