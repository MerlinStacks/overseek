import { Package, FolderTree, Tags } from 'lucide-react';

interface WooCategory {
    id: number;
    name: string;
    slug: string;
}

interface WooTag {
    id: number;
    name: string;
    slug: string;
}

interface WooCommerceInfoPanelProps {
    categories: WooCategory[];
    tags: WooTag[];
}

/**
 * Displays WooCommerce-specific product metadata:
 * - Product categories
 * - Product tags
 */
export function WooCommerceInfoPanel({ categories, tags }: WooCommerceInfoPanelProps) {
    return (
        <div className="bg-white/70 backdrop-blur-md rounded-xl shadow-xs border border-white/50 p-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wide mb-4 flex items-center gap-2">
                <Package size={16} className="text-purple-600" />
                WooCommerce Info
            </h3>

            <div className="space-y-5">

                {/* Categories */}
                <div>
                    <div className="flex items-center gap-2 mb-2">
                        <FolderTree size={14} className="text-gray-500" />
                        <span className="text-sm font-medium text-gray-700">Categories</span>
                    </div>
                    {categories.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                            {categories.map((cat) => (
                                <span
                                    key={cat.id}
                                    className="inline-flex items-center px-3 py-1 bg-blue-50 text-blue-700 text-xs font-medium rounded-full border border-blue-200 hover:bg-blue-100 transition-colors"
                                >
                                    {cat.name}
                                </span>
                            ))}
                        </div>
                    ) : (
                        <p className="text-sm text-gray-400 italic">No categories assigned</p>
                    )}
                </div>

                {/* Tags */}
                <div>
                    <div className="flex items-center gap-2 mb-2">
                        <Tags size={14} className="text-gray-500" />
                        <span className="text-sm font-medium text-gray-700">Tags</span>
                    </div>
                    {tags.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                            {tags.map((tag) => (
                                <span
                                    key={tag.id}
                                    className="inline-flex items-center px-3 py-1 bg-amber-50 text-amber-700 text-xs font-medium rounded-full border border-amber-200 hover:bg-amber-100 transition-colors"
                                >
                                    #{tag.name}
                                </span>
                            ))}
                        </div>
                    ) : (
                        <p className="text-sm text-gray-400 italic">No tags assigned</p>
                    )}
                </div>
            </div>
        </div>
    );
}
