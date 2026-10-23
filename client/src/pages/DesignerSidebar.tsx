import { Type, Image as ImageIcon, Table, DollarSign, User, LayoutTemplate, Heading, Rows, FileText, QrCode } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { TOOLBOX_ITEMS } from './invoiceUtils';

interface DesignerSidebarProps {
    onAddItem: (type: string) => void;
}

const ICONS: Record<string, LucideIcon> = {
    row: Rows,
    header: Heading,
    text: Type,
    image: ImageIcon,
    order_details: FileText,
    customer_details: User,
    order_table: Table,
    totals: DollarSign,
    payment_block: QrCode,
    footer: LayoutTemplate
};

const COLORS: Record<string, { bg: string; hover: string; icon: string }> = {
    row: { bg: 'bg-[var(--brand-subtle)]', hover: 'hover:border-[var(--primary-color)]', icon: 'text-[var(--brand-text)]' },
    header: { bg: 'bg-slate-50', hover: 'hover:border-slate-400', icon: 'text-slate-600' },
    text: { bg: 'bg-[var(--brand-subtle)]', hover: 'hover:border-[var(--primary-color)]', icon: 'text-[var(--brand-text)]' },
    image: { bg: 'bg-[var(--brand-subtle)]', hover: 'hover:border-[var(--primary-color)]', icon: 'text-[var(--brand-text)]' },
    customer_details: { bg: 'bg-[var(--brand-subtle)]', hover: 'hover:border-[var(--primary-color)]', icon: 'text-[var(--brand-text)]' },
    order_table: { bg: 'bg-[var(--brand-subtle)]', hover: 'hover:border-[var(--primary-color)]', icon: 'text-[var(--brand-text)]' },
    totals: { bg: 'bg-[var(--brand-subtle)]', hover: 'hover:border-[var(--primary-color)]', icon: 'text-[var(--brand-text)]' },
    payment_block: { bg: 'bg-[var(--brand-subtle)]', hover: 'hover:border-[var(--primary-color)]', icon: 'text-[var(--brand-text)]' },
    footer: { bg: 'bg-slate-50', hover: 'hover:border-slate-400', icon: 'text-slate-600' }
};

/**
 * DesignerSidebar - Component palette for the invoice designer.
 * Provides draggable components that can be added to the canvas.
 */
export function DesignerSidebar({ onAddItem }: DesignerSidebarProps) {
    return (
        <div className="w-72 bg-white dark:bg-slate-800 dark:text-slate-100 border-r border-slate-200/60 dark:border-slate-700 flex flex-col">
            {/* Header */}
            <div className="px-5 py-4 border-b border-slate-100">
                <div className="flex items-center gap-2">
                    <LayoutTemplate size={16} className="text-[var(--brand-text)]" />
                    <h3 className="font-semibold text-slate-700 dark:text-slate-100 text-sm">Components</h3>
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
                            <button
                                type="button"
                                key={item.id}
                                className={`w-full text-left flex items-center gap-4 p-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-lg cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--focus-color)] ${colors.hover} transition-colors motion-reduce:transition-none`}
                                onClick={() => onAddItem(item.type)}
                                draggable={true}
                                onDragStart={(e) => {
                                    e.dataTransfer.setData("text/plain", item.type);
                                }}
                            >
                                <div className={`w-10 h-10 ${colors.bg} rounded-lg flex items-center justify-center`}>
                                    <Icon size={20} className={colors.icon} />
                                </div>
                                <div className="flex-1">
                                    <span className="text-sm font-semibold text-slate-700 dark:text-slate-100 block">{item.label}</span>
                                    <span className="text-xs text-slate-400">
                                        {item.type === 'row' && 'Group blocks side-by-side'}
                                        {item.type === 'header' && 'First page header'}
                                        {item.type === 'text' && 'Add custom text'}
                                        {item.type === 'image' && 'Logo or image'}
                                        {item.type === 'customer_details' && 'Bill to/Ship to info'}
                                        {item.type === 'order_table' && 'Line items table'}
                                        {item.type === 'totals' && 'Subtotal, tax, total'}
                                        {item.type === 'payment_block' && 'Pay link + QR code'}
                                        {item.type === 'footer' && 'Last page footer'}
                                    </span>
                                </div>
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Tips Section */}
            <div className="p-4 border-t border-slate-100">
                <div className="p-4 bg-[var(--brand-subtle)] rounded-xl border border-[var(--brand-border)]">
                    <p className="font-semibold text-[var(--brand-text)] text-xs mb-1.5">Quick Tip</p>
                    <p className="text-xs text-[var(--brand-text)] leading-relaxed">
                        Click components to add them. Drag to reorder and resize on canvas.
                    </p>
                </div>
            </div>
        </div>
    );
}
