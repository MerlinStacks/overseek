import { Responsive, WidthProvider } from 'react-grid-layout/legacy';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import { GripVertical, Image as ImageIcon, Type, Table, DollarSign, User, LayoutTemplate, Heading, FileText } from 'lucide-react';

const ResponsiveGridLayout = WidthProvider(Responsive);

interface InvoiceItemStyle {
    fontSize?: string;
    fontWeight?: string;
    textAlign?: 'left' | 'center' | 'right';
}

interface InvoiceItem {
    id: string;
    type: 'header' | 'text' | 'image' | 'order_details' | 'customer_details' | 'order_table' | 'totals' | 'footer';
    content?: string;
    logo?: string;
    businessDetails?: string;
    style?: InvoiceItemStyle;
}

// Note: layout uses any[] due to react-grid-layout/legacy type export incompatibilities
interface DesignerCanvasProps {
    layout: any[];
    items: InvoiceItem[];
    selectedId: string | null;
    onLayoutChange: (layout: any) => void;
    onSelect: (id: string | null) => void;
}

/**
 * DesignerCanvas - Visual drag-and-drop canvas for invoice layout.
 * Renders a paper-like preview with resizable grid items.
 */
export function DesignerCanvas({ layout, items, selectedId, onLayoutChange, onSelect }: DesignerCanvasProps) {

    const renderItemContent = (itemConfig: InvoiceItem) => {
        if (!itemConfig) return <div className="p-3 text-red-500 text-sm">Error: Item config missing</div>;

        switch (itemConfig.type) {
            case 'header':
                return (
                    <div className="p-4 h-full bg-linear-to-br from-slate-50 to-gray-50 flex flex-col rounded-lg border border-dashed border-slate-300">
                        <div className="flex items-center gap-2 text-slate-600 mb-3">
                            <Heading size={16} />
                            <span className="text-xs font-semibold uppercase tracking-wider">Header Block</span>
                        </div>
                        <div className="flex-1 flex gap-4">
                            {/* Logo Section */}
                            <div className="w-1/3 flex items-center justify-center bg-white rounded-lg border border-dashed border-slate-200 overflow-hidden">
                                {itemConfig.logo ? (
                                    <img src={itemConfig.logo} alt="Logo" className="w-full h-full object-contain" />
                                ) : (
                                    <div className="text-center p-2">
                                        <ImageIcon size={24} className="mx-auto text-slate-300 mb-1" />
                                        <span className="text-[10px] text-slate-400">Logo</span>
                                    </div>
                                )}
                            </div>
                            {/* Business Details Section */}
                            <div className="flex-1 flex flex-col justify-center text-sm text-slate-600 leading-relaxed">
                                {itemConfig.businessDetails ? (
                                    <div className="whitespace-pre-wrap">{itemConfig.businessDetails}</div>
                                ) : (
                                    <div className="space-y-1">
                                        <div className="h-3 w-32 bg-slate-200/50 rounded-sm"></div>
                                        <div className="h-2.5 w-40 bg-slate-200/50 rounded-sm"></div>
                                        <div className="h-2.5 w-28 bg-slate-200/50 rounded-sm"></div>
                                        <div className="h-2.5 w-36 bg-slate-200/50 rounded-sm"></div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                );
            case 'text':
                const style = itemConfig.style || {};
                return (
                    <div className="p-4 h-full overflow-hidden flex flex-col">
                        <div className="flex items-start gap-2 text-slate-500 mb-2 shrink-0">
                            <Type size={14} className="shrink-0 mt-0.5" />
                            <span className="text-xs font-medium uppercase tracking-wider">Text Block</span>
                        </div>
                        <div
                            className="flex-1 whitespace-pre-wrap leading-relaxed overflow-hidden"
                            style={{
                                fontSize: style.fontSize || '14px',
                                fontWeight: style.fontWeight || 'normal',
                                textAlign: style.textAlign || 'left',
                                color: '#334155'
                            }}
                        >
                            {itemConfig.content || 'Click to edit text...'}
                        </div>
                    </div>
                );
            case 'image':
                return (
                    <div className="w-full h-full flex items-center justify-center overflow-hidden bg-linear-to-br from-slate-50 to-slate-100 rounded-lg relative">
                        {itemConfig.content ? (
                            <img
                                src={itemConfig.content}
                                alt="Invoice"
                                className="w-full h-full object-contain"
                                onError={(e) => {
                                    // Fallback if image fails to load
                                    (e.target as HTMLImageElement).style.display = 'none';
                                    (e.target as HTMLImageElement).parentElement?.classList.add('image-error');
                                }}
                            />
                        ) : (
                            <div className="text-slate-400 flex flex-col items-center gap-2">
                                <div className="w-12 h-12 rounded-xl bg-purple-100 flex items-center justify-center">
                                    <ImageIcon size={24} className="text-purple-500" />
                                </div>
                                <span className="text-xs font-medium">Add Image</span>
                            </div>
                        )}
                        {/* Error state overlay */}
                        <div className="hidden image-error:flex absolute inset-0 flex-col items-center justify-center text-red-400 bg-red-50">
                            <ImageIcon size={24} className="mb-2 opacity-50" />
                            <span className="text-xs font-medium">Failed to load image</span>
                        </div>
                    </div>
                );
            case 'order_details':
                return (
                    <div className="p-4 h-full bg-linear-to-br from-sky-50 to-cyan-50 flex flex-col rounded-lg border border-dashed border-sky-300">
                        <div className="flex items-center gap-2 text-sky-600 mb-3">
                            <FileText size={16} />
                            <span className="text-xs font-semibold uppercase tracking-wider">Order Details</span>
                        </div>
                        <div className="space-y-2">
                            <div className="flex gap-4 text-xs">
                                <span className="text-sky-500 w-24">Order Number:</span>
                                <span className="h-3 w-16 bg-sky-200/50 rounded-sm"></span>
                            </div>
                            <div className="flex gap-4 text-xs">
                                <span className="text-sky-500 w-24">Order Date:</span>
                                <span className="h-3 w-20 bg-sky-200/50 rounded-sm"></span>
                            </div>
                            <div className="flex gap-4 text-xs">
                                <span className="text-sky-500 w-24">Payment Method:</span>
                                <span className="h-3 w-16 bg-sky-200/50 rounded-sm"></span>
                            </div>
                        </div>
                    </div>
                );
            case 'customer_details':
                return (
                    <div className="p-4 h-full bg-linear-to-br from-indigo-50 to-blue-50 flex flex-col rounded-lg border border-dashed border-indigo-300">
                        <div className="flex items-center gap-2 text-indigo-600 mb-3">
                            <User size={16} />
                            <span className="text-xs font-semibold uppercase tracking-wider">Customer Details</span>
                        </div>
                        <div className="space-y-2">
                            <div className="h-4 w-32 bg-indigo-200/50 rounded-sm"></div>
                            <div className="h-3 w-48 bg-indigo-200/50 rounded-sm"></div>
                            <div className="h-3 w-40 bg-indigo-200/50 rounded-sm"></div>
                            <div className="h-3 w-24 bg-indigo-200/50 rounded-sm"></div>
                        </div>
                    </div>
                );
            case 'order_table':
                return (
                    <div className="p-4 h-full bg-linear-to-br from-emerald-50 to-teal-50 flex flex-col rounded-lg border border-dashed border-emerald-300">
                        <div className="flex items-center gap-2 text-emerald-600 mb-3">
                            <Table size={16} />
                            <span className="text-xs font-semibold uppercase tracking-wider">Order Items Table</span>
                        </div>
                        <div className="flex-1 flex flex-col justify-center">
                            <div className="space-y-2">
                                <div className="flex gap-4 text-xs text-emerald-600 font-medium pb-2 border-b border-emerald-200">
                                    <span className="flex-1">Product</span>
                                    <span className="w-12 text-center">Qty</span>
                                    <span className="w-16 text-right">Price</span>
                                </div>
                                <div className="flex gap-4 text-xs text-emerald-500">
                                    <span className="flex-1 bg-emerald-100 rounded-sm h-3"></span>
                                    <span className="w-12 bg-emerald-100 rounded-sm h-3"></span>
                                    <span className="w-16 bg-emerald-100 rounded-sm h-3"></span>
                                </div>
                                <div className="flex gap-4 text-xs text-emerald-500">
                                    <span className="flex-1 bg-emerald-100 rounded-sm h-3"></span>
                                    <span className="w-12 bg-emerald-100 rounded-sm h-3"></span>
                                    <span className="w-16 bg-emerald-100 rounded-sm h-3"></span>
                                </div>
                            </div>
                        </div>
                    </div>
                );
            case 'totals':
                return (
                    <div className="p-4 h-full bg-linear-to-br from-amber-50 to-orange-50 flex flex-col rounded-lg border border-dashed border-amber-300">
                        <div className="flex items-center gap-2 text-amber-600 mb-3">
                            <DollarSign size={16} />
                            <span className="text-xs font-semibold uppercase tracking-wider">Totals</span>
                        </div>
                        <div className="flex-1 flex flex-col justify-center space-y-2">
                            <div className="flex justify-between text-xs">
                                <span className="text-amber-600">Subtotal:</span>
                                <span className="w-20 bg-amber-100 rounded-sm h-3"></span>
                            </div>
                            <div className="flex justify-between text-xs">
                                <span className="text-amber-600">Shipping:</span>
                                <span className="w-16 bg-amber-100 rounded-sm h-3"></span>
                            </div>
                            <div className="flex justify-between text-xs">
                                <span className="text-amber-600">Tax:</span>
                                <span className="w-14 bg-amber-100 rounded-sm h-3"></span>
                            </div>
                            <div className="flex justify-between text-xs font-bold pt-2 border-t border-amber-200">
                                <span className="text-amber-700">Total:</span>
                                <span className="w-24 bg-amber-200 rounded-sm h-4"></span>
                            </div>
                        </div>
                    </div>
                );
            case 'footer':
                return (
                    <div className="p-4 h-full bg-linear-to-br from-slate-50 to-gray-50 flex flex-col rounded-lg border border-dashed border-slate-300">
                        <div className="flex items-center gap-2 text-slate-600 mb-2">
                            <LayoutTemplate size={16} />
                            <span className="text-xs font-semibold uppercase tracking-wider">Footer (Last Page Only)</span>
                        </div>
                        <div className="flex-1 flex items-center justify-center text-center">
                            <p className="text-xs text-slate-500 italic">
                                {itemConfig.content || 'Footer content goes here...'}
                            </p>
                        </div>
                    </div>
                );
            default:
                return <div className="p-3 text-slate-500 text-sm">{itemConfig.type}</div>;
        }
    };

    return (
        <div
            className="flex-1 overflow-y-auto p-8 bg-linear-to-br from-slate-100 via-slate-50 to-slate-100"
            onClick={() => onSelect(null)}
        >
            {/* Paper Container */}
            <div className="max-w-[210mm] mx-auto min-h-[297mm] bg-white shadow-2xl rounded-lg relative origin-top ring-1 ring-slate-200/50">
                {/* Paper Texture Overlay */}
                <div className="absolute inset-0 opacity-[0.02] pointer-events-none bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMDAiIGhlaWdodD0iMzAwIj48ZmlsdGVyIGlkPSJhIiB4PSIwIiB5PSIwIj48ZmVUdXJidWxlbmNlIGJhc2VGcmVxdWVuY3k9Ii43NSIgc3RpdGNoVGlsZXM9InN0aXRjaCIgdHlwZT0iZnJhY3RhbE5vaXNlIi8+PGZlQ29sb3JNYXRyaXggdHlwZT0ic2F0dXJhdGUiIHZhbHVlcz0iMCIvPjwvZmlsdGVyPjxyZWN0IHdpZHRoPSIxMDAlIiBoZWlnaHQ9IjEwMCUiIGZpbHRlcj0idXJsKCNhKSIvPjwvc3ZnPg==')]" />

                {/* Grid Layout */}
                <ResponsiveGridLayout
                    className="layout"
                    layouts={{ lg: layout }}
                    breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
                    cols={{ lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 }}
                    rowHeight={30}
                    onLayoutChange={onLayoutChange}
                    isDroppable={true}
                >
                    {layout.map(l => {
                        const itemConfig = items.find(i => i.id === l.i);
                        const isSelected = selectedId === l.i;
                        if (!itemConfig) return <div key={l.i}></div>;

                        return (
                            <div
                                key={l.i}
                                className={`bg-white border-2 rounded-lg group relative transition-all duration-150 ${isSelected
                                    ? 'border-indigo-500 ring-2 ring-indigo-500/20 shadow-lg z-10'
                                    : 'border-slate-200 hover:border-indigo-300 hover:shadow-md'
                                    }`}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onSelect(l.i);
                                }}
                            >
                                {/* Drag Handle */}
                                <div className={`absolute -top-px -left-px p-1.5 rounded-br-lg cursor-move z-10 transition-all ${isSelected
                                    ? 'bg-indigo-500 opacity-100'
                                    : 'bg-slate-300 opacity-0 group-hover:opacity-100'
                                    }`}>
                                    <GripVertical size={12} className={isSelected ? 'text-white' : 'text-slate-600'} />
                                </div>

                                {/* Item Content */}
                                <div className="h-full overflow-hidden">
                                    {renderItemContent(itemConfig)}
                                </div>
                            </div>
                        );
                    })}
                </ResponsiveGridLayout>

                {/* Empty State */}
                {layout.length === 0 && (
                    <div className="absolute inset-0 flex items-center justify-center">
                        <div className="text-center p-8">
                            <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-linear-to-br from-indigo-100 to-purple-100 flex items-center justify-center">
                                <Table size={32} className="text-indigo-500" />
                            </div>
                            <h3 className="text-lg font-bold text-slate-700 mb-2">Start Building Your Invoice</h3>
                            <p className="text-sm text-slate-500 max-w-sm mx-auto">
                                Click on components in the left sidebar to add them to your invoice template.
                            </p>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
