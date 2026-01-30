import { useState } from 'react';
import { getHelpCollections } from '../../data/helpContent';
import { HelpSearch } from '../../components/HelpCenter/HelpSearch';
import { useNavigate } from 'react-router-dom';
import { BookOpen, Box, Settings, Map, FileText, HelpCircle, TrendingUp, Users, ShoppingCart, MessageSquare, Tag, Compass, Package, Truck, BarChart2 } from 'lucide-react';

const ICON_MAP: Record<string, any> = {
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
    const navigate = useNavigate();
    // Use static content - no API call needed
    const collections = getHelpCollections();

    return (
        <div className="max-w-7xl mx-auto">
            {/* Header Section */}
            <div className="text-center py-12 px-4 mb-10 bg-linear-to-b from-white to-gray-50/50 rounded-2xl border border-gray-100 shadow-xs">
                <h1 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4 tracking-tight">How can we help you?</h1>
                <p className="text-gray-500 mb-8 max-w-lg mx-auto text-lg leading-relaxed">Search for answers or browse our help guide collections.</p>
                <div className="flex justify-center">
                    <HelpSearch />
                </div>
            </div>

            {/* Collections Grid */}
            <div className="pb-12">
                <h2 className="text-xl font-semibold text-gray-900 mb-6 px-1">Help Collections</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {collections.map(collection => {
                        const Icon = ICON_MAP[collection.icon || 'default'] || ICON_MAP['default'];
                        return (
                            <div key={collection.id} className="bg-white rounded-xl p-6 shadow-xs hover:shadow-lg transition-all border border-gray-100 flex flex-col h-full group duration-300 hover:-translate-y-1">
                                <div className="flex items-center gap-4 mb-4">
                                    <div className="p-3 bg-blue-50 text-blue-600 rounded-xl group-hover:bg-blue-600 group-hover:text-white transition-colors duration-300">
                                        <Icon size={24} strokeWidth={2} />
                                    </div>
                                    <h3 className="text-lg font-bold text-gray-900">{collection.title}</h3>
                                </div>

                                <p className="text-gray-500 text-sm mb-6 grow leading-relaxed">{collection.description}</p>

                                <div className="space-y-3 pt-4 border-t border-gray-50">
                                    {collection.articles?.length > 0 ? collection.articles.slice(0, 5).map((article) => (
                                        <div
                                            key={article.id}
                                            onClick={() => navigate(`/help/article/${article.slug}`)}
                                            className="group/item flex items-center gap-2 text-sm text-gray-600 hover:text-blue-600 cursor-pointer transition-colors"
                                        >
                                            <FileText size={14} className="opacity-40 group-hover/item:text-blue-500 group-hover/item:opacity-100 transition-all" />
                                            <span className="truncate">{article.title}</span>
                                        </div>
                                    )) : (
                                        <div className="text-sm text-gray-400 italic">No articles yet.</div>
                                    )}

                                    {collection.articles?.length > 5 && (
                                        <button className="text-xs font-semibold text-blue-500 hover:text-blue-600 mt-2 uppercase tracking-wide">
                                            View all {collection.articles.length} articles
                                        </button>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>

                {collections.length === 0 && (
                    <div className="text-center py-20 bg-gray-50 rounded-2xl border border-dashed border-gray-200">
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
