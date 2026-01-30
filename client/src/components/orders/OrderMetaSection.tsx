/**
 * OrderMetaSection Component
 * 
 * Displays categorized metadata from WooCommerce order line items.
 * Categories: Product Options (variations), Custom Fields, and Uploaded Files (images).
 * Extracted from OrderDetailPage for reusability.
 */

import { useState } from 'react';
import { ChevronDown, ChevronUp, Palette, FileText, Image as ImageIcon, Settings } from 'lucide-react';
import { fixMojibake } from '../../utils/format';

// ============================================
// TYPES
// ============================================

interface MetaCategory {
    id: string;
    label: string;
    icon: React.ReactNode;
    color: string;
    bgColor: string;
    items: Array<{ key: string; value: string; imageUrl?: string | null }>;
}

interface OrderMetaSectionProps {
    metaData: Array<{ key: string; value: string; display_key?: string; display_value?: string }>;
    onImageClick: (url: string) => void;
}

interface ImageThumbnailProps {
    item: { key: string; value: string; imageUrl?: string | null };
    onImageClick: (url: string) => void;
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Extracts an image URL from a meta value.
 * Handles compound values like "filename.webp | https://example.com/path/to/image.webp"
 * @returns The URL if found, null otherwise.
 */
export function extractImageUrl(value: string): string | null {
    if (typeof value !== 'string') return null;

    const imagePattern = /\.(jpg|jpeg|png|gif|webp|svg|bmp)/i;

    // Check if the value itself is a direct image URL
    if (imagePattern.test(value) && value.startsWith('http')) {
        return value;
    }

    // Look for URLs within the value (handles "filename | url" format)
    const urlMatch = value.match(/(https?:\/\/[^\s|]+)/g);
    if (urlMatch) {
        for (const url of urlMatch) {
            if (imagePattern.test(url)) {
                return url.trim();
            }
        }
    }

    return null;
}

/**
 * Extracts ALL image URLs from a meta value.
 * WooCommerce can store multiple images per meta entry (newline or pipe separated).
 * @returns An array of all found image URLs.
 */
export function extractAllImageUrls(value: string): string[] {
    if (typeof value !== 'string') return [];

    const imagePattern = /\.(jpg|jpeg|png|gif|webp|svg|bmp)/i;
    const urls: string[] = [];

    const urlMatches = value.match(/(https?:\/\/[^\s|,\n]+)/g);
    if (urlMatches) {
        for (const url of urlMatches) {
            const cleanUrl = url.trim();
            if (imagePattern.test(cleanUrl) && !urls.includes(cleanUrl)) {
                urls.push(cleanUrl);
            }
        }
    }

    return urls;
}

// ============================================
// COMPONENTS
// ============================================

/**
 * Displays a clickable thumbnail image with hover label.
 * Falls back to a text badge if the image fails to load.
 */
export function ImageThumbnail({ item, onImageClick }: ImageThumbnailProps) {
    const [imgError, setImgError] = useState(false);

    if (!item.imageUrl || imgError) {
        return (
            <div className="flex items-center gap-1 px-2 py-1 bg-gray-100 rounded text-xs text-gray-500">
                <FileText size={12} />
                <span>{item.key}</span>
            </div>
        );
    }

    return (
        <div className="group relative">
            <div
                className="cursor-zoom-in rounded-lg overflow-hidden border-2 border-transparent hover:border-purple-400 transition-all shadow-sm hover:shadow-md"
                onClick={() => onImageClick(item.imageUrl!)}
            >
                <img
                    src={item.imageUrl}
                    alt={item.key}
                    onError={() => setImgError(true)}
                    className="h-16 w-16 object-cover hover:scale-105 transition-transform"
                />
            </div>
            <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 px-1.5 py-0.5 bg-gray-900/80 text-white text-[9px] rounded capitalize opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                {item.key}
            </div>
        </div>
    );
}

/**
 * Displays WooCommerce order item metadata in categorized sections.
 * Categories are collapsible and display data in appropriate formats (key-value or image gallery).
 */
export function OrderMetaSection({ metaData, onImageClick }: OrderMetaSectionProps) {
    const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set(['variations', 'custom']));

    // Filter out hidden meta and categorize
    const filteredMeta = metaData.filter(m => !m.key.startsWith('_'));

    if (filteredMeta.length === 0) return null;

    // Categorize metadata
    const categories: MetaCategory[] = [];

    // Variations/Attributes (pa_ prefix or common variation keys)
    const variations = filteredMeta.filter(m =>
        m.key.startsWith('pa_') ||
        ['size', 'color', 'colour', 'variant', 'style', 'material', 'weight'].some(k =>
            m.key.toLowerCase().includes(k)
        )
    );

    // Uploads/Images
    const uploads = filteredMeta.filter(m => {
        const url = extractImageUrl(m.value);
        return url !== null;
    });

    // Custom fields (everything else)
    const customFields = filteredMeta.filter(m =>
        !variations.includes(m) && !uploads.includes(m)
    );

    if (variations.length > 0) {
        categories.push({
            id: 'variations',
            label: 'Product Options',
            icon: <Palette size={12} />,
            color: 'text-purple-700',
            bgColor: 'bg-purple-50 border-purple-200',
            items: variations.map(m => ({
                key: fixMojibake(m.display_key || m.key.replace('pa_', '').replace(/_/g, ' ')),
                value: fixMojibake(m.display_value || m.value),
                imageUrl: null
            }))
        });
    }

    if (customFields.length > 0) {
        categories.push({
            id: 'custom',
            label: 'Custom Fields',
            icon: <Settings size={12} />,
            color: 'text-blue-700',
            bgColor: 'bg-blue-50 border-blue-200',
            items: customFields.map(m => ({
                key: fixMojibake(m.display_key || m.key.replace(/_/g, ' ')),
                value: fixMojibake(m.display_value || m.value),
                imageUrl: null
            }))
        });
    }

    if (uploads.length > 0) {
        // Flatten uploads: each image URL becomes its own item
        const uploadItems: Array<{ key: string; value: string; imageUrl: string | null }> = [];
        for (const m of uploads) {
            const imageUrls = extractAllImageUrls(m.value);
            const baseKey = fixMojibake(m.display_key || m.key.replace(/_/g, ' '));
            if (imageUrls.length > 0) {
                imageUrls.forEach((url, idx) => {
                    uploadItems.push({
                        key: imageUrls.length > 1 ? `${baseKey} (${idx + 1})` : baseKey,
                        value: fixMojibake(m.display_value || m.value),
                        imageUrl: url
                    });
                });
            } else {
                uploadItems.push({
                    key: baseKey,
                    value: fixMojibake(m.display_value || m.value),
                    imageUrl: extractImageUrl(m.value)
                });
            }
        }
        categories.push({
            id: 'uploads',
            label: 'Uploaded Files',
            icon: <ImageIcon size={12} />,
            color: 'text-amber-700',
            bgColor: 'bg-amber-50 border-amber-200',
            items: uploadItems
        });
    }

    const toggleCategory = (id: string) => {
        setExpandedCategories(prev => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    };

    return (
        <div className="mt-3 space-y-2">
            {categories.map(category => {
                const isExpanded = expandedCategories.has(category.id);

                return (
                    <div key={category.id} className={`rounded-lg border overflow-hidden ${category.bgColor}`}>
                        {/* Category Header */}
                        <button
                            onClick={() => toggleCategory(category.id)}
                            className="w-full px-3 py-2 flex items-center justify-between hover:bg-white/30 transition-colors"
                        >
                            <div className={`flex items-center gap-2 text-xs font-semibold ${category.color}`}>
                                {category.icon}
                                <span className="capitalize">{category.label}</span>
                                <span className="px-1.5 py-0.5 rounded-full bg-white/60 text-[10px] font-bold">
                                    {category.items.length}
                                </span>
                            </div>
                            {isExpanded ? (
                                <ChevronUp size={14} className={category.color} />
                            ) : (
                                <ChevronDown size={14} className={category.color} />
                            )}
                        </button>

                        {/* Category Content */}
                        {isExpanded && (
                            <div className="px-3 pb-3 bg-white/40">
                                {category.id === 'uploads' ? (
                                    // Image Gallery View
                                    <div className="flex flex-wrap gap-2 pt-2">
                                        {category.items.map((item, idx) => (
                                            <ImageThumbnail
                                                key={idx}
                                                item={item}
                                                onImageClick={onImageClick}
                                            />
                                        ))}
                                    </div>
                                ) : (
                                    // Key-Value List View
                                    <div className="grid gap-1.5 pt-2">
                                        {category.items.map((item, idx) => (
                                            <div key={idx} className="flex items-baseline gap-2 text-xs">
                                                <span className="font-medium text-gray-600 capitalize min-w-[80px]">
                                                    {item.key}:
                                                </span>
                                                <span className="text-gray-900 break-all whitespace-pre-line">
                                                    {item.value.startsWith('http') ? (
                                                        <a
                                                            href={item.value}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="text-blue-600 hover:underline"
                                                        >
                                                            {item.value.length > 40 ? item.value.slice(0, 40) + '...' : item.value}
                                                        </a>
                                                    ) : (
                                                        item.value
                                                    )}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}
