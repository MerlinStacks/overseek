import { X, Trash2, Type, Image as ImageIcon, Table, DollarSign, Settings } from 'lucide-react';

interface DesignerPropertiesProps {
    items: any[];
    selectedId: string | null;
    onUpdateContent: (newContent: string) => void;
    onDeleteItem: () => void;
    onClose: () => void;
}

const TYPE_CONFIG: Record<string, { icon: any; label: string; color: string }> = {
    text: { icon: Type, label: 'Text Block', color: 'text-blue-600 bg-blue-50' },
    image: { icon: ImageIcon, label: 'Image', color: 'text-purple-600 bg-purple-50' },
    order_table: { icon: Table, label: 'Order Items', color: 'text-emerald-600 bg-emerald-50' },
    totals: { icon: DollarSign, label: 'Totals', color: 'text-amber-600 bg-amber-50' }
};

/**
 * DesignerProperties - Property editor panel for selected canvas items.
 * Allows editing content and deleting items.
 */
export function DesignerProperties({ items, selectedId, onUpdateContent, onDeleteItem, onClose }: DesignerPropertiesProps) {
    const selectedItem = items.find(i => i.id === selectedId);
    if (!selectedItem) return null;

    const config = TYPE_CONFIG[selectedItem.type] || TYPE_CONFIG.text;
    const Icon = config.icon;

    return (
        <div className="w-80 bg-white/90 backdrop-blur-xs border-l border-slate-200/60 flex flex-col shadow-xl z-20">
            {/* Header */}
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className={`w-9 h-9 rounded-lg ${config.color} flex items-center justify-center`}>
                        <Icon size={18} />
                    </div>
                    <div>
                        <h3 className="font-bold text-slate-700 text-sm">{config.label}</h3>
                        <p className="text-xs text-slate-400">Edit properties</p>
                    </div>
                </div>
                <button
                    onClick={onClose}
                    className="p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-all"
                >
                    <X size={18} />
                </button>
            </div>

            {/* Content Editor */}
            <div className="flex-1 overflow-y-auto p-5">
                <div className="space-y-5">
                    {/* Settings Section */}
                    <div>
                        <div className="flex items-center gap-2 mb-3">
                            <Settings size={14} className="text-slate-400" />
                            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Settings</span>
                        </div>

                        {selectedItem.type === 'text' && (
                            <div className="space-y-3">
                                <div>
                                    <label className="block text-xs font-semibold text-slate-600 mb-2">Content</label>
                                    <textarea
                                        className="w-full text-sm border border-slate-200 rounded-xl shadow-xs focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 p-3 resize-none transition-all"
                                        rows={6}
                                        placeholder="Enter your text content..."
                                        value={selectedItem.content}
                                        onChange={e => onUpdateContent(e.target.value)}
                                    />
                                </div>
                                <p className="text-xs text-slate-400">
                                    Supports multiple lines. Press Enter for line breaks.
                                </p>
                            </div>
                        )}

                        {selectedItem.type === 'image' && (
                            <div className="space-y-3">
                                <div>
                                    <label className="block text-xs font-semibold text-slate-600 mb-2">Image URL</label>
                                    <input
                                        type="text"
                                        className="w-full text-sm border border-slate-200 rounded-xl shadow-xs focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 p-3 transition-all"
                                        placeholder="https://example.com/logo.png"
                                        value={selectedItem.content}
                                        onChange={e => onUpdateContent(e.target.value)}
                                    />
                                </div>
                                <p className="text-xs text-slate-400">
                                    Enter a direct link to an image file (PNG, JPG, SVG).
                                </p>
                                {selectedItem.content && (
                                    <div className="mt-4 p-3 bg-slate-50 rounded-xl">
                                        <p className="text-xs font-medium text-slate-500 mb-2">Preview:</p>
                                        <img
                                            src={selectedItem.content}
                                            alt="Preview"
                                            className="w-full h-24 object-contain rounded-lg bg-white border border-slate-200"
                                            onError={(e) => {
                                                (e.target as HTMLImageElement).style.display = 'none';
                                            }}
                                        />
                                    </div>
                                )}
                            </div>
                        )}

                        {selectedItem.type === 'order_table' && (
                            <div className="p-4 bg-emerald-50 rounded-xl border border-emerald-100">
                                <p className="text-sm font-medium text-emerald-700 mb-1">Auto-Generated</p>
                                <p className="text-xs text-emerald-600 leading-relaxed">
                                    This table automatically displays order line items including product name, quantity, price, and total.
                                </p>
                            </div>
                        )}

                        {selectedItem.type === 'totals' && (
                            <div className="p-4 bg-amber-50 rounded-xl border border-amber-100">
                                <p className="text-sm font-medium text-amber-700 mb-1">Auto-Calculated</p>
                                <p className="text-xs text-amber-600 leading-relaxed">
                                    Displays subtotal, shipping, tax, and grand total. Values are calculated from order data.
                                </p>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Delete Footer */}
            <div className="p-4 border-t border-slate-100 bg-slate-50/50">
                <button
                    onClick={onDeleteItem}
                    className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-red-50 text-red-600 rounded-xl hover:bg-red-100 text-sm font-semibold transition-all border border-red-100 hover:border-red-200"
                >
                    <Trash2 size={16} />
                    Delete Component
                </button>
            </div>
        </div>
    );
}
