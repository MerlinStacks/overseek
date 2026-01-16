import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAccount } from '../context/AccountContext';
import { useAuth } from '../context/AuthContext';
import { Save, ArrowLeft, Loader2, CheckCircle, AlertCircle, X, FileText, Palette, Eye } from 'lucide-react';
import { api } from '../services/api';
import { generateId } from './invoiceUtils';
import { DesignerSidebar } from './DesignerSidebar';
import { DesignerCanvas } from './DesignerCanvas';
import { DesignerProperties } from './DesignerProperties';

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
                            console.error('Failed to parse layout string', e);
                        }
                    }

                    if (layoutData) {
                        setLayout(layoutData.grid || []);
                        setItems(layoutData.items || []);
                    }
                }
            } catch (err) {
                console.error("Failed to load template", err);
            } finally {
                setIsLoading(false);
            }
        };
        fetchTemplate();
    }, [currentAccount, token]);

    const addItem = (type: string) => {
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
            h = 2;
        } else if (type === 'customer_details') {
            w = 6;
            h = 4;
        }

        const newItem = {
            i: newItemId,
            x: 0,
            y: Infinity,
            w,
            h,
            minW: 2,
            minH: 1
        };

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

        setLayout(prev => [...prev, newItem]);
        setItems(prev => [...prev, initialItem]);
    };

    const updateItem = (updates: any) => {
        setItems(prev => prev.map(i => i.id === selectedId ? { ...i, ...updates } : i));
    };

    const deleteItem = () => {
        setLayout(prev => prev.filter(l => l.i !== selectedId));
        setItems(prev => prev.filter(i => i.id !== selectedId));
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
            console.error('Failed to save template', err);
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
