import { Package, FolderTree, Tags } from 'lucide-react';
import { WooTermField, type WooTerm } from './WooTermField';

export interface WooCommerceInfoPanelProps {
    categories: WooTerm[];
    tags: WooTerm[];
    onCategoriesChange?: (categories: WooTerm[]) => void;
    onTagsChange?: (tags: WooTerm[]) => void;
}

/**
 * Displays WooCommerce-specific product metadata:
 * - Product categories
 * - Product tags
 */
export function WooCommerceInfoPanel({ categories, tags, onCategoriesChange, onTagsChange }: WooCommerceInfoPanelProps) {
    return (
        <div className="bg-white/70 dark:bg-slate-800/80 backdrop-blur-md rounded-xl shadow-xs border border-white/50 dark:border-slate-700/50 p-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100 uppercase tracking-wide mb-4 flex items-center gap-2">
                <Package size={16} className="text-purple-600" />
                WooCommerce Info
            </h3>

            <div className="space-y-5">

                {/* Categories */}
                <div>
                    <div className="flex items-center gap-2 mb-2">
                        <FolderTree size={14} className="text-gray-500" />
                        <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Categories</span>
                    </div>
                    <WooTermField kind="categories" selected={categories} onChange={onCategoriesChange} />
                </div>

                {/* Tags */}
                <div>
                    <div className="flex items-center gap-2 mb-2">
                        <Tags size={14} className="text-gray-500" />
                        <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Tags</span>
                    </div>
                    <WooTermField kind="tags" selected={tags} onChange={onTagsChange} />
                </div>
            </div>
        </div>
    );
}
