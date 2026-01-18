import { useState, useEffect } from 'react';
import { Logger } from '../utils/logger';
import { useNavigate } from 'react-router-dom';
import { useAccount } from '../context/AccountContext';
import { useAuth } from '../context/AuthContext';
import { Save, ArrowLeft, Loader2, CheckCircle, AlertCircle, X, FileText, Eye, ChevronDown, FileStack, File } from 'lucide-react';
import { api } from '../services/api';
import { generateId } from './invoiceUtils';
import { DesignerSidebar } from './DesignerSidebar';
import { DesignerCanvas } from './DesignerCanvas';
import { DesignerProperties } from './DesignerProperties';
import { InvoiceRenderer } from '../components/invoicing/InvoiceRenderer';

/**
 * InvoiceDesigner - Single template editor for invoice layouts.
 * Only one template per account is supported - saves always overwrite.
 */
export function InvoiceDesigner() {
    const navigate = useNavigate();
    const { currentAccount } = useAccount();
    const { token } = useAuth();

    const [templateId, setTemplateId] = useState<string | null>(null);
    const [name, setName] = useState('Invoice Template');
    const [layout, setLayout] = useState<any[]>([]);
    const [items, setItems] = useState<any[]>([]);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    const [showPreview, setShowPreview] = useState(false);

    // Preview state
    const [recentOrders, setRecentOrders] = useState<any[]>([]);
    const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
    const [previewOrder, setPreviewOrder] = useState<any>(null);
    const [loadingOrders, setLoadingOrders] = useState(false);
    const [loadingOrder, setLoadingOrder] = useState(false);
    const [pageMode, setPageMode] = useState<'single' | 'multi'>('single');

    // Load existing template on mount
    useEffect(() => {
        const fetchTemplate = async () => {
            if (!currentAccount || !token) return;

            try {
                setIsLoading(true);
                const templates: any[] = await api.get('/api/invoices/templates', token, currentAccount.id);

                if (templates && templates.length > 0) {
                    const template = templates[0]; // Only one template per account
                    setTemplateId(template.id);
                    setName(template.name || 'Invoice Template');

                    let layoutData = template.layout;
                    if (typeof layoutData === 'string') {
                        try {
                            layoutData = JSON.parse(layoutData);
                        } catch (e) {
                            Logger.error('Failed to parse layout string', { error: e });
                        }
                    }

                    if (layoutData) {
                        setLayout(layoutData.grid || []);
                        setItems(layoutData.items || []);
                    }
                }
            } catch (err) {
                Logger.error('Failed to load template', { error: err });
            } finally {
                setIsLoading(false);
            }
        };
        fetchTemplate();
    }, [currentAccount, token]);

    // Fetch recent orders when preview opens
    useEffect(() => {
        const fetchOrders = async () => {
            if (!showPreview || !currentAccount || !token) return;
            setLoadingOrders(true);
            try {
                const res = await fetch('/api/orders?limit=20', {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'x-account-id': currentAccount.id
                    }
                });
                if (res.ok) {
                    const data = await res.json();
                    setRecentOrders(data.orders || []);
                }
            } catch (err) {
                Logger.error('Failed to fetch orders for preview', { error: err });
            } finally {
                setLoadingOrders(false);
            }
        };
        fetchOrders();
    }, [showPreview, currentAccount, token]);

    // Fetch selected order details
    useEffect(() => {
        const fetchOrderDetails = async () => {
            if (!selectedOrderId || !currentAccount || !token) {
                setPreviewOrder(null);
                return;
            }
            setLoadingOrder(true);
            try {
                const res = await fetch(`/api/orders/${selectedOrderId}`, {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'x-account-id': currentAccount.id
                    }
                });
                if (res.ok) {
                    const data = await res.json();
                    setPreviewOrder(data);
                }
            } catch (err) {
                Logger.error('Failed to fetch order details', { error: err });
            } finally {
                setLoadingOrder(false);
            }
        };
        fetchOrderDetails();
    }, [selectedOrderId, currentAccount, token]);

    // Demo data for when no order is selected
    const demoData = {
        number: 'DEMO-0001',
        date_created: new Date().toISOString(),
        billing: {
            first_name: 'John',
            last_name: 'Doe',
            email: 'john.doe@example.com',
            address_1: '123 Example Street',
            city: 'Sydney',
            state: 'NSW',
            postcode: '2000',
            country: 'AU'
        },
        line_items: [
            { name: 'Product A', quantity: 2, price: '25.00', total: '50.00' },
            { name: 'Product B', quantity: 1, price: '75.00', total: '75.00' },
        ],
        subtotal: '125.00',
        total_tax: '12.50',
        total: '137.50'
    };

    const addItem = (type: string, parentRowId?: string) => {
        const newItemId = generateId();
        let w = 6;
        let h = 2;

        if (type === 'order_table') {
            w = 12;
            h = 4;
        } else if (type === 'footer') {
            w = 12;
            h = 2;
        } else if (type === 'header') {
            w = 12;
            h = 3;
        } else if (type === 'order_details') {
            w = 6;
            h = 3;
        } else if (type === 'customer_details') {
            w = 6;
            h = 4;
        } else if (type === 'row') {
            w = 12;
            h = 3;
        }

        const initialItem: any = {
            id: newItemId,
            type,
            content: type === 'text' ? 'Double click to edit' : ''
        };

        if (type === 'text') {
            initialItem.style = {
                fontSize: '14px',
                fontWeight: 'normal',
                textAlign: 'left'
            };
        }

        if (type === 'row') {
            initialItem.children = [];
        }

        // If adding to a parent row, add as a child instead of to the grid
        if (parentRowId) {
            setItems(prev => {
                const newItems = [...prev, initialItem];
                // Update the parent row's children array
                return newItems.map(item =>
                    item.id === parentRowId
                        ? { ...item, children: [...(item.children || []), newItemId] }
                        : item
                );
            });
        } else {
            // Add to the grid layout
            const newLayoutItem = {
                i: newItemId,
                x: 0,
                y: Infinity,
                w,
                h,
                minW: 2,
                minH: 1
            };
            setLayout(prev => [...prev, newLayoutItem]);
            setItems(prev => [...prev, initialItem]);
        }
    };

    // Handle drag-drop from sidebar
    const handleDropItem = (type: string, targetRowId?: string) => {
        addItem(type, targetRowId);
    };

    const updateItem = (updates: any) => {
        setItems(prev => prev.map(i => i.id === selectedId ? { ...i, ...updates } : i));
    };

    const deleteItem = () => {
        // Also remove from any parent row's children array
        setItems(prev => {
            const itemToDelete = prev.find(i => i.id === selectedId);
            if (!itemToDelete) return prev;

            // Remove the item and update any parent that has it as a child
            return prev
                .filter(i => i.id !== selectedId)
                .map(item =>
                    item.children?.includes(selectedId!)
                        ? { ...item, children: item.children.filter((c: string) => c !== selectedId) }
                        : item
                );
        });
        setLayout(prev => prev.filter(l => l.i !== selectedId));
        setSelectedId(null);
    };

    const saveTemplate = async () => {
        if (!currentAccount || !token) return;
        setIsSaving(true);
        setSaveMessage(null);

        try {
            const payload = {
                name,
                layout: {
                    grid: layout,
                    items: items
                }
            };

            // Always use POST - backend handles upsert logic
            const result: any = await api.post('/api/invoices/templates', payload, token, currentAccount.id);

            if (result && result.id) {
                setTemplateId(result.id);
            }

            setSaveMessage({ type: 'success', text: 'Template saved successfully!' });
            setTimeout(() => setSaveMessage(null), 3000);
        } catch (err: any) {
            Logger.error('Failed to save template', { error: err });
            setSaveMessage({ type: 'error', text: err?.message || 'Failed to save template' });
        } finally {
            setIsSaving(false);
        }
    };

    if (isLoading) {
        return (
            <div className="h-[calc(100vh-64px)] flex items-center justify-center bg-linear-to-br from-slate-50 to-slate-100">
                <div className="flex flex-col items-center gap-4">
                    <div className="relative">
                        <div className="w-16 h-16 rounded-2xl bg-linear-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg animate-pulse">
                            <FileText className="text-white" size={28} />
                        </div>
                    </div>
                    <div className="flex items-center gap-2 text-slate-600">
                        <Loader2 size={18} className="animate-spin" />
                        <span className="font-medium">Loading Invoice Designer...</span>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="h-[calc(100vh-64px)] flex flex-col bg-linear-to-br from-slate-50 via-slate-100 to-slate-50">
            {/* Premium Header */}
            <div className="bg-white/80 backdrop-blur-xl border-b border-slate-200/60 px-6 py-3 flex justify-between items-center shadow-xs">
                <div className="flex items-center gap-4">
                    <button
                        type="button"
                        onClick={() => navigate(-1)}
                        className="p-2 rounded-xl text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-all"
                    >
                        <ArrowLeft size={20} />
                    </button>

                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-linear-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-md">
                            <FileText className="text-white" size={18} />
                        </div>
                        <div>
                            <h1 className="font-bold text-slate-800 text-lg leading-tight">Invoice Designer</h1>
                            <p className="text-xs text-slate-500">Customize your invoice template</p>
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    {/* Preview Toggle */}
                    <button
                        type="button"
                        onClick={() => setShowPreview(!showPreview)}
                        className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-medium text-sm transition-all ${showPreview
                            ? 'bg-indigo-100 text-indigo-700 shadow-inner'
                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                            }`}
                    >
                        <Eye size={16} />
                        Preview
                    </button>

                    {/* Save Button */}
                    <button
                        type="button"
                        onClick={saveTemplate}
                        disabled={isSaving}
                        className="flex items-center gap-2 px-5 py-2.5 bg-linear-to-r from-indigo-600 to-purple-600 text-white rounded-xl font-semibold text-sm shadow-lg shadow-indigo-500/25 hover:shadow-xl hover:shadow-indigo-500/30 hover:scale-[1.02] transition-all disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:scale-100"
                    >
                        {isSaving ? (
                            <>
                                <Loader2 size={16} className="animate-spin" />
                                Saving...
                            </>
                        ) : (
                            <>
                                <Save size={16} />
                                Save Template
                            </>
                        )}
                    </button>
                </div>
            </div>

            {/* Toast Notification */}
            {saveMessage && (
                <div className={`fixed top-20 right-6 z-50 flex items-center gap-3 px-5 py-4 rounded-2xl shadow-2xl backdrop-blur-xl transition-all animate-in slide-in-from-right ${saveMessage.type === 'success'
                    ? 'bg-emerald-50/90 border border-emerald-200 text-emerald-800'
                    : 'bg-red-50/90 border border-red-200 text-red-800'
                    }`}>
                    {saveMessage.type === 'success' ? (
                        <div className="w-8 h-8 rounded-full bg-emerald-500 flex items-center justify-center">
                            <CheckCircle size={18} className="text-white" />
                        </div>
                    ) : (
                        <div className="w-8 h-8 rounded-full bg-red-500 flex items-center justify-center">
                            <AlertCircle size={18} className="text-white" />
                        </div>
                    )}
                    <span className="text-sm font-semibold">{saveMessage.text}</span>
                    <button
                        type="button"
                        onClick={() => setSaveMessage(null)}
                        className="ml-2 p-1 rounded-full hover:bg-black/5 transition-colors"
                    >
                        <X size={16} />
                    </button>
                </div>
            )}

            {/* Preview Modal */}
            {showPreview && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
                    <div className="relative bg-white rounded-2xl shadow-2xl max-h-[90vh] w-[900px] max-w-[95vw] overflow-hidden flex flex-col">
                        {/* Modal Header */}
                        <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 bg-white/95 backdrop-blur-md border-b border-slate-200">
                            <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-lg bg-linear-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
                                    <Eye className="text-white" size={14} />
                                </div>
                                <h2 className="font-bold text-slate-800">Invoice Preview</h2>
                            </div>

                            {/* Controls */}
                            <div className="flex items-center gap-3">
                                {/* Order Selection */}
                                <div className="relative">
                                    <select
                                        value={selectedOrderId || ''}
                                        onChange={(e) => setSelectedOrderId(e.target.value || null)}
                                        disabled={loadingOrders}
                                        className="appearance-none px-4 py-2 pr-10 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-700 cursor-pointer hover:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 transition-all min-w-[200px]"
                                    >
                                        <option value="">Demo Data</option>
                                        {recentOrders.map((order) => (
                                            <option key={order.id} value={order.wooId || order.id}>
                                                #{order.number} - ${order.total} ({order.status})
                                            </option>
                                        ))}
                                    </select>
                                    <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                                </div>

                                {/* Page Mode Toggle */}
                                <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-100">
                                    <button
                                        type="button"
                                        onClick={() => setPageMode('single')}
                                        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${pageMode === 'single'
                                            ? 'bg-white text-indigo-600 shadow-sm'
                                            : 'text-slate-500 hover:text-slate-700'
                                            }`}
                                    >
                                        <File size={14} />
                                        Single
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setPageMode('multi')}
                                        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${pageMode === 'multi'
                                            ? 'bg-white text-indigo-600 shadow-sm'
                                            : 'text-slate-500 hover:text-slate-700'
                                            }`}
                                    >
                                        <FileStack size={14} />
                                        Multi-Page
                                    </button>
                                </div>

                                {/* Close Button */}
                                <button
                                    type="button"
                                    onClick={() => setShowPreview(false)}
                                    className="p-2 rounded-xl text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-all"
                                >
                                    <X size={20} />
                                </button>
                            </div>
                        </div>

                        {/* Modal Content */}
                        <div className="flex-1 overflow-auto p-8 bg-linear-to-br from-slate-100 via-slate-50 to-slate-100">
                            {loadingOrder ? (
                                <div className="flex items-center justify-center py-16">
                                    <Loader2 size={24} className="animate-spin text-indigo-500" />
                                    <span className="ml-3 text-slate-600">Loading order data...</span>
                                </div>
                            ) : (
                                <InvoiceRenderer
                                    layout={layout}
                                    items={items}
                                    data={previewOrder || demoData}
                                    pageMode={pageMode}
                                />
                            )}
                        </div>

                        {/* Order Info Bar */}
                        {previewOrder && (
                            <div className="px-6 py-3 bg-indigo-50 border-t border-indigo-100 flex items-center justify-between text-sm">
                                <div className="flex items-center gap-4">
                                    <span className="font-medium text-indigo-700">Order #{previewOrder.number}</span>
                                    <span className="text-indigo-600">
                                        {new Date(previewOrder.date_created).toLocaleDateString()}
                                    </span>
                                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${previewOrder.status === 'completed' ? 'bg-emerald-100 text-emerald-700' :
                                        previewOrder.status === 'processing' ? 'bg-blue-100 text-blue-700' :
                                            previewOrder.status === 'pending' ? 'bg-amber-100 text-amber-700' :
                                                'bg-slate-100 text-slate-600'
                                        }`}>
                                        {previewOrder.status}
                                    </span>
                                </div>
                                <div className="text-indigo-600">
                                    {previewOrder.line_items?.length || 0} items • ${previewOrder.total}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Main Content Area */}
            <div className="flex flex-1 overflow-hidden">
                {/* Left Sidebar - Components */}
                <DesignerSidebar onAddItem={addItem} />

                {/* Canvas Area */}
                <DesignerCanvas
                    layout={layout}
                    items={items}
                    selectedId={selectedId}
                    onLayoutChange={(l: any) => setLayout(l)}
                    onSelect={setSelectedId}
                    onDropItem={handleDropItem}
                />

                {/* Right Sidebar - Properties Panel */}
                {selectedId && (
                    <DesignerProperties
                        items={items}
                        selectedId={selectedId}
                        onUpdateItem={updateItem}
                        onDeleteItem={deleteItem}
                        onClose={() => setSelectedId(null)}
                        token={token || undefined}
                        accountId={currentAccount?.id}
                    />
                )}
            </div>
        </div>
    );
}
