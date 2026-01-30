/**
 * ImageLightbox - Full-screen image preview modal.
 * Features: Keyboard navigation, zoom, download button.
 */
import { useEffect, useCallback } from 'react';
import { X, Download, ZoomIn, ZoomOut } from 'lucide-react';
import { useState } from 'react';

interface ImageLightboxProps {
    src: string;
    onClose: () => void;
}

/**
 * ImageLightbox component for full-screen image viewing.
 */
export function ImageLightbox({ src, onClose }: ImageLightboxProps) {
    const [scale, setScale] = useState(1);

    // Handle keyboard events
    const handleKeyDown = useCallback((e: KeyboardEvent) => {
        if (e.key === 'Escape') {
            onClose();
        } else if (e.key === '+' || e.key === '=') {
            setScale(s => Math.min(s + 0.25, 3));
        } else if (e.key === '-') {
            setScale(s => Math.max(s - 0.25, 0.5));
        }
    }, [onClose]);

    useEffect(() => {
        document.addEventListener('keydown', handleKeyDown);
        document.body.style.overflow = 'hidden';

        return () => {
            document.removeEventListener('keydown', handleKeyDown);
            document.body.style.overflow = '';
        };
    }, [handleKeyDown]);

    const handleDownload = async () => {
        try {
            const response = await fetch(src);
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = src.split('/').pop() || 'image';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
        } catch (error) {
            // Fallback: open in new tab
            window.open(src, '_blank');
        }
    };

    const handleBackdropClick = (e: React.MouseEvent) => {
        if (e.target === e.currentTarget) {
            onClose();
        }
    };

    return (
        <div
            className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center"
            onClick={handleBackdropClick}
        >
            {/* Header Controls */}
            <div className="absolute top-0 left-0 right-0 flex items-center justify-between p-4 bg-linear-to-b from-black/50 to-transparent">
                <div className="text-white/70 text-sm">
                    Press ESC to close • +/- to zoom
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setScale(s => Math.max(s - 0.25, 0.5))}
                        className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
                        title="Zoom out"
                    >
                        <ZoomOut size={20} />
                    </button>
                    <span className="text-white text-sm min-w-12 text-center">
                        {Math.round(scale * 100)}%
                    </span>
                    <button
                        onClick={() => setScale(s => Math.min(s + 0.25, 3))}
                        className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
                        title="Zoom in"
                    >
                        <ZoomIn size={20} />
                    </button>
                    <button
                        onClick={handleDownload}
                        className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors ml-2"
                        title="Download"
                    >
                        <Download size={20} />
                    </button>
                    <button
                        onClick={onClose}
                        className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors ml-2"
                        title="Close"
                    >
                        <X size={20} />
                    </button>
                </div>
            </div>

            {/* Image */}
            <div className="overflow-auto max-w-full max-h-full p-8">
                <img
                    src={src}
                    alt="Preview"
                    className="max-w-none transition-transform duration-200"
                    style={{ transform: `scale(${scale})` }}
                    onClick={(e) => e.stopPropagation()}
                />
            </div>
        </div>
    );
}
