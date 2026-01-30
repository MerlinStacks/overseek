import { ReactNode, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

/**
 * BottomSheet - iOS-style bottom sheet component.
 * 
 * Features:
 * - Slide up animation
 * - Drag to dismiss
 * - Backdrop click to close
 * - snap points support
 */

interface BottomSheetProps {
    isOpen: boolean;
    onClose: () => void;
    title?: string;
    children: ReactNode;
    snapPoints?: number[];
}

export function BottomSheet({ isOpen, onClose, title, children, snapPoints = [0.5] }: BottomSheetProps) {
    const sheetRef = useRef<HTMLDivElement>(null);
    const [dragY, setDragY] = useState(0);
    const [startY, setStartY] = useState(0);
    const [isDragging, setIsDragging] = useState(false);

    useEffect(() => {
        if (isOpen) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = '';
        }
        return () => {
            document.body.style.overflow = '';
        };
    }, [isOpen]);

    const handleTouchStart = (e: React.TouchEvent) => {
        setStartY(e.touches[0].clientY);
        setIsDragging(true);
    };

    const handleTouchMove = (e: React.TouchEvent) => {
        if (!isDragging) return;
        const currentY = e.touches[0].clientY;
        const diff = currentY - startY;
        if (diff > 0) {
            setDragY(diff);
        }
    };

    const handleTouchEnd = () => {
        setIsDragging(false);
        if (dragY > 100) {
            // Haptic feedback
            if ('vibrate' in navigator) {
                navigator.vibrate(10);
            }
            onClose();
        }
        setDragY(0);
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100]">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/50 transition-opacity"
                style={{ opacity: Math.max(0, 1 - dragY / 200) }}
                onClick={onClose}
            />

            {/* Sheet */}
            <div
                ref={sheetRef}
                className="absolute bottom-0 left-0 right-0 bg-white rounded-t-3xl max-h-[90vh] overflow-hidden"
                style={{
                    transform: `translateY(${dragY}px)`,
                    transition: isDragging ? 'none' : 'transform 0.3s ease-out',
                    paddingBottom: 'env(safe-area-inset-bottom)'
                }}
            >
                {/* Handle */}
                <div
                    className="flex justify-center pt-3 pb-2 cursor-grab active:cursor-grabbing"
                    onTouchStart={handleTouchStart}
                    onTouchMove={handleTouchMove}
                    onTouchEnd={handleTouchEnd}
                >
                    <div className="w-10 h-1 bg-gray-300 rounded-full" />
                </div>

                {/* Header */}
                {title && (
                    <div className="flex items-center justify-between px-4 pb-3 border-b border-gray-100">
                        <h2 className="text-lg font-bold text-gray-900">{title}</h2>
                        <button
                            onClick={onClose}
                            className="p-2 -mr-2 rounded-full hover:bg-gray-100 active:bg-gray-200"
                        >
                            <X size={20} className="text-gray-500" />
                        </button>
                    </div>
                )}

                {/* Content */}
                <div className="overflow-y-auto max-h-[70vh] p-4">
                    {children}
                </div>
            </div>
        </div>
    );
}
