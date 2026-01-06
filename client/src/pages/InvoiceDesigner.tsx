
import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAccount } from '../context/AccountContext';
import { useAuth } from '../context/AuthContext';
import { Responsive, WidthProvider } from 'react-grid-layout/legacy';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import { Save, Layout, Type, Image as ImageIcon, Table, DollarSign, ArrowLeft, Loader2 } from 'lucide-react';
import { api } from '../services/api';

const ResponsiveGridLayout = WidthProvider(Responsive);

// Item Types
const TOOLBOX_ITEMS = [
    { id: 'text', type: 'text', icon: Type, label: 'Text Block' },
    { id: 'image', type: 'image', icon: ImageIcon, label: 'Image' },
    { id: 'order_table', type: 'order_table', icon: Table, label: 'Order Items' },
    { id: 'totals', type: 'totals', icon: DollarSign, label: 'Totals & Tax' },
];

export function InvoiceDesigner() {
    const { id } = useParams();
    const navigate = useNavigate();
    const { currentAccount } = useAccount();
    const { token } = useAuth();

    const [name, setName] = useState('New Invoice Template');
    const [layout, setLayout] = useState<any[]>([]);
    const [items, setItems] = useState<any[]>([]); // Store component config (e.g. text content)
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    // Initial Load
    useEffect(() => {
        const fetchTemplate = async () => {
            if (id && currentAccount) {
                try {
                    setIsLoading(true);
                    const template: any = await api.get(`/api/invoices/templates/${id}`, token, currentAccount.id);
                    if (template) {
                        console.log('Template loaded:', template);
                        setName(template.name);

                        let layoutData = template.layout;
                        // Handle potential double-serialization or stringified JSON
                        if (typeof layoutData === 'string') {
                            try {
                                layoutData = JSON.parse(layoutData);
                            } catch (e) {
                                console.error('Failed to parse layout string', e);
                            }
                        }

                        // The payload saved is { name, layout: { grid, items } }
                        // So template.layout should be { grid, items }
                        if (layoutData) {
                            console.log('Restoring layout:', layoutData);
                            setLayout(layoutData.grid || []);
                            setItems(layoutData.items || []);
                        }
                    }
                } catch (err) {
                    console.error("Failed to load template", err);
                } finally {
                    setIsLoading(false);
                }
            }
        };
        fetchTemplate();
    }, [id, currentAccount, token]);

    const handleDrop = (layout: any, layoutItem: any, _event: any) => {
        // The item passed here is dummy. We need to identify what was dropped.
        // Usually done via dataTransfer or a global drag state.
        // For simplicity with RGL, we often add the item on click or drag-from-outside handled manually.
        // RGL "droppingItem" prop allows visual drop.
    };

    const addItem = (type: string) => {
        // Simple fallback for unique ID if crypto.randomUUID is not available (e.g. non-secure context)
        const generateId = () => {
            try {
                if (typeof crypto !== 'undefined' && crypto.randomUUID) {
                    return crypto.randomUUID();
                }
            } catch (e) {
                // Ignore
            }
            return Date.now().toString(36) + Math.random().toString(36).substr(2);
        };
        const newItemId = generateId();
        const newItem = {
            i: newItemId,
            x: 0,
            y: Infinity, // puts it at the bottom
            w: type === 'order_table' ? 12 : 6,
            h: type === 'order_table' ? 4 : 2,
            minW: 2,
            minH: 1
        };

        setLayout(prev => [...prev, newItem]);
        setItems(prev => [...prev, { id: newItemId, type, content: type === 'text' ? 'Double click to edit' : '' }]);
    };

    const onLayoutChange = (newLayout: any) => {
        setLayout(newLayout);
    };

    const saveTemplate = async () => {
        if (!currentAccount) return;
        setIsLoading(true);
        try {
            const payload = {
                name,
                layout: {
                    grid: layout,
                    items: items
                }
            };

            if (id) {
                await api.put(`/api/invoices/templates/${id}`, payload, token, currentAccount.id);
            } else {
                const newTemplate: any = await api.post(`/api/invoices/templates`, payload, token, currentAccount.id);
                if (newTemplate && newTemplate.id) {
                    // Update URL without full reload if possible, but navigate works
                    navigate(`/invoices/templates/${newTemplate.id}`, { replace: true });
                }
            }
            // Simple notification - could be replaced with toast
            console.log('Template saved successfully');
        } catch (err) {
            console.error('Failed to save template', err);
        } finally {
            setIsLoading(false);
        }
    };

    const renderItemContent = (itemConfig: any) => {
        switch (itemConfig.type) {
            case 'text':
                return <div className="p-2 h-full overflow-hidden">
                    <p className="whitespace-pre-wrap">{itemConfig.content || 'Text Block'}</p>
                </div>;
            case 'image':
                return <div className="w-full h-full flex items-center justify-center overflow-hidden bg-gray-50">
                    {itemConfig.content ? (
                        <img src={itemConfig.content} alt="Invoice" className="w-full h-full object-contain" />
                    ) : (
                        <div className="text-gray-400 flex flex-col items-center">
                            <ImageIcon size={24} />
                            <span className="text-xs mt-1">No Image</span>
                        </div>
                    )}
                </div>;
            case 'order_table':
                return <div className="p-2 h-full bg-gray-50 flex items-center justify-center border-2 border-dashed border-gray-300">
                    <span className="text-gray-500">Order Items Table Preview</span>
                </div>;
            case 'totals':
                return <div className="p-2 h-full bg-gray-50 flex flex-col items-end justify-center border-2 border-dashed border-gray-300">
                    <div className="w-1/2 h-2 bg-gray-200 mb-1"></div>
                    <div className="w-1/3 h-2 bg-gray-200"></div>
                </div>;
            default:
                return <div className="p-2">{itemConfig.type}</div>;
        }
    };

    return (
        <div className="h-[calc(100vh-64px)] flex flex-col bg-gray-100">
            {/* Header */}
            <div className="bg-white border-b px-6 py-4 flex justify-between items-center">
                <div className="flex items-center gap-4">
                    <button onClick={() => navigate(-1)} className="text-gray-500 hover:text-gray-700">
                        <ArrowLeft size={20} />
                    </button>
                    <div>
                        <label className="block text-xs text-gray-400 font-medium">Template Name</label>
                        <input
                            value={name}
                            onChange={e => setName(e.target.value)}
                            className="font-bold text-lg text-gray-800 border-none p-0 focus:ring-0 placeholder-gray-300"
                        />
                    </div>
                </div>
                <button onClick={saveTemplate} disabled={isLoading} className="btn-primary flex items-center gap-2 disabled:opacity-50">
                    {isLoading ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                    {isLoading ? 'Saving...' : 'Save Template'}
                </button>
            </div>

            <div className="flex flex-1 overflow-hidden">
                {/* Sidebar */}
                <div className="w-64 bg-white border-r p-4 overflow-y-auto">
                    <h3 className="font-semibold text-gray-700 mb-4 text-sm uppercase tracking-wider">Components</h3>
                    <div className="space-y-3">
                        {TOOLBOX_ITEMS.map(item => (
                            <div
                                key={item.id}
                                className="flex items-center gap-3 p-3 bg-white border rounded-lg shadow-sm cursor-pointer hover:border-blue-500 hover:shadow-md transition-all group"
                                onClick={() => addItem(item.type)}
                                draggable={true}
                                onDragStart={(e) => {
                                    e.dataTransfer.setData("text/plain", item.type);
                                }}
                            >
                                <div className="p-2 bg-gray-100 rounded-md text-gray-600 group-hover:bg-blue-50 group-hover:text-blue-600">
                                    <item.icon size={18} />
                                </div>
                                <span className="text-sm font-medium text-gray-700">{item.label}</span>
                            </div>
                        ))}
                    </div>

                    <div className="mt-8 p-4 bg-blue-50 rounded-lg text-xs text-blue-800">
                        <p className="font-semibold mb-1">Tip:</p>
                        Click items to add them to the canvas. Drag to reorder or resize.
                    </div>
                </div>

                {/* Canvas */}
                <div className="flex-1 overflow-y-auto p-8 relative">
                    <div className="max-w-[210mm] mx-auto min-h-[297mm] bg-white shadow-xl relative scale-100 origin-top">
                        <ResponsiveGridLayout
                            className="layout"
                            layouts={{ lg: layout }}
                            breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
                            cols={{ lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 }}
                            rowHeight={30}
                            width={794} // approx A4 width in px at 96dpi? 210mm is ~794px
                            onLayoutChange={onLayoutChange}
                            isDroppable={true}
                        >
                            {layout.map(l => {
                                const itemConfig = items.find(i => i.id === l.i);
                                const isSelected = selectedId === l.i;
                                return (
                                    <div
                                        key={l.i}
                                        className={`bg-white border group relative ${isSelected ? 'border-blue-600 ring-1 ring-blue-600 z-10' : 'hover:border-blue-400'}`}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setSelectedId(l.i);
                                        }}
                                    >
                                        {/* Drag Handle */}
                                        <div className="absolute top-0 right-0 p-1 opacity-0 group-hover:opacity-100 cursor-move bg-gray-100 z-10">
                                            <Layout size={12} />
                                        </div>
                                        {itemConfig && renderItemContent(itemConfig)}
                                    </div>
                                );
                            })}
                        </ResponsiveGridLayout>
                    </div>
                </div>

                {/* Properties Panel */}
                {selectedId && (
                    <div className="w-80 bg-white border-l p-4 overflow-y-auto shadow-xl z-20">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="font-semibold text-gray-700">Properties</h3>
                            <button onClick={() => setSelectedId(null)} className="text-gray-400 hover:text-gray-600">
                                &times;
                            </button>
                        </div>

                        {(() => {
                            const selectedItem = items.find(i => i.id === selectedId);
                            if (!selectedItem) return null;

                            const updateContent = (newContent: string) => {
                                setItems(prev => prev.map(i => i.id === selectedId ? { ...i, content: newContent } : i));
                            };

                            const deleteItem = () => {
                                setLayout(prev => prev.filter(l => l.i !== selectedId));
                                setItems(prev => prev.filter(i => i.id !== selectedId));
                                setSelectedId(null);
                            };

                            return (
                                <div className="space-y-4">
                                    <div className="text-xs text-gray-500 uppercase font-bold tracking-wider mb-2">
                                        Type: {selectedItem.type}
                                    </div>

                                    {selectedItem.type === 'text' && (
                                        <div>
                                            <label className="block text-xs font-medium text-gray-700 mb-1">Content</label>
                                            <textarea
                                                className="w-full text-sm border-gray-300 rounded-md shadow-sm focus:border-blue-500 focus:ring-blue-500"
                                                rows={4}
                                                value={selectedItem.content}
                                                onChange={e => updateContent(e.target.value)}
                                            />
                                        </div>
                                    )}

                                    {selectedItem.type === 'image' && (
                                        <div>
                                            <label className="block text-xs font-medium text-gray-700 mb-1">Image URL</label>
                                            <input
                                                type="text"
                                                className="w-full text-sm border-gray-300 rounded-md shadow-sm focus:border-blue-500 focus:ring-blue-500"
                                                placeholder="https://..."
                                                value={selectedItem.content}
                                                onChange={e => updateContent(e.target.value)}
                                            />
                                            <p className="text-xs text-gray-400 mt-1">Enter a direct link to an image.</p>
                                        </div>
                                    )}

                                    {selectedItem.type === 'order_table' && (
                                        <div className="p-3 bg-yellow-50 text-yellow-800 text-xs rounded">
                                            Table columns usually auto-configured.
                                        </div>
                                    )}

                                    <div className="pt-4 border-t mt-4">
                                        <button
                                            onClick={deleteItem}
                                            className="w-full py-2 px-4 bg-red-50 text-red-600 rounded hover:bg-red-100 text-sm font-medium transition-colors"
                                        >
                                            Delete Item
                                        </button>
                                    </div>
                                </div>
                            );
                        })()}
                    </div>
                )}
            </div>
        </div>
    );
}

