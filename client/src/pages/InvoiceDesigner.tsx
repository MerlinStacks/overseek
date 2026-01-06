
import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAccount } from '../context/AccountContext';
import { useAuth } from '../context/AuthContext';
import { Responsive, WidthProvider } from 'react-grid-layout/legacy';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import { Save, Layout, Type, Image as ImageIcon, Table, DollarSign, ArrowLeft } from 'lucide-react';

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

    // Initial Load
    useEffect(() => {
        if (id && currentAccount) {
            // Fetch existing
            // fetch(`/api/invoices/templates/${id}`)...
        }
    }, [id, currentAccount]);

    const handleDrop = (layout: any, layoutItem: any, _event: any) => {
        // The item passed here is dummy. We need to identify what was dropped.
        // Usually done via dataTransfer or a global drag state.
        // For simplicity with RGL, we often add the item on click or drag-from-outside handled manually.
        // RGL "droppingItem" prop allows visual drop.
    };

    const addItem = (type: string) => {
        // Simple fallback for unique ID if crypto.randomUUID is not available (e.g. non-secure context)
        const generateId = () => {
            if (typeof crypto !== 'undefined' && crypto.randomUUID) {
                return crypto.randomUUID();
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
        // Save logic
        const payload = {
            name,
            layout: {
                grid: layout,
                items: items
            }
        };
        console.log('Saving', payload);
        // Post to API (to be implemented)
    };

    const renderItemContent = (itemConfig: any) => {
        switch (itemConfig.type) {
            case 'text':
                return <div className="p-2 h-full border-2 border-transparent hover:border-blue-200">
                    <p>{itemConfig.content}</p>
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
                <button onClick={saveTemplate} className="btn-primary flex items-center gap-2">
                    <Save size={16} /> Save Template
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
                                return (
                                    <div key={l.i} className="bg-white border group hover:border-blue-400 relative">
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

                {/* Properties Panel (Optional, right side) */}
                {/* <div className="w-64 bg-white border-l p-4">Properties</div> */}
            </div>
        </div>
    );
}

