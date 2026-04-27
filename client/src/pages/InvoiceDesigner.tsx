import { useState, useEffect, useCallback, useRef, type ComponentProps } from 'react';
import { Logger } from '../utils/logger';
import { useNavigate } from 'react-router-dom';
import { useAccount } from '../context/AccountContext';
import { useAuth } from '../context/AuthContext';
import { Save, ArrowLeft, Loader2, CheckCircle, AlertCircle, X, FileText, Eye, ChevronDown, FileStack, File, Download, Printer, Settings2, History, RotateCcw } from 'lucide-react';
import { api } from '../services/api';
import { generateId } from './invoiceUtils';
import { generateInvoicePDF } from '../utils/InvoiceGenerator';
import {
    DEFAULT_INVOICE_TEMPLATE_SETTINGS,
    mergeInvoiceSettings
} from '../../../packages/overseek-core/src/invoiceRenderModel';
import { DesignerSidebar } from './DesignerSidebar';
import { DesignerCanvas } from './DesignerCanvas';
import { DesignerProperties } from './DesignerProperties';
import { InvoiceRenderer } from '../components/invoicing/InvoiceRenderer';

interface LayoutItem {
    i: string;
    x: number;
    y: number;
    w: number;
    h: number;
    minW?: number;
    minH?: number;
    maxW?: number;
    maxH?: number;
    [key: string]: unknown;
}

interface DesignerItem {
    id: string;
    type: string;
    content?: string;
    logo?: string;
    businessDetails?: string;
    children?: string[];
    style?: Record<string, unknown>;
    [key: string]: unknown;
}

interface TemplateSettings {
    numbering?: { prefix?: string; nextNumber?: number };
    locale?: { locale?: string; currency?: string };
    compliance?: {
        taxIdLabel?: string;
        taxIdValue?: string;
        paymentTermsDays?: number;
        legalFooter?: string;
    };
    payment?: { payNowUrl?: string };
    [key: string]: unknown;
}

interface TemplateVersion {
    id: string;
    name?: string;
    createdAt: string;
}

interface InvoiceTemplateRecord {
    id: string;
    name?: string;
    layout?:
    | string
    | {
        grid?: LayoutItem[];
        items?: DesignerItem[];
        settings?: Partial<TemplateSettings>;
    };
}

type InvoiceRendererProps = ComponentProps<typeof InvoiceRenderer>;
type DesignerCanvasProps = ComponentProps<typeof DesignerCanvas>;
type DesignerPropertiesProps = ComponentProps<typeof DesignerProperties>;

interface PreviewOrder {
    id?: string | number;
    wooId?: string | number;
    number: string;
    status?: string;
    total?: string | number;
    date_created?: string;
    line_items?: Array<Record<string, unknown>>;
    [key: string]: unknown;
}

function parseTemplateLayout(layoutInput: InvoiceTemplateRecord['layout']): { grid: LayoutItem[]; items: DesignerItem[]; settings: Partial<TemplateSettings> } {
    let parsed: unknown = layoutInput;
    if (typeof parsed === 'string') {
        try {
            parsed = JSON.parse(parsed);
        } catch (e) {
            Logger.error('Failed to parse layout string', { error: e });
            return { grid: [], items: [], settings: {} };
        }
    }
    if (!parsed || typeof parsed !== 'object') {
        return { grid: [], items: [], settings: {} };
    }

    const layoutObj = parsed as { grid?: unknown; items?: unknown; settings?: unknown };
    return {
        grid: Array.isArray(layoutObj.grid) ? (layoutObj.grid as LayoutItem[]) : [],
        items: Array.isArray(layoutObj.items) ? (layoutObj.items as DesignerItem[]) : [],
        settings: (layoutObj.settings && typeof layoutObj.settings === 'object') ? (layoutObj.settings as Partial<TemplateSettings>) : {},
    };
}

function toPdfOrderData(order: PreviewOrder): { number: string; [key: string]: unknown } {
    return {
        ...order,
        number: String(order.number || 'UNKNOWN'),
    };
}

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
    const [layout, setLayout] = useState<LayoutItem[]>([]);
    const [items, setItems] = useState<DesignerItem[]>([]);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [isDirty, setIsDirty] = useState(false);
    const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    const [showPreview, setShowPreview] = useState(false);
    const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);
    const [templateSettings, setTemplateSettings] = useState<TemplateSettings>(DEFAULT_INVOICE_TEMPLATE_SETTINGS as TemplateSettings);
    const [showSettingsModal, setShowSettingsModal] = useState(false);
    const [templateVersions, setTemplateVersions] = useState<TemplateVersion[]>([]);
    const [loadingVersions, setLoadingVersions] = useState(false);
    const [isRollingBack, setIsRollingBack] = useState<string | null>(null);

    // Refs for keyboard shortcut access to latest state
    const isDirtyRef = useRef(isDirty);
    isDirtyRef.current = isDirty;
    const selectedIdRef = useRef(selectedId);
    selectedIdRef.current = selectedId;
    const showPreviewRef = useRef(showPreview);
    showPreviewRef.current = showPreview;

    // Preview state
    const [recentOrders, setRecentOrders] = useState<PreviewOrder[]>([]);
    const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
    const [previewOrder, setPreviewOrder] = useState<PreviewOrder | null>(null);
    const [loadingOrders, setLoadingOrders] = useState(false);
    const [loadingOrder, setLoadingOrder] = useState(false);
    const [pageMode, setPageMode] = useState<'single' | 'multi'>('single');

    // Load existing template on mount
    useEffect(() => {
        const fetchTemplate = async () => {
            if (!currentAccount || !token) return;

            try {
                setIsLoading(true);
                const templates = await api.get<InvoiceTemplateRecord[]>('/api/invoices/templates', token, currentAccount.id);

                if (templates && templates.length > 0) {
                    const template = templates[0]; // Only one template per account
                    setTemplateId(template.id);
                    setName(template.name || 'Invoice Template');

                    const layoutData = parseTemplateLayout(template.layout);
                    setLayout(layoutData.grid);
                    setItems(layoutData.items);
                    setTemplateSettings(mergeInvoiceSettings(layoutData.settings));
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
                    const data = await res.json() as { orders?: PreviewOrder[] };
                    setRecentOrders(Array.isArray(data.orders) ? data.orders : []);
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
                    const data = await res.json() as PreviewOrder;
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
    const demoData: PreviewOrder = {
        number: 'DEMO-0001',
        date_created: new Date().toISOString(),
        currency: 'AUD',
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
        shipping_total: '10.00',
        total_tax: '12.50',
        total: '147.50'
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
        } else if (type === 'payment_block') {
            w = 6;
            h = 3;
        } else if (type === 'row') {
            w = 12;
            h = 3;
        }

        const initialItem: DesignerItem = {
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

    const updateItem = (updates: Record<string, unknown>) => {
        setItems(prev => prev.map(i => i.id === selectedId ? { ...i, ...updates } : i));
    };

    const deleteItem = useCallback(() => {
        if (!selectedId) return;
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
        setIsDirty(true);
    }, [selectedId]);

    /** Duplicates the currently selected item with a new ID, offset +1 row down. */
    const duplicateItem = useCallback(() => {
        if (!selectedId) return;
        const source = items.find(i => i.id === selectedId);
        const sourceLayout = layout.find(l => l.i === selectedId);
        if (!source || !sourceLayout) return;

        const newId = generateId();
        const clonedItem = { ...JSON.parse(JSON.stringify(source)), id: newId };
        const clonedLayout = {
            ...sourceLayout,
            i: newId,
            y: sourceLayout.y + sourceLayout.h,
        };

        // If duplicating a row, also duplicate its children
        const newChildItems: DesignerItem[] = [];
        const newChildLayouts: LayoutItem[] = [];
        const sourceChildren = source.children ?? [];
        if (source.type === 'row' && sourceChildren.length > 0) {
            const newChildIds: string[] = [];
            for (const childId of sourceChildren) {
                const childItem = items.find(i => i.id === childId);
                if (!childItem) continue;
                const newChildId = generateId();
                newChildIds.push(newChildId);
                newChildItems.push({ ...JSON.parse(JSON.stringify(childItem)), id: newChildId });
                // Row children may have layout entries too
                const childLayout = layout.find(l => l.i === childId);
                if (childLayout) {
                    newChildLayouts.push({ ...childLayout, i: newChildId });
                }
            }
            clonedItem.children = newChildIds;
        }

        setItems(prev => [...prev, clonedItem, ...newChildItems]);
        setLayout(prev => [...prev, clonedLayout, ...newChildLayouts]);
        setSelectedId(newId);
        setIsDirty(true);
    }, [selectedId, items, layout]);

    const saveTemplate = useCallback(async () => {
        if (!currentAccount || !token) return;
        setIsSaving(true);
        setSaveMessage(null);

        try {
            const payload = {
                name,
                layout: {
                    grid: layout,
                    items: items,
                    settings: templateSettings
                }
            };

            // Always use POST - backend handles upsert logic
            const result = await api.post<{ id?: string }>('/api/invoices/templates', payload, token, currentAccount.id);

            if (result && result.id) {
                setTemplateId(result.id);
            }

            setSaveMessage({ type: 'success', text: 'Template saved successfully!' });
            setIsDirty(false);
            setTimeout(() => setSaveMessage(null), 3000);
        } catch (err: unknown) {
            Logger.error('Failed to save template', { error: err });
            const message = err instanceof Error ? err.message : 'Failed to save template';
            setSaveMessage({ type: 'error', text: message });
        } finally {
            setIsSaving(false);
        }
    }, [currentAccount, token, name, layout, items, templateSettings]);

    const fetchVersions = useCallback(async () => {
        if (!currentAccount || !token || !templateId) return;
        setLoadingVersions(true);
        try {
            const result = await api.get<{ versions?: TemplateVersion[] }>(`/api/invoices/templates/${templateId}/versions`, token, currentAccount.id);
            setTemplateVersions(result?.versions || []);
        } catch (err) {
            Logger.error('Failed to fetch template versions', { error: err });
            setTemplateVersions([]);
        } finally {
            setLoadingVersions(false);
        }
    }, [currentAccount, token, templateId]);

    const rollbackVersion = useCallback(async (versionId: string) => {
        if (!currentAccount || !token || !templateId) return;
        setIsRollingBack(versionId);
        try {
            const template = await api.post<InvoiceTemplateRecord>(
                `/api/invoices/templates/${templateId}/rollback`,
                { versionId },
                token,
                currentAccount.id
            );

            const layoutData = parseTemplateLayout(template.layout);
            setLayout(layoutData.grid);
            setItems(layoutData.items);
            setTemplateSettings(mergeInvoiceSettings(layoutData.settings));
            setIsDirty(true);
            setSaveMessage({ type: 'success', text: 'Rolled back to selected version' });
            await fetchVersions();
        } catch (err) {
            Logger.error('Failed to rollback template version', { error: err });
            setSaveMessage({ type: 'error', text: 'Failed to rollback version' });
        } finally {
            setIsRollingBack(null);
            setTimeout(() => setSaveMessage(null), 3000);
        }
    }, [currentAccount, token, templateId, fetchVersions]);

    useEffect(() => {
        if (showSettingsModal) {
            fetchVersions();
        }
    }, [showSettingsModal, fetchVersions]);

    // Track dirty state — only flip dirty on user-initiated changes, not template load
    const hasLoadedRef = useRef(false);
    useEffect(() => {
        // Skip the first render + any renders before/during template load
        if (isLoading) return;
        if (!hasLoadedRef.current) {
            // Mark loaded after the template hydration settles
            hasLoadedRef.current = true;
            return;
        }
        setIsDirty(true);
    }, [layout, items, isLoading]);

    // Warn on page close when dirty
    useEffect(() => {
        const handler = (e: BeforeUnloadEvent) => {
            if (isDirtyRef.current) {
                e.preventDefault();
            }
        };
        window.addEventListener('beforeunload', handler);
        return () => window.removeEventListener('beforeunload', handler);
    }, []);

    // Keyboard shortcuts
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            // Don't trigger when typing in inputs/textareas
            const tag = (e.target as HTMLElement).tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                e.preventDefault();
                saveTemplate();
            } else if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
                e.preventDefault();
                duplicateItem();
            } else if (e.key === 'Delete' || e.key === 'Backspace') {
                if (selectedIdRef.current) {
                    e.preventDefault();
                    deleteItem();
                }
            } else if (e.key === 'Escape') {
                if (showPreviewRef.current) {
                    setShowPreview(false);
                } else if (selectedIdRef.current) {
                    setSelectedId(null);
                }
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [saveTemplate, duplicateItem, deleteItem]);

    /** Downloads a PDF using the client-side jsPDF generator. Requires a real order. */
    const handleDownloadPdf = async () => {
        const orderData = toPdfOrderData(previewOrder || demoData);
        setIsDownloadingPdf(true);
        try {
            await generateInvoicePDF(orderData, layout, items as unknown as InvoiceRendererProps['items'], name, templateSettings);
        } catch (err) {
            Logger.error('Failed to generate PDF', { error: err });
            setSaveMessage({ type: 'error', text: 'Failed to generate PDF' });
            setTimeout(() => setSaveMessage(null), 3000);
        } finally {
            setIsDownloadingPdf(false);
        }
    };

    /** Prints the current preview via window.print() */
    const handlePrint = () => {
        window.print();
    };

    /** Navigates back with unsaved changes confirmation */
    const handleBack = () => {
        if (isDirty && !window.confirm('You have unsaved changes. Leave anyway?')) return;
        navigate(-1);
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
                        onClick={handleBack}
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

                    <button
                        type="button"
                        onClick={() => setShowSettingsModal(true)}
                        className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-medium text-sm transition-all bg-slate-100 text-slate-600 hover:bg-slate-200"
                    >
                        <Settings2 size={16} />
                        Invoice Settings
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

            {showSettingsModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
                    <div className="relative bg-white rounded-2xl shadow-2xl max-h-[90vh] w-[880px] max-w-[95vw] overflow-hidden flex flex-col">
                        <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 bg-white/95 backdrop-blur-md border-b border-slate-200">
                            <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-lg bg-linear-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
                                    <Settings2 className="text-white" size={14} />
                                </div>
                                <h2 className="font-bold text-slate-800">Invoice Settings & Versions</h2>
                            </div>
                            <button
                                type="button"
                                onClick={() => setShowSettingsModal(false)}
                                className="p-2 rounded-xl text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-all"
                            >
                                <X size={20} />
                            </button>
                        </div>

                        <div className="flex-1 overflow-auto p-6 bg-linear-to-br from-slate-100 via-slate-50 to-slate-100">
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                <div className="space-y-4 p-4 rounded-xl border border-slate-200 bg-white">
                                    <h3 className="font-semibold text-slate-800">Numbering & Locale</h3>
                                    <label className="block text-sm text-slate-600">
                                        Invoice Prefix
                                        <input
                                            className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2"
                                            value={templateSettings.numbering?.prefix || ''}
                                            onChange={(e) => setTemplateSettings((prev) => ({ ...prev, numbering: { ...(prev.numbering || {}), prefix: e.target.value } }))}
                                        />
                                    </label>
                                    <label className="block text-sm text-slate-600">
                                        Next Number
                                        <input
                                            type="number"
                                            className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2"
                                            value={templateSettings.numbering?.nextNumber || 1001}
                                            onChange={(e) => setTemplateSettings((prev) => ({ ...prev, numbering: { ...(prev.numbering || {}), nextNumber: Number(e.target.value) || 1 } }))}
                                        />
                                    </label>
                                    <label className="block text-sm text-slate-600">
                                        Locale
                                        <input
                                            className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2"
                                            placeholder="en-AU"
                                            value={templateSettings.locale?.locale || ''}
                                            onChange={(e) => setTemplateSettings((prev) => ({ ...prev, locale: { ...(prev.locale || {}), locale: e.target.value } }))}
                                        />
                                    </label>
                                    <label className="block text-sm text-slate-600">
                                        Currency
                                        <input
                                            className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2"
                                            placeholder="AUD"
                                            value={templateSettings.locale?.currency || ''}
                                            onChange={(e) => setTemplateSettings((prev) => ({ ...prev, locale: { ...(prev.locale || {}), currency: e.target.value.toUpperCase() } }))}
                                        />
                                    </label>
                                </div>

                                <div className="space-y-4 p-4 rounded-xl border border-slate-200 bg-white">
                                    <h3 className="font-semibold text-slate-800">Compliance & Payment</h3>
                                    <label className="block text-sm text-slate-600">
                                        Tax ID Label
                                        <input
                                            className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2"
                                            value={templateSettings.compliance?.taxIdLabel || ''}
                                            onChange={(e) => setTemplateSettings((prev) => ({ ...prev, compliance: { ...(prev.compliance || {}), taxIdLabel: e.target.value } }))}
                                        />
                                    </label>
                                    <label className="block text-sm text-slate-600">
                                        Tax ID Value
                                        <input
                                            className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2"
                                            value={templateSettings.compliance?.taxIdValue || ''}
                                            onChange={(e) => setTemplateSettings((prev) => ({ ...prev, compliance: { ...(prev.compliance || {}), taxIdValue: e.target.value } }))}
                                        />
                                    </label>
                                    <label className="block text-sm text-slate-600">
                                        Payment Terms (days)
                                        <input
                                            type="number"
                                            className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2"
                                            value={templateSettings.compliance?.paymentTermsDays || 14}
                                            onChange={(e) => setTemplateSettings((prev) => ({ ...prev, compliance: { ...(prev.compliance || {}), paymentTermsDays: Number(e.target.value) || 0 } }))}
                                        />
                                    </label>
                                    <label className="block text-sm text-slate-600">
                                        Pay URL
                                        <input
                                            className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2"
                                            placeholder="https://pay.example.com/invoice/{{invoice.number}}"
                                            value={templateSettings.payment?.payNowUrl || ''}
                                            onChange={(e) => setTemplateSettings((prev) => ({ ...prev, payment: { ...(prev.payment || {}), payNowUrl: e.target.value } }))}
                                        />
                                    </label>
                                    <label className="block text-sm text-slate-600">
                                        Legal Footer
                                        <textarea
                                            className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 min-h-[80px]"
                                            value={templateSettings.compliance?.legalFooter || ''}
                                            onChange={(e) => setTemplateSettings((prev) => ({ ...prev, compliance: { ...(prev.compliance || {}), legalFooter: e.target.value } }))}
                                        />
                                    </label>
                                </div>
                            </div>

                            <div className="mt-6 p-4 rounded-xl border border-slate-200 bg-white">
                                <div className="flex items-center justify-between mb-3">
                                    <h3 className="font-semibold text-slate-800 flex items-center gap-2">
                                        <History size={16} />
                                        Template Versions
                                    </h3>
                                    <button
                                        type="button"
                                        onClick={fetchVersions}
                                        className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-sm text-slate-700"
                                    >
                                        Refresh
                                    </button>
                                </div>
                                {loadingVersions ? (
                                    <div className="text-sm text-slate-500">Loading versions...</div>
                                ) : templateVersions.length === 0 ? (
                                    <div className="text-sm text-slate-500">No previous versions yet.</div>
                                ) : (
                                    <div className="space-y-2">
                                        {templateVersions.map((version) => (
                                            <div key={version.id} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2">
                                                <div className="text-sm">
                                                    <div className="font-medium text-slate-700">{version.name || 'Invoice Template'}</div>
                                                    <div className="text-slate-500 text-xs">{new Date(version.createdAt).toLocaleString()}</div>
                                                </div>
                                                <button
                                                    type="button"
                                                    disabled={isRollingBack === version.id}
                                                    onClick={() => rollbackVersion(version.id)}
                                                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-sm disabled:opacity-60"
                                                >
                                                    {isRollingBack === version.id ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
                                                    Rollback
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
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
                                            <option key={String(order.id ?? order.wooId ?? order.number)} value={String(order.wooId || order.id || '')}>
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
                                    onClick={handlePrint}
                                    className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-100 text-slate-600 hover:bg-slate-200 text-sm font-medium transition-all"
                                    title="Print invoice"
                                >
                                    <Printer size={14} />
                                    Print
                                </button>

                                <button
                                    type="button"
                                    onClick={handleDownloadPdf}
                                    disabled={isDownloadingPdf}
                                    className="flex items-center gap-2 px-3 py-2 rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 text-sm font-medium transition-all disabled:opacity-60"
                                    title="Download as PDF"
                                >
                                    {isDownloadingPdf ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                                    PDF
                                </button>

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
                                    items={items as unknown as InvoiceRendererProps['items']}
                                    data={previewOrder || demoData}
                                    settings={templateSettings}
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
                                        {new Date(previewOrder.date_created || new Date().toISOString()).toLocaleDateString()}
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
                    items={items as unknown as DesignerCanvasProps['items']}
                    selectedId={selectedId}
                    onLayoutChange={(l) => setLayout(l)}
                    onSelect={setSelectedId}
                    onDropItem={handleDropItem}
                />

                {/* Right Sidebar - Properties Panel */}
                {selectedId && (
                    <DesignerProperties
                        items={items as unknown as DesignerPropertiesProps['items']}
                        selectedId={selectedId}
                        onUpdateItem={updateItem}
                        onDeleteItem={deleteItem}
                        onDuplicateItem={duplicateItem}
                        onClose={() => setSelectedId(null)}
                        token={token || undefined}
                        accountId={currentAccount?.id}
                    />
                )}
            </div>
        </div>
    );
}

