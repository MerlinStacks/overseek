import { Type, Image as ImageIcon, Table, DollarSign, Sparkles } from 'lucide-react';
import { TOOLBOX_ITEMS } from './invoiceUtils';

interface DesignerSidebarProps {
    onAddItem: (type: string) => void;
}

const ICONS: Record<string, any> = {
    text: Type,
    image: ImageIcon,
    order_table: Table,
    totals: DollarSign
};

const COLORS: Record<string, { bg: string; hover: string; icon: string }> = {
    text: { bg: 'bg-blue-50', hover: 'hover:border-blue-400', icon: 'text-blue-600' },
    image: { bg: 'bg-purple-50', hover: 'hover:border-purple-400', icon: 'text-purple-600' },
    order_table: { bg: 'bg-emerald-50', hover: 'hover:border-emerald-400', icon: 'text-emerald-600' },
    totals: { bg: 'bg-amber-50', hover: 'hover:border-amber-400', icon: 'text-amber-600' }
};

/**
 * DesignerSidebar - Component palette for the invoice designer.
 * Provides draggable components that can be added to the canvas.
 */
export function DesignerSidebar({ onAddItem }: DesignerSidebarProps) {
    return (
        <div className="w-72 bg-white/70 backdrop-blur-xs border-r border-slate-200/60 flex flex-col">
            {/* Header */}
            <div className="px-5 py-4 border-b border-slate-100">
                <div className="flex items-center gap-2">
                    <Sparkles size={16} className="text-indigo-500" />
                    <h3 className="font-bold text-slate-700 text-sm tracking-wide">Components</h3>
                </div>
                <p className="text-xs text-slate-400 mt-1">Drag or click to add</p>
            </div>

            {/* Component List */}
            <div className="flex-1 overflow-y-auto p-4">
                <div className="space-y-3">
                    {TOOLBOX_ITEMS.map(item => {
                        const Icon = ICONS[item.type] || Type;
                        const colors = COLORS[item.type] || COLORS.text;

                        return (
                            <div
                                key={item.id}
                                className={`flex items-center gap-4 p-4 bg-white border border-slate-200 rounded-xl cursor-pointer shadow-xs hover:shadow-md ${colors.hover} transition-all duration-200 group active:scale-[0.98]`}
                                onClick={() => onAddItem(item.type)}
                                draggable={true}
                                onDragStart={(e) => {
                                    e.dataTransfer.setData("text/plain", item.type);
                                }}
                            >
                                <div className={`w-10 h-10 ${colors.bg} rounded-lg flex items-center justify-center transition-transform group-hover:scale-110`}>
                                    <Icon size={20} className={colors.icon} />
                                </div>
                                <div className="flex-1">
                                    <span className="text-sm font-semibold text-slate-700 block">{item.label}</span>
                                    <span className="text-xs text-slate-400">
                                        {item.type === 'text' && 'Add custom text'}
                                        {item.type === 'image' && 'Logo or image'}
                                        {item.type === 'order_table' && 'Line items table'}
                                        {item.type === 'totals' && 'Subtotal, tax, total'}
                                    </span>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Tips Section */}
            <div className="p-4 border-t border-slate-100">
                <div className="p-4 bg-linear-to-br from-indigo-50 to-purple-50 rounded-xl border border-indigo-100">
                    <p className="font-semibold text-indigo-700 text-xs mb-1.5">💡 Quick Tip</p>
                    <p className="text-xs text-indigo-600/80 leading-relaxed">
                        Click components to add them. Drag to reorder and resize on canvas.
                    </p>
                </div>
            </div>
        </div>
    );
}
