import { useState, useMemo } from 'react';
import { BarChart3, Trash2, Search, DollarSign, Globe, Users, TrendingUp, PieChart } from 'lucide-react';
import { ReportTemplate } from '../../types/analytics';

interface ReportsSidebarProps {
    templates: ReportTemplate[];
    selectedTemplateId?: string;
    onSelect: (template: ReportTemplate) => void;
    onDelete: (e: React.MouseEvent, id: string) => void;
}

/** Icon mapping for template categories */
const CATEGORY_ICONS: Record<string, React.ReactNode> = {
    Sales: <DollarSign size={14} />,
    Traffic: <Globe size={14} />,
    Customer: <Users size={14} />,
    Conversion: <TrendingUp size={14} />
};

/** Color mapping for template categories */
const CATEGORY_COLORS: Record<string, { bg: string; text: string; ring: string }> = {
    Sales: { bg: 'bg-blue-500/10', text: 'text-blue-600', ring: 'ring-blue-500/20' },
    Traffic: { bg: 'bg-green-500/10', text: 'text-green-600', ring: 'ring-green-500/20' },
    Customer: { bg: 'bg-orange-500/10', text: 'text-orange-600', ring: 'ring-orange-500/20' },
    Conversion: { bg: 'bg-purple-500/10', text: 'text-purple-600', ring: 'ring-purple-500/20' }
};

export function ReportsSidebar({ templates, selectedTemplateId, onSelect, onDelete }: ReportsSidebarProps) {
    const [searchTerm, setSearchTerm] = useState('');

    // Filter templates by search term
    const filteredTemplates = useMemo(() =>
        templates.filter(t => t.name.toLowerCase().includes(searchTerm.toLowerCase())),
        [templates, searchTerm]
    );

    // Group system templates by category
    const systemByCategory = useMemo(() => {
        const grouped: Record<string, ReportTemplate[]> = {
            Sales: [],
            Traffic: [],
            Customer: [],
            Conversion: []
        };

        filteredTemplates
            .filter(t => t.type.includes('SYSTEM'))
            .forEach(t => {
                const category = (t as any).category || 'Sales';
                if (grouped[category]) {
                    grouped[category].push(t);
                }
            });

        return grouped;
    }, [filteredTemplates]);

    // Get custom templates
    const customTemplates = useMemo(() =>
        filteredTemplates.filter(t => t.type === 'CUSTOM'),
        [filteredTemplates]
    );

    const renderTemplateButton = (t: ReportTemplate) => {
        const isActive = selectedTemplateId === t.id;
        const isSystem = t.type.includes('SYSTEM');
        const category = (t as any).category || 'Sales';
        const colors = CATEGORY_COLORS[category] || CATEGORY_COLORS.Sales;

        return (
            <div key={t.id} className="relative group/item">
                <button
                    onClick={() => onSelect(t)}
                    className={`w-full text-left p-3 rounded-xl transition-all duration-200 relative overflow-hidden ${isActive
                        ? `${colors.bg} ${colors.text} shadow-xs ring-1 ${colors.ring}`
                        : 'hover:bg-white/60 text-gray-600 hover:text-gray-900 border border-transparent hover:border-white/40'
                        }`}
                >
                    {isActive && <div className={`absolute left-0 top-0 bottom-0 w-1 ${colors.bg.replace('/10', '')} rounded-l-xl`} />}
                    <div className="flex items-center gap-3 relative z-10">
                        <div className={`p-1.5 rounded-lg transition-all ${isActive
                            ? `${colors.bg} ${colors.text}`
                            : 'bg-gray-100 text-gray-400 group-hover/item:bg-white group-hover/item:shadow-xs'
                            }`}>
                            {isSystem && CATEGORY_ICONS[category] ? CATEGORY_ICONS[category] : <BarChart3 size={14} />}
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className="font-medium text-sm truncate">{t.name}</div>
                            <div className="text-[10px] opacity-60 truncate mt-0.5">
                                {t.config.dimension.toUpperCase()} • {t.config.dateRange}
                            </div>
                        </div>
                    </div>
                </button>

                {/* Delete button for custom templates */}
                {!isSystem && (
                    <button
                        onClick={(e) => onDelete(e, t.id)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg opacity-0 group-hover/item:opacity-100 transition-all z-20"
                        title="Delete Template"
                    >
                        <Trash2 size={14} />
                    </button>
                )}
            </div>
        );
    };

    return (
        <div className="w-80 shrink-0 bg-white/50 backdrop-blur-xl border border-white/20 h-[calc(100vh-12rem)] overflow-y-auto flex flex-col sticky top-0 rounded-2xl shadow-lg">

            {/* Search Header */}
            <div className="p-4 sticky top-0 bg-white/80 backdrop-blur-md z-10 border-b border-gray-100/50">
                <div className="relative">
                    <Search className="absolute left-3 top-2.5 text-gray-400" size={16} />
                    <input
                        type="text"
                        placeholder="Search reports..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-9 pr-4 py-2 bg-gray-50/50 border border-gray-200/60 rounded-xl text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500/50 transition-all outline-hidden"
                    />
                </div>
            </div>

            <div className="p-3 space-y-4 flex-1">

                {/* System Templates by Category */}
                {Object.entries(systemByCategory).map(([category, categoryTemplates]) => (
                    categoryTemplates.length > 0 && (
                        <div key={category}>
                            <h3 className="px-3 text-xs font-bold text-gray-400 uppercase tracking-widest mb-2 flex items-center gap-2">
                                {CATEGORY_ICONS[category]}
                                {category}
                            </h3>
                            <div className="space-y-1">
                                {categoryTemplates.map(renderTemplateButton)}
                            </div>
                        </div>
                    )
                ))}

                {/* Custom Templates */}
                {customTemplates.length > 0 && (
                    <div className="pt-2 border-t border-gray-100">
                        <h3 className="px-3 text-xs font-bold text-gray-400 uppercase tracking-widest mb-2 flex items-center gap-2">
                            <PieChart size={12} />
                            My Templates
                        </h3>
                        <div className="space-y-1">
                            {customTemplates.map(renderTemplateButton)}
                        </div>
                    </div>
                )}

                {/* Empty State */}
                {filteredTemplates.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-12 text-gray-400">
                        <Search size={32} className="mb-3 opacity-50" />
                        <p className="text-sm font-medium">No reports found</p>
                        <p className="text-xs mt-1">Try a different search term</p>
                    </div>
                )}
            </div>
        </div>
    );
}
