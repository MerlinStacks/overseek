import { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { Plus, Search, Edit2, Package, Loader2, ChevronDown, ChevronRight } from 'lucide-react';

interface SupplierItem {
    id: string;
    name: string;
    sku: string;
    cost: number;
    leadTime: number;
    moq: number;
}

interface Supplier {
    id: string;
    name: string;
    contactName?: string;
    email?: string;
    currency: string;
    leadTimeDefault?: number;
    leadTimeMin?: number;
    leadTimeMax?: number;
    paymentTerms?: string;
    items?: SupplierItem[];
}

export function SuppliersList() {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [suppliers, setSuppliers] = useState<Supplier[]>([]);
    const [loading, setLoading] = useState(true);
    const [expandedSupplier, setExpandedSupplier] = useState<string | null>(null);
    const [isCreating, setIsCreating] = useState(false);
    const [newSupplier, setNewSupplier] = useState({
        name: '', contactName: '', email: '', currency: 'USD',
        leadTimeMin: '', leadTimeMax: '', paymentTerms: ''
    });

    // Item Creation State
    const [addingItemTo, setAddingItemTo] = useState<string | null>(null);
    const [newItem, setNewItem] = useState({ name: '', sku: '', cost: '0', leadTime: '7', moq: '1' });

    useEffect(() => {
        if (currentAccount) fetchSuppliers();
    }, [currentAccount]);

    async function fetchSuppliers() {
        if (!currentAccount) return;
        setLoading(true);
        try {
            const res = await fetch('/api/inventory/suppliers', {
                headers: { 'Authorization': `Bearer ${token}`, 'X-Account-ID': currentAccount.id }
            });
            const data = await res.json();
            setSuppliers(data);
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    }

    async function handleCreateSupplier(e: React.FormEvent) {
        e.preventDefault();
        try {
            const res = await fetch('/api/inventory/suppliers', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'X-Account-ID': currentAccount!.id
                },
                body: JSON.stringify(newSupplier)
            });
            if (res.ok) {
                setIsCreating(false);
                setNewSupplier({
                    name: '', contactName: '', email: '', currency: 'USD',
                    leadTimeMin: '', leadTimeMax: '', paymentTerms: ''
                });
                fetchSuppliers();
            }
        } catch (error) {
            alert('Failed to create supplier');
        }
    }

    async function handleAddItem(e: React.FormEvent) {
        e.preventDefault();
        if (!addingItemTo) return;

        try {
            const res = await fetch(`/api/inventory/suppliers/${addingItemTo}/items`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'X-Account-ID': currentAccount!.id
                },
                body: JSON.stringify(newItem)
            });
            if (res.ok) {
                setAddingItemTo(null);
                setNewItem({ name: '', sku: '', cost: '0', leadTime: '7', moq: '1' });
                fetchSuppliers(); // Refresh to see new item
            }
        } catch (error) {
            alert('Failed to add item');
        }
    }

    if (loading) return <div className="p-8 text-center"><Loader2 className="animate-spin inline text-blue-600" /></div>;

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center bg-gray-50 p-4 rounded-lg border border-gray-200">
                <h2 className="text-lg font-semibold text-gray-800">Supply Chain</h2>
                <button
                    onClick={() => setIsCreating(true)}
                    className="bg-blue-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-blue-700 transition"
                >
                    <Plus size={16} /> Add Supplier
                </button>
            </div>

            {isCreating && (
                <div className="bg-white p-6 border border-blue-200 rounded-xl shadow-xs mb-6">
                    <h3 className="font-semibold mb-4">New Supplier</h3>
                    <form onSubmit={handleCreateSupplier} className="grid grid-cols-2 gap-4">
                        <input type="text" placeholder="Supplier Name" required className="border p-2 rounded-sm"
                            value={newSupplier.name} onChange={e => setNewSupplier({ ...newSupplier, name: e.target.value })} />
                        <input type="text" placeholder="Contact Name" className="border p-2 rounded-sm"
                            value={newSupplier.contactName} onChange={e => setNewSupplier({ ...newSupplier, contactName: e.target.value })} />
                        <input type="email" placeholder="Email" className="border p-2 rounded-sm"
                            value={newSupplier.email} onChange={e => setNewSupplier({ ...newSupplier, email: e.target.value })} />
                        <select className="border p-2 rounded-sm" value={newSupplier.currency} onChange={e => setNewSupplier({ ...newSupplier, currency: e.target.value })}>
                            <option value="USD">USD</option>
                            <option value="EUR">EUR</option>
                            <option value="GBP">GBP</option>
                        </select>

                        <div className="col-span-2 grid grid-cols-3 gap-4">
                            <input type="number" placeholder="Min Lead Time (Days)" className="border p-2 rounded-sm"
                                value={newSupplier.leadTimeMin} onChange={e => setNewSupplier({ ...newSupplier, leadTimeMin: e.target.value })} />
                            <input type="number" placeholder="Max Lead Time (Days)" className="border p-2 rounded-sm"
                                value={newSupplier.leadTimeMax} onChange={e => setNewSupplier({ ...newSupplier, leadTimeMax: e.target.value })} />
                            <input type="text" placeholder="Payment Terms (e.g. Net 30)" className="border p-2 rounded-sm"
                                value={newSupplier.paymentTerms} onChange={e => setNewSupplier({ ...newSupplier, paymentTerms: e.target.value })} />
                        </div>

                        <div className="col-span-2 flex justify-end gap-2 mt-2">
                            <button type="button" onClick={() => setIsCreating(false)} className="px-4 py-2 text-gray-500">Cancel</button>
                            <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-sm">CREATE</button>
                        </div>
                    </form>
                </div>
            )}

            <div className="space-y-4">
                {suppliers.map(supplier => (
                    <div key={supplier.id} className="bg-white border rounded-xl overflow-hidden shadow-xs">
                        <div
                            className="p-4 flex items-center justify-between cursor-pointer hover:bg-gray-50"
                            onClick={() => setExpandedSupplier(expandedSupplier === supplier.id ? null : supplier.id)}
                        >
                            <div className="flex items-center gap-3">
                                {expandedSupplier === supplier.id ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                                <div>
                                    <div className="font-medium text-gray-900">{supplier.name}</div>
                                    <div className="text-xs text-gray-500 mt-0.5 flex gap-3">
                                        <span>{supplier.items?.length || 0} items</span>
                                        {supplier.paymentTerms && <span>• {supplier.paymentTerms}</span>}
                                        {(supplier.leadTimeMin || supplier.leadTimeMax) && (
                                            <span>• Lead: {supplier.leadTimeMin || 0} - {supplier.leadTimeMax || '?'} days</span>
                                        )}
                                    </div>
                                </div>
                            </div>
                            <div className="text-sm text-gray-500">{supplier.email || '-'}</div>
                        </div>

                        {expandedSupplier === supplier.id && (
                            <div className="bg-gray-50 border-t p-4">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="text-left text-gray-500 border-b">
                                            <th className="pb-2">Material / Component</th>
                                            <th className="pb-2">SKU</th>
                                            <th className="pb-2">Cost</th>
                                            <th className="pb-2">Lead Time</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {supplier.items?.map(item => (
                                            <tr key={item.id} className="border-b last:border-0 border-gray-100">
                                                <td className="py-2 font-medium">{item.name}</td>
                                                <td className="py-2 font-mono text-xs">{item.sku || '-'}</td>
                                                <td className="py-2">${Number(item.cost).toFixed(2)}</td>
                                                <td className="py-2">{item.leadTime} days</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>

                                {addingItemTo === supplier.id ? (
                                    <form onSubmit={handleAddItem} className="mt-4 bg-white p-4 border rounded-sm shadow-xs">
                                        <h4 className="font-semibold mb-2">Add Material</h4>
                                        <div className="grid grid-cols-5 gap-2">
                                            <input className="border p-2 rounded-sm col-span-2" placeholder="Item Name" required
                                                value={newItem.name} onChange={e => setNewItem({ ...newItem, name: e.target.value })} />
                                            <input className="border p-2 rounded-sm" placeholder="SKU"
                                                value={newItem.sku} onChange={e => setNewItem({ ...newItem, sku: e.target.value })} />
                                            <input className="border p-2 rounded-sm" type="number" step="0.01" placeholder="Cost" required
                                                value={newItem.cost} onChange={e => setNewItem({ ...newItem, cost: e.target.value })} />
                                            <input className="border p-2 rounded-sm" type="number" placeholder="Lead Time (days)" required
                                                value={newItem.leadTime} onChange={e => setNewItem({ ...newItem, leadTime: e.target.value })} />
                                        </div>
                                        <div className="flex justify-end gap-2 mt-2">
                                            <button type="button" onClick={() => setAddingItemTo(null)} className="text-gray-500 text-sm">Cancel</button>
                                            <button type="submit" className="bg-green-600 text-white px-3 py-1 rounded-sm text-sm">Save Item</button>
                                        </div>
                                    </form>
                                ) : (
                                    <button
                                        onClick={(e) => { e.stopPropagation(); setAddingItemTo(supplier.id); }}
                                        className="mt-4 text-blue-600 text-sm font-medium flex items-center gap-1 hover:underline"
                                    >
                                        <Plus size={14} /> Add Material to Catalog
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}
