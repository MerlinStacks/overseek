import { useState, useEffect, useCallback } from 'react';
import { Logger } from '../utils/logger';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useAccount } from '../context/AccountContext';
import { ArrowLeft, Save, Plus, Trash2, Loader2, Calendar, Copy, ExternalLink } from 'lucide-react';
import { CreateSupplierModal } from '../components/inventory/CreateSupplierModal';
import { ProductSearchInput, ProductSelection } from '../components/inventory/ProductSearchInput';
import { SupplierSearchInput } from '../components/inventory/SupplierSearchInput';
import { POStatusStepper } from '../components/inventory/POStatusStepper';
import { Toast, ToastType } from '../components/ui/Toast';

interface POItem {
    id?: string;
    productId?: string;
    supplierItemId?: string;
    name: string;
    quantity: number;
    unitCost: number;
    totalCost: number;
    sku?: string;
    wooId?: number;          // WooCommerce product ID for tracking
    variationWooId?: number; // Variant ID if applicable
}

interface Supplier {
    id: string;
    name: string;
    currency: string;
    items: any[];
}

export function PurchaseOrderEditPage() {
    const navigate = useNavigate();
    const { id } = useParams();
    const isNew = !id || id === 'new';
    const { token } = useAuth();
    const { currentAccount } = useAccount();

    const [isLoading, setIsLoading] = useState(false);
    const [suppliers, setSuppliers] = useState<Supplier[]>([]);

    // Form State
    const [supplierId, setSupplierId] = useState('');
    const [status, setStatus] = useState('DRAFT');
    const [notes, setNotes] = useState('');
    const [orderDate, setOrderDate] = useState('');
    const [expectedDate, setExpectedDate] = useState('');
    const [trackingNumber, setTrackingNumber] = useState('');
    const [trackingLink, setTrackingLink] = useState('');
    const [items, setItems] = useState<POItem[]>([]);
    const [showCreateSupplier, setShowCreateSupplier] = useState(false);

    const [toastMessage, setToastMessage] = useState('');
    const [toastVisible, setToastVisible] = useState(false);
    const [toastType, setToastType] = useState<ToastType>('error');
    const showToast = useCallback((message: string, type: ToastType = 'error') => {
        setToastMessage(message); setToastType(type); setToastVisible(true);
    }, []);

    const [poNumber, setPoNumber] = useState('');

    useEffect(() => {
        if (currentAccount) {
            fetchSuppliers();
            if (!isNew) {
                fetchPO(id!);
            }
        }
    }, [currentAccount, token, id]);

    async function fetchSuppliers() {
        // Assume endpoint exists
        try {
            const res = await fetch(`/api/inventory/suppliers`, {
                headers: { 'Authorization': `Bearer ${token}`, 'X-Account-ID': currentAccount!.id }
            });
            if (res.ok) setSuppliers(await res.json());
        } catch (err) { Logger.error('An error occurred', { error: err }); }
    }

    async function fetchPO(poId: string) {
        setIsLoading(true);
        try {
            const res = await fetch(`/api/inventory/purchase-orders/${poId}`, {
                headers: { 'Authorization': `Bearer ${token}`, 'X-Account-ID': currentAccount!.id }
            });
            if (res.ok) {
                const data = await res.json();
                setSupplierId(data.supplierId);
                setStatus(data.status);
                setNotes(data.notes || '');
                setOrderDate(data.orderDate ? data.orderDate.split('T')[0] : '');
                setExpectedDate(data.expectedDate ? data.expectedDate.split('T')[0] : '');
                setTrackingNumber(data.trackingNumber || '');
                setTrackingLink(data.trackingLink || '');
                setPoNumber(data.orderNumber || '');

                // Map items
                setItems(data.items.map((i: any) => ({
                    id: i.id,
                    productId: i.productId,
                    supplierItemId: i.supplierItemId,
                    name: i.name,
                    sku: i.sku,
                    wooId: i.product?.wooId ?? i.wooId,
                    variationWooId: i.variationWooId ?? undefined,
                    quantity: i.quantity,
                    unitCost: Number(i.unitCost),
                    totalCost: Number(i.totalCost)
                })));
            }
        } catch (err) { Logger.error('An error occurred', { error: err }); }
        finally { setIsLoading(false); }
    }

    const addItem = () => {
        setItems([...items, { name: '', quantity: 1, unitCost: 0, totalCost: 0 }]);
    };

    const updateItem = (index: number, field: keyof POItem, value: any) => {
        const newItems = [...items];
        newItems[index] = { ...newItems[index], [field]: value };

        // Auto calc total
        if (field === 'quantity' || field === 'unitCost') {
            newItems[index].totalCost = newItems[index].quantity * newItems[index].unitCost;
        }

        setItems(newItems);
    };

    const removeItem = (index: number) => {
        setItems(items.filter((_, i) => i !== index));
    };

    const handleSave = async () => {
        if (!supplierId) { showToast('Please select a supplier'); return; }

        setIsLoading(true);
        const payload = {
            supplierId,
            status,
            notes,
            orderDate: orderDate || null,
            expectedDate: expectedDate || null,
            trackingNumber: trackingNumber || null,
            trackingLink: trackingLink || null,
            items: items.map(i => ({
                productId: i.productId,
                supplierItemId: i.supplierItemId,
                variationWooId: i.variationWooId || null,
                name: i.name,
                sku: i.sku,
                quantity: Number(i.quantity),
                unitCost: Number(i.unitCost)
            }))
        };

        try {
            const url = isNew ? `/api/inventory/purchase-orders` : `/api/inventory/purchase-orders/${id}`;
            const method = isNew ? 'POST' : 'PUT';

            const res = await fetch(url, {
                method,
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'X-Account-ID': currentAccount!.id
                },
                body: JSON.stringify(payload)
            });

            if (res.ok) {
                navigate('/inventory?tab=purchasing');
            } else {
                let errorMessage = 'Failed to save';
                try {
                    const errorData = await res.json();
                    errorMessage = errorData.error || errorData.message || `Failed to save (${res.status})`;
                } catch {
                    errorMessage = `Failed to save (HTTP ${res.status})`;
                }
                Logger.error('PO save failed', { status: res.status, errorMessage });
                showToast(errorMessage);
            }
        } catch (err) {
            Logger.error('PO save error', { error: err });
            showToast(`Error saving: ${err instanceof Error ? err.message : 'Network error'}`);
        } finally {
            setIsLoading(false);
        }
    };

    if (isLoading && !isNew && items.length === 0) {
        return <div className="p-12 text-center"><Loader2 className="animate-spin inline" /> Loading PO...</div>;
    }

    const grandTotal = items.reduce((acc, item) => acc + (item.totalCost || 0), 0);
    const selectedSupplier = suppliers.find(s => s.id === supplierId);
    // Lock the PO from editing once marked as received
    const isLocked = status === 'RECEIVED';

    return (
        <div className="max-w-7xl mx-auto space-y-6">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <button onClick={() => navigate('/inventory?tab=purchasing')} className="p-2 hover:bg-gray-100 rounded-full">
                        <ArrowLeft size={20} />
                    </button>
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900">{isNew ? 'New Purchase Order' : `Edit PO ${poNumber || id?.substring(0, 8)}`}</h1>
                        <p className="text-gray-500">Manage order details and items</p>
                    </div>
                </div>
                <div className="flex gap-2">
                    {!isNew && (
                        <button
                            onClick={() => {
                                // Duplicate this PO as new draft
                                navigate('/inventory/purchase-orders/new', {
                                    state: { duplicateFrom: { supplierId, items, notes } }
                                });
                            }}
                            className="flex items-center gap-2 bg-gray-100 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-200"
                            title="Duplicate this order"
                        >
                            <Copy size={18} />
                            Duplicate
                        </button>
                    )}
                    <button
                        onClick={handleSave}
                        disabled={isLoading}
                        className="flex items-center gap-2 bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50"
                    >
                        {isLoading ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}
                        Save Order
                    </button>
                </div>
            </div>

            {/* Status Stepper */}
            {!isNew && (
                <POStatusStepper
                    status={status as any}
                    onStatusChange={(newStatus) => setStatus(newStatus)}
                    disabled={isLocked}
                />
            )}

            <div className="grid grid-cols-3 gap-6">
                <div className="col-span-2 space-y-6">
                    {/* Items Panel */}
                    <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-xs">
                        <div className="flex justify-between items-center mb-4">
                            <h2 className="text-lg font-semibold">Order Items</h2>
                            {!isLocked && (
                                <button onClick={addItem} className="text-blue-600 text-sm font-medium hover:underline flex items-center gap-1">
                                    <Plus size={16} /> Add Line Item
                                </button>
                            )}
                        </div>

                        <div className="space-y-3">
                            {items.map((item, idx) => (
                                <div key={idx} className="flex gap-3 items-end p-3 bg-gray-50 rounded-lg border border-gray-100">
                                    <div className="flex-1">
                                        <label className="text-xs font-medium text-gray-500">Item Name / SKU</label>
                                        <ProductSearchInput
                                            initialValue={item.name}
                                            placeholder="Search by SKU or name..."
                                            disabled={isLocked}
                                            onSelect={(product: ProductSelection) => {
                                                const newItems = [...items];
                                                // Use COGS as primary cost, fallback to price only if COGS is null/undefined
                                                const costToUse = product.cogs ?? product.price ?? 0;
                                                newItems[idx] = {
                                                    ...newItems[idx],
                                                    productId: product.productId,
                                                    wooId: product.wooId,
                                                    variationWooId: product.variationWooId,
                                                    name: product.name,
                                                    sku: product.sku,
                                                    unitCost: costToUse,
                                                    totalCost: newItems[idx].quantity * costToUse
                                                };
                                                setItems(newItems);
                                            }}
                                        />
                                        {item.productId && (
                                            <div className="flex items-center gap-2 mt-1">
                                                <span className="text-xs text-green-600">✓ Linked</span>
                                                {item.sku && (
                                                    <span className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded font-mono">
                                                        {item.sku}
                                                    </span>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                    <div className="w-24">
                                        <label className="text-xs font-medium text-gray-500">Qty</label>
                                        <input
                                            type="number"
                                            value={item.quantity}
                                            onChange={(e) => updateItem(idx, 'quantity', Number(e.target.value))}
                                            disabled={isLocked}
                                            className="w-full text-sm p-2 border border-gray-300 rounded-sm"
                                        />
                                    </div>
                                    <div className="w-28">
                                        <label className="text-xs font-medium text-gray-500">Unit Cost</label>
                                        <input
                                            type="number"
                                            value={item.unitCost}
                                            onChange={(e) => updateItem(idx, 'unitCost', Number(e.target.value))}
                                            disabled={isLocked}
                                            className="w-full text-sm p-2 border border-gray-300 rounded-sm"
                                        />
                                    </div>
                                    <div className="w-24 text-right pb-2 font-medium">
                                        ${item.totalCost.toFixed(2)}
                                    </div>
                                    {!isLocked && (
                                        <button onClick={() => removeItem(idx)} className="text-red-500 hover:text-red-700 p-2">
                                            <Trash2 size={16} />
                                        </button>
                                    )}
                                </div>
                            ))}
                            {items.length === 0 && (
                                <div className="text-center py-6 text-gray-400 text-sm bg-gray-50 rounded-sm border border-dashed">
                                    No items added.
                                </div>
                            )}
                        </div>

                        <div className="flex justify-end mt-4 pt-4 border-t">
                            <div className="text-right">
                                <span className="text-gray-500 mr-4">Total Amount</span>
                                <span className="text-2xl font-bold">${grandTotal.toFixed(2)}</span>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="space-y-6">
                    {/* Settings Panel */}
                    <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-xs space-y-4">
                        <h2 className="text-lg font-semibold">Order Details</h2>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Supplier</label>
                            <SupplierSearchInput
                                value={supplierId}
                                suppliers={suppliers.map(s => ({ id: s.id, name: s.name, currency: s.currency }))}
                                onChange={(id) => setSupplierId(id)}
                                onCreateNew={() => setShowCreateSupplier(true)}
                                disabled={!isNew || isLocked}
                                placeholder="Search suppliers..."
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                            <select
                                value={status}
                                onChange={(e) => setStatus(e.target.value)}
                                disabled={isLocked}
                                className="w-full border border-gray-300 rounded-lg p-2.5 outline-hidden focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
                            >
                                <option value="DRAFT">Draft</option>
                                <option value="ORDERED">Ordered</option>
                                <option value="RECEIVED">Received</option>
                                <option value="CANCELLED">Cancelled</option>
                            </select>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Ordered Date</label>
                            <div className="relative">
                                <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                                <input
                                    type="date"
                                    value={orderDate}
                                    onChange={(e) => setOrderDate(e.target.value)}
                                    disabled={isLocked}
                                    className="pl-10 w-full border border-gray-300 rounded-lg p-2.5 outline-hidden focus:ring-2 focus:ring-blue-500"
                                />
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Expected Delivery</label>
                            <div className="relative">
                                <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                                <input
                                    type="date"
                                    value={expectedDate}
                                    onChange={(e) => setExpectedDate(e.target.value)}
                                    disabled={isLocked}
                                    className="pl-10 w-full border border-gray-300 rounded-lg p-2.5 outline-hidden focus:ring-2 focus:ring-blue-500"
                                />
                            </div>
                        </div>

                        {/* Tracking Section */}
                        <div className="border-t pt-4">
                            <h3 className="text-sm font-semibold text-gray-700 mb-3">Shipment Tracking</h3>
                            <div className="space-y-3">
                                <div>
                                    <label className="block text-xs font-medium text-gray-500 mb-1">Tracking Number</label>
                                    <input
                                        type="text"
                                        value={trackingNumber}
                                        onChange={(e) => setTrackingNumber(e.target.value)}
                                        disabled={isLocked}
                                        placeholder="e.g. 1Z999AA10123456784"
                                        className="w-full border border-gray-300 rounded-lg p-2.5 outline-hidden focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-gray-500 mb-1">Tracking Link</label>
                                    <div className="flex gap-2">
                                        <input
                                            type="url"
                                            value={trackingLink}
                                            onChange={(e) => setTrackingLink(e.target.value)}
                                            disabled={isLocked}
                                            placeholder="https://tracking.example.com/..."
                                            className="flex-1 border border-gray-300 rounded-lg p-2.5 outline-hidden focus:ring-2 focus:ring-blue-500 text-sm"
                                        />
                                        {trackingLink && (
                                            <a
                                                href={trackingLink}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="flex items-center justify-center px-3 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors"
                                                title="Open tracking link"
                                            >
                                                <ExternalLink size={18} />
                                            </a>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                            <textarea
                                value={notes}
                                onChange={(e) => setNotes(e.target.value)}
                                rows={4}
                                disabled={isLocked}
                                className="w-full border border-gray-300 rounded-lg p-2.5 outline-hidden focus:ring-2 focus:ring-blue-500 resize-none"
                            ></textarea>
                        </div>
                    </div>
                </div>
            </div>

            <CreateSupplierModal
                isOpen={showCreateSupplier}
                onClose={() => setShowCreateSupplier(false)}
                onSuccess={(newSupplier) => {
                    fetchSuppliers().then(() => {
                        setSupplierId(newSupplier.id);
                    });
                    setShowCreateSupplier(false);
                }}
            />

            <Toast message={toastMessage} isVisible={toastVisible} onClose={() => setToastVisible(false)} type={toastType} />
        </div>
    );
}
