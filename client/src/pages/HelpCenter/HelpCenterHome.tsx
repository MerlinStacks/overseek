import { getHelpCollections } from '../../data/helpContent';
import { HelpSearch } from '../../components/HelpCenter/HelpSearch';
import { Link } from 'react-router-dom';
import { useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { BookOpen, Box, Settings, Map, FileText, HelpCircle, TrendingUp, Users, ShoppingCart, MessageSquare, Tag, Compass, Package, Truck, BarChart2 } from 'lucide-react';

const ICON_MAP: Record<string, LucideIcon> = {
    'Box': Box,
    'Settings': Settings,
    'Map': Map,
    'FileText': FileText,
    'TrendingUp': TrendingUp,
    'Users': Users,
    'ShoppingCart': ShoppingCart,
    'MessageSquare': MessageSquare,
    'Tag': Tag,
    'Compass': Compass,
    'Package': Package,
    'Truck': Truck,
    'BarChart2': BarChart2,
    'default': BookOpen
};

export function HelpCenterHome() {
    const [expanded, setExpanded] = useState<Record<string, boolean>>({});
    // Use static content - no API call needed
    const collections = getHelpCollections();

    return (
        <div className="max-w-7xl mx-auto">
            {/* Header Section */}
            <div className="text-center py-10 px-4 mb-8 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800">
                <h1 className="text-3xl md:text-4xl font-bold text-gray-900 dark:text-white mb-4 tracking-tight">How can we help you?</h1>
                <p className="text-gray-500 mb-8 max-w-lg mx-auto text-lg leading-relaxed">Search for answers or browse our help guide collections.</p>
                <div className="flex justify-center">
                    <HelpSearch />
                </div>
            </div>

            {/* Collections Grid */}
            <div className="pb-12">
                <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-6 px-1">Help Collections</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {collections.map(collection => {
                        const Icon = ICON_MAP[collection.icon || 'default'] || ICON_MAP['default'];
                        return (
                            <div key={collection.id} className="bg-white dark:bg-slate-800 rounded-xl p-6 shadow-xs hover:shadow-lg transition-all motion-reduce:transition-none border border-gray-100 dark:border-slate-700 flex flex-col h-full group duration-300 hover:-translate-y-1">
                                <div className="flex items-center gap-4 mb-4">
                                <div className="p-2.5 bg-[var(--brand-subtle)] text-[var(--brand-text)] rounded-lg">
                                        <Icon size={24} strokeWidth={2} />
                                    </div>
                                    <h3 className="text-lg font-bold text-gray-900 dark:text-white">{collection.title}</h3>
                                </div>

                                <p className="text-gray-500 dark:text-slate-400 text-sm mb-6 grow leading-relaxed">{collection.description}</p>

                                <div id={`help-collection-${collection.id}`} className="space-y-3 pt-4 border-t border-gray-50 dark:border-slate-700">
                                    {collection.articles?.length > 0 ? collection.articles.slice(0, expanded[collection.id] ? undefined : 5).map((article) => (
                                        <Link
                                            key={article.id}
                                            to={`/help/article/${encodeURIComponent(article.slug)}`}
                                                className="group/item flex items-center gap-2 text-sm text-gray-600 dark:text-slate-300 hover:text-[var(--brand-text)] cursor-pointer transition-colors"
                                        >
                                                <FileText size={14} className="opacity-40 group-hover/item:text-[var(--brand-text)] group-hover/item:opacity-100 transition-colors" />
                                            <span className="truncate">{article.title}</span>
                                        </Link>
                                    )) : (
                                        <div className="text-sm text-gray-400 italic">No articles yet.</div>
                                    )}

                                    {collection.articles?.length > 5 && (
                                            <button type="button" aria-expanded={!!expanded[collection.id]} aria-controls={`help-collection-${collection.id}`} onClick={() => setExpanded(previous => ({ ...previous, [collection.id]: !previous[collection.id] }))} className="text-xs font-semibold text-[var(--brand-text)] hover:underline mt-2">
                                            {expanded[collection.id] ? 'Show fewer articles' : `View all ${collection.articles.length} articles`}
                                        </button>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>

                {collections.length === 0 && (
                <div className="text-center py-16 bg-gray-50 dark:bg-slate-900 rounded-xl border border-dashed border-gray-200 dark:border-slate-700">
                        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-white shadow-xs mb-4">
                            <HelpCircle className="text-gray-400" size={32} />
                        </div>
                        <h3 className="text-lg font-medium text-gray-900">No help content yet</h3>
                        <p className="text-gray-500 mt-1 max-w-sm mx-auto">We're still writing our guides. Check back soon!</p>
                    </div>
                )}
            </div>
        </div>
    );
}
