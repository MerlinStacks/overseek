import React, { useState } from 'react';
import { X, Plus, Image as ImageIcon, ImageOff } from 'lucide-react';

interface Image {
    id: number | string;
    src: string;
    alt?: string;
}

interface ImageGalleryProps {
    images: Image[];
    onChange: (images: Image[]) => void;
}

export function ImageGallery({ images, onChange }: ImageGalleryProps) {
    const [newUrl, setNewUrl] = useState('');
    const [failedImages, setFailedImages] = useState<Set<string | number>>(new Set());

    const handleAdd = () => {
        if (!newUrl) return;
        const newImage = {
            id: Date.now(),
            src: newUrl,
            alt: ''
        };
        onChange([...(images || []), newImage]);
        setNewUrl('');
    };

    const handleRemove = (index: number) => {
        const newImages = [...(images || [])];
        newImages.splice(index, 1);
        onChange(newImages);
    };

    /**
     * Handles image load errors by tracking the failed image ID
     */
    const handleImageError = (imageId: string | number) => {
        setFailedImages(prev => new Set(prev).add(imageId));
    };

    // Filter out images with empty/invalid src values
    const validImages = (images || []).filter(img => img?.src && typeof img.src === 'string' && img.src.trim() !== '');

    return (
        <div className="space-y-4">
            <h3 className="text-sm font-medium text-gray-700 flex items-center gap-2">
                <ImageIcon size={16} /> Product Images
            </h3>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {validImages.map((img, idx) => (
                    <div key={img.id} className="group relative aspect-square bg-gray-100 rounded-lg overflow-hidden border border-gray-200">
                        {failedImages.has(img.id) ? (
                            <div className="w-full h-full flex flex-col items-center justify-center text-gray-400">
                                <ImageOff size={24} />
                                <span className="text-xs mt-1">Failed</span>
                            </div>
                        ) : (
                            <img
                                src={img.src}
                                alt={img.alt || ''}
                                className="w-full h-full object-cover"
                                referrerPolicy="no-referrer"
                                loading="lazy"
                                onError={() => handleImageError(img.id)}
                            />
                        )}
                        <button
                            onClick={() => handleRemove(idx)}
                            className="absolute top-2 right-2 p-1 bg-white/90 text-red-600 rounded-full opacity-0 group-hover:opacity-100 transition-all shadow-xs"
                        >
                            <X size={14} />
                        </button>
                    </div>
                ))}

                {/* Add New Placeholder - For now just URL input trigger */}
                <div className="aspect-square bg-gray-50 rounded-lg border-2 border-dashed border-gray-200 flex flex-col items-center justify-center p-4">
                    <input
                        type="text"
                        placeholder="Image URL..."
                        className="w-full text-xs p-1 mb-2 border rounded-sm"
                        value={newUrl}
                        onChange={e => setNewUrl(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleAdd()}
                    />
                    <button onClick={handleAdd} className="text-blue-600 hover:text-blue-700">
                        <Plus size={24} />
                    </button>
                    <span className="text-xs text-gray-400 mt-1">Add URL</span>
                </div>
            </div>
        </div>
    );
}

