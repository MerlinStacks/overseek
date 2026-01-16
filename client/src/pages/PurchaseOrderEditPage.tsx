import { useState, useEffect } from 'react';
import { Logger } from '../utils/logger';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useAccount } from '../context/AccountContext';
import { ArrowLeft, Save, Plus, Trash2, Loader2, Calendar } from 'lucide-react';
import { CreateSupplierModal } from '../components/inventory/CreateSupplierModal';

interface POItem {
    id?: string;
    productId?: string;
    supplierItemId?: string;
    name: string;
    quantity: number;
    unitCost: number;
    totalCost: number;
    sku?: string;
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
    const [expectedDate, setExpectedDate] = useState('');
    const [items, setItems] = useState<POItem[]>([]);
    const [showCreateSupplier, setShowCreateSupplier] = useState(false);

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
                setExpectedDate(data.expectedDate ? data.expectedDate.split('T')[0] : '');
                setPoNumber(data.orderNumber || '');

                // Map items
                setItems(data.items.map((i: any) => ({
                    id: i.id,
                    productId: i.productId,
                    supplierItemId: i.supplierItemId,
                    name: i.name,
                    sku: i.sku,
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
        if (!supplierId) return alert('Select a supplier');

        setIsLoading(true);
        const payload = {
            supplierId,
            status,
            notes,
            expectedDate: expectedDate || null,
            items: items.map(i => ({
                productId: i.productId,
                supplierItemId: i.supplierItemId,
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
                navigate('/inventory'); // Or back to list tab? We need to ensure tab state... 
                // Navigate to /inventory?tab=purchasing would be ideal if we supported query param tabs.
                // For now just /inventory.
            } else {
                alert('Failed to save');
            }
        } catch (err) {
            Logger.error('An error occurred', { error: err });
            alert('Error saving');
        } finally {
            setIsLoading(false);
        }
    };

    if (isLoading && !isNew && items.length === 0) {
        return <div className="p-12 text-center"><Loader2 className="animate-spin inline" /> Loading PO...</div>;
    }

    const grandTotal = items.reduce((acc, item) => acc + (item.totalCost || 0), 0);
    const selectedSupplier = suppliers.find(s => s.id === supplierId);

    return (
        <div className="max-w-5xl mx-auto space-y-6">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <button onClick={() => navigate('/inventory')} className="p-2 hover:bg-gray-100 rounded-full">
                        <ArrowLeft size={20} />
                    </button>
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900">{isNew ? 'New Purchase Order' : `Edit PO ${poNumber || id?.substring(0, 8)}`}</h1>
                        <p className="text-gray-500">Manage order details and items</p>
                    </div>
                </div>
                <div className="flex gap-2">
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

            <div className="grid grid-cols-3 gap-6">
                <div className="col-span-2 space-y-6">
                    {/* Items Panel */}
                    <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-xs">
                        <div className="flex justify-between items-center mb-4">
                            <h2 className="text-lg font-semibold">Order Items</h2>
                            <button onClick={addItem} className="text-blue-600 text-sm font-medium hover:underline flex items-center gap-1">
                                <Plus size={16} /> Add Line Item
                            </button>
                        </div>

                        <div className="space-y-3">
                            {items.map((item, idx) => (
                                <div key={idx} className="flex gap-3 items-end p-3 bg-gray-50 rounded-lg border border-gray-100">
                                    <div className="flex-1">
                                        <label className="text-xs font-medium text-gray-500">Item Name / SKU</label>
                                        <input
                                            type="text"
                                            value={item.name}
                                            onChange={(e) => updateItem(idx, 'name', e.target.value)}
                                            placeholder="Product Name"
                                            className="w-full text-sm p-2 border border-gray-300 rounded-sm"
                                        />
                                    </div>
                                    <div className="w-24">
                                        <label className="text-xs font-medium text-gray-500">Qty</label>
                                        <input
                                            type="number"
                                            value={item.quantity}
                                            onChange={(e) => updateItem(idx, 'quantity', Number(e.target.value))}
                                            className="w-full text-sm p-2 border border-gray-300 rounded-sm"
                                        />
                                    </div>
                                    <div className="w-28">
                                        <label className="text-xs font-medium text-gray-500">Unit Cost</label>
                                        <input
                                            type="number"
                                            value={item.unitCost}
                                            onChange={(e) => updateItem(idx, 'unitCost', Number(e.target.value))}
                                            className="w-full text-sm p-2 border border-gray-300 rounded-sm"
                                        />
                                    </div>
                                    <div className="w-24 text-right pb-2 font-medium">
                                        ${item.totalCost.toFixed(2)}
                                    </div>
                                    <button onClick={() => removeItem(idx)} className="text-red-500 hover:text-red-700 p-2">
                                        <Trash2 size={16} />
                                    </button>
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
                            <select
                                value={supplierId}
                                onChange={(e) => {
                                    if (e.target.value === '__new__') {
                                        setShowCreateSupplier(true);
                                    } else {
                                        setSupplierId(e.target.value);
                                    }
                                }}
                                disabled={!isNew}
                                className="w-full border border-gray-300 rounded-lg p-2.5 outline-hidden focus:ring-2 focus:ring-blue-500"
                            >
                                <option value="">Select Supplier...</option>
                                {suppliers.map(s => (
                                    <option key={s.id} value={s.id}>{s.name} ({s.currency})</option>
                                ))}
                                {isNew && <option value="__new__" className="text-blue-600 font-medium">+ New Supplier</option>}
                            </select>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                            <select
                                value={status}
                                onChange={(e) => setStatus(e.target.value)}
                                className="w-full border border-gray-300 rounded-lg p-2.5 outline-hidden focus:ring-2 focus:ring-blue-500"
                            >
                                <option value="DRAFT">Draft</option>
                                <option value="ORDERED">Ordered</option>
                                <option value="RECEIVED">Received</option>
                                <option value="CANCELLED">Cancelled</option>
                            </select>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Expected Date</label>
                            <div className="relative">
                                <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                                <input
                                    type="date"
                                    value={expectedDate}
                                    onChange={(e) => setExpectedDate(e.target.value)}
                                    className="pl-10 w-full border border-gray-300 rounded-lg p-2.5 outline-hidden focus:ring-2 focus:ring-blue-500"
                                />
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                            <textarea
                                value={notes}
                                onChange={(e) => setNotes(e.target.value)}
                                rows={4}
                                className="w-full border border-gray-300 rounded-lg p-2.5 outline-hidden focus:ring-2 focus:ring-blue-500 resize-none"
                            ></textarea>
                        </div>
                    </div>
                </div>
            </div>

            {/* Inline Supplier Creation Modal */}
            <CreateSupplierModal
                isOpen={showCreateSupplier}
                onClose={() => setShowCreateSupplier(false)}
                onSuccess={(newSupplier) => {
                    // Refresh suppliers list and auto-select the new one
                    fetchSuppliers().then(() => {
                        setSupplierId(newSupplier.id);
                    });
                    setShowCreateSupplier(false);
                }}
            />
        </div>
    );
}
