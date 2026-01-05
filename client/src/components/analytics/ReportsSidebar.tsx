import React, { useState } from 'react';
import { BarChart3, Trash2, Search, LayoutGrid, List } from 'lucide-react';
import { ReportTemplate } from '../../types/analytics';

interface ReportsSidebarProps {
    templates: ReportTemplate[];
    selectedTemplateId?: string;
    onSelect: (template: ReportTemplate) => void;
    onDelete: (e: React.MouseEvent, id: string) => void;
}

export function ReportsSidebar({ templates, selectedTemplateId, onSelect, onDelete }: ReportsSidebarProps) {
    const [searchTerm, setSearchTerm] = useState('');

    const systemTemplates = templates.filter(t => t.type.includes('SYSTEM') && t.name.toLowerCase().includes(searchTerm.toLowerCase()));
    const customTemplates = templates.filter(t => t.type === 'CUSTOM' && t.name.toLowerCase().includes(searchTerm.toLowerCase()));

    return (
        <div className="w-80 flex-shrink-0 bg-white/50 backdrop-blur-xl border-r border-white/20 h-[calc(100vh-12rem)] overflow-y-auto flex flex-col sticky top-0 rounded-l-2xl shadow-sm">

            {/* Search Header */}
            <div className="p-4 sticky top-0 bg-white/80 backdrop-blur-md z-10 border-b border-gray-100/50">
                <div className="relative">
                    <Search className="absolute left-3 top-2.5 text-gray-400" size={16} />
                    <input
                        type="text"
                        placeholder="Search reports..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-9 pr-4 py-2 bg-gray-50/50 border border-gray-200/60 rounded-xl text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500/50 transition-all outline-none"
                    />
                </div>
            </div>

            <div className="p-3 space-y-6">
                {/* System Reports */}
                <div>
                    <h3 className="px-3 text-xs font-bold text-gray-400 uppercase tracking-widest mb-2 flex items-center gap-2">
                        <LayoutGrid size={12} /> System
                    </h3>
                    <div className="space-y-1">
                        {systemTemplates.map(t => {
                            const isActive = selectedTemplateId === t.id;
                            return (
                                <button
                                    key={t.id}
                                    onClick={() => onSelect(t)}
                                    className={`w-full text-left p-3 rounded-xl transition-all duration-200 relative group overflow-hidden ${isActive
                                            ? 'bg-blue-500/10 text-blue-700 shadow-sm ring-1 ring-blue-500/20'
                                            : 'hover:bg-white/60 text-gray-600 hover:text-gray-900 border border-transparent hover:border-white/40'
                                        }`}
                                >
                                    {isActive && <div className="absolute left-0 top-0 bottom-0 w-1 bg-blue-500 rounded-l-xl" />}
                                    <div className="flex items-center gap-3 relative z-10">
                                        <div className={`p-1.5 rounded-lg ${isActive ? 'bg-blue-500/20 text-blue-600' : 'bg-gray-100 text-gray-400 group-hover:bg-white group-hover:text-blue-500 group-hover:shadow-sm'} transition-all`}>
                                            <BarChart3 size={16} />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="font-semibold text-sm truncate">{t.name}</div>
                                            <div className="text-[10px] opacity-70 truncate mt-0.5">
                                                {t.config.dimension.toUpperCase()} • {t.config.dateRange}
                                            </div>
                                        </div>
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* Custom Reports */}
                {customTemplates.length > 0 && (
                    <div>
                        <h3 className="px-3 text-xs font-bold text-gray-400 uppercase tracking-widest mb-2 flex items-center gap-2">
                            <List size={12} /> My Templates
                        </h3>
                        <div className="space-y-1">
                            {customTemplates.map(t => {
                                const isActive = selectedTemplateId === t.id;
                                return (
                                    <div key={t.id} className="relative group/item">
                                        <button
                                            onClick={() => onSelect(t)}
                                            className={`w-full text-left p-3 rounded-xl transition-all duration-200 relative overflow-hidden ${isActive
                                                    ? 'bg-purple-500/10 text-purple-700 shadow-sm ring-1 ring-purple-500/20'
                                                    : 'hover:bg-white/60 text-gray-600 hover:text-gray-900 border border-transparent hover:border-white/40'
                                                }`}
                                        >
                                            {isActive && <div className="absolute left-0 top-0 bottom-0 w-1 bg-purple-500 rounded-l-xl" />}
                                            <div className="flex items-center gap-3 relative z-10">
                                                <div className={`p-1.5 rounded-lg ${isActive ? 'bg-purple-500/20 text-purple-600' : 'bg-gray-100 text-gray-400 group-hover/item:bg-white group-hover/item:text-purple-500 group-hover/item:shadow-sm'} transition-all`}>
                                                    <BarChart3 size={16} />
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="font-semibold text-sm truncate">{t.name}</div>
                                                    <div className="text-[10px] opacity-70 truncate mt-0.5">
                                                        {t.config.dimension.toUpperCase()} • {t.config.dateRange}
                                                    </div>
                                                </div>
                                            </div>
                                        </button>
                                        <button
                                            onClick={(e) => onDelete(e, t.id)}
                                            className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg opacity-0 group-hover/item:opacity-100 transition-all z-20"
                                            title="Delete Template"
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
