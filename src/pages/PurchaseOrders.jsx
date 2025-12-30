import React, { useState, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { Search, Plus, Trash2, Calendar, Truck, X, RefreshCw } from 'lucide-react';
import { toast, Toaster } from 'sonner';
import { useSettings } from '../context/SettingsContext';
import { useSync } from '../context/SyncContext'; // Import SyncContext
import { fetchTaxRates } from '../services/api';
import Pagination from '../components/Pagination';
import './Inventory.css';

const PurchaseOrders = () => {
    const orders = useLiveQuery(() => db.purchase_orders.reverse().toArray()) || [];
    const suppliers = useLiveQuery(() => db.suppliers.toArray()) || [];
    const taxRates = useLiveQuery(() => db.tax_rates.toArray()) || []; // Load tax rates
    const { settings } = useSettings(); // Need settings to fetch/sync
    const { startSync, status: syncStatus } = useSync(); // Use Sync Context

    // Filter State
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState('all');

    // Pagination State
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage, setItemsPerPage] = useState(15);

    // Modal State
    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const [selectedOrder, setSelectedOrder] = useState(null); // For viewing details

    const getSupplierName = (id) => suppliers.find(s => s.id === id)?.name || 'Unknown Supplier';

    const getStatusChipClass = (status) => {
        switch (status) {
            case 'draft': return 'chip-gray';
            case 'ordered': return 'chip-blue';
            case 'received': return 'chip-green';
            case 'cancelled': return 'chip-red';
            default: return 'chip-gray';
        }
    };

    const handleDelete = async (e, id) => {
        e.stopPropagation();
        if (confirm('Delete this purchase order?')) {
            await db.purchase_orders.delete(id);
            toast.success('PO deleted');
        }
    };

    // Reset pagination on filter change
    useEffect(() => {
        setCurrentPage(1);
    }, [searchTerm, statusFilter]);

    const filtered = orders.filter(o => {
        if (statusFilter !== 'all' && o.status !== statusFilter) return false;
        const sName = getSupplierName(o.supplier_id).toLowerCase();
        return sName.includes(searchTerm.toLowerCase()) || o.id.toString().includes(searchTerm);
    });

    // Pagination Logic
    const totalItems = filtered.length;
    const totalPages = Math.ceil(totalItems / itemsPerPage);
    const paginatedOrders = filtered.slice(
        (currentPage - 1) * itemsPerPage,
        currentPage * itemsPerPage
    );

    return (
        <div className="inventory-page">
            <Toaster position="top-right" theme="dark" />

            <div className="inventory-header">
                <div className="header-content">
                    <div className="inventory-icon-wrapper" style={{ color: 'var(--warning)', background: 'rgba(245, 158, 11, 0.2)' }}>
                        <Truck size={32} />
                    </div>
                    <div className="inventory-title">
                        <h2>Purchase Orders</h2>
                        <p>Track incoming stock from suppliers.</p>
                    </div>
                </div>

                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                    <button
                        onClick={() => startSync({ forceFull: false })}
                        className="btn"
                        title="Sync All Data (Taxes, Products, Orders...)"
                        disabled={syncStatus === 'running' || syncStatus === 'paused'}
                    >
                        <RefreshCw size={16} className={syncStatus === 'running' ? 'spin' : ''} />
                    </button>
                    <select
                        className="form-input"
                        value={statusFilter}
                        onChange={e => setStatusFilter(e.target.value)}
                        style={{ width: '150px' }}
                    >
                        <option value="all">All Status</option>
                        <option value="draft">Draft</option>
                        <option value="ordered">Ordered</option>
                        <option value="received">Received</option>
                        <option value="cancelled">Cancelled</option>
                    </select>

                    <div className="input-wrapper" style={{ width: '250px' }}>
                        <input
                            className="form-input"
                            style={{ width: '100%' }}
                            placeholder="Search orders..."
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                        />
                        <Search className="input-icon" size={18} />
                    </div>
                    <button
                        onClick={() => setIsCreateOpen(true)}
                        className="btn btn-primary"
                    >
                        <Plus size={16} /> New PO
                    </button>
                </div>
            </div>

            <div className="glass-panel inventory-table-container">
                <table className="inventory-table">
                    <thead>
                        <tr>
                            <th>PO #</th>
                            <th>Supplier</th>
                            <th>Date Created</th>
                            <th>Expected</th>
                            <th>Status</th>
                            <th style={{ textAlign: 'right' }}>Total Cost</th>
                            <th style={{ textAlign: 'right' }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {paginatedOrders.map(order => (
                            <tr
                                key={order.id}
                                onClick={() => setSelectedOrder(order)}
                                style={{ cursor: 'pointer' }}
                            >
                                <td style={{ fontFamily: 'monospace' }}>PO-{order.id}</td>
                                <td style={{ fontWeight: 500 }}>{getSupplierName(order.supplier_id)}</td>
                                <td className="text-muted">{new Date(order.date_created).toLocaleDateString()}</td>
                                <td className="text-muted">{order.expected_date ? new Date(order.expected_date).toLocaleDateString() : '-'}</td>
                                <td>
                                    <span className={`chip ${getStatusChipClass(order.status)}`} style={{ textTransform: 'capitalize' }}>
                                        {order.status}
                                    </span>
                                </td>
                                <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>
                                    ${(order.items || []).reduce((sum, item) => sum + (item.quantity * item.cost), 0).toFixed(2)}
                                </td>
                                <td style={{ textAlign: 'right' }}>
                                    <button
                                        onClick={(e) => handleDelete(e, order.id)}
                                        className="btn"
                                        style={{ padding: '6px', background: 'transparent', color: 'var(--danger)' }}
                                    >
                                        <Trash2 size={16} />
                                    </button>
                                </td>
                            </tr>
                        ))}
                        {paginatedOrders.length === 0 && (
                            <tr><td colSpan="7" style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>No purchase orders found.</td></tr>
                        )}
                    </tbody>
                </table>
                <Pagination
                    currentPage={currentPage}
                    totalPages={totalPages}
                    itemsPerPage={itemsPerPage}
                    onPageChange={setCurrentPage}
                    onItemsPerPageChange={setItemsPerPage}
                    totalItems={totalItems}
                />
            </div>

            {/* Create Modal */}
            {isCreateOpen && (
                <CreatePOModal
                    suppliers={suppliers}
                    onClose={() => setIsCreateOpen(false)}
                />
            )}

            {/* View/Edit Modal */}
            {selectedOrder && (
                <ViewPOModal
                    order={selectedOrder}
                    suppliers={suppliers}
                    onClose={() => setSelectedOrder(null)}
                />
            )}
        </div>
    );
};

// --- Create Modal ---
const CreatePOModal = ({ suppliers, onClose }) => {
    const [supplierId, setSupplierId] = useState('');
    const [creating, setCreating] = useState(false);

    const handleCreate = async () => {
        if (!supplierId) return;
        setCreating(true);
        try {
            await db.purchase_orders.add({
                supplier_id: parseInt(supplierId),
                status: 'draft',
                date_created: new Date().toISOString(),
                items: [] // { product_id, quantity, cost, tax_rate }
            });
            toast.success("PO Created");
            onClose();
        } catch (e) {
            toast.error("Error creating PO");
        } finally {
            setCreating(false);
        }
    };

    return (
        <div className="modal-overlay">
            <div className="modal-content" style={{ maxWidth: '400px' }}>
                <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                    <div>
                        <h2 className="modal-title">Create Purchase Order</h2>
                        <p className="modal-desc">Start a new order for a supplier.</p>
                    </div>
                    <button onClick={onClose} className="btn-icon">
                        <X size={20} />
                    </button>
                </div>

                <div className="form-group">
                    <label className="input-label">Select Supplier</label>
                    <select
                        className="form-input"
                        value={supplierId}
                        onChange={e => setSupplierId(e.target.value)}
                    >
                        <option value="">-- Choose Supplier --</option>
                        {suppliers.map(s => (
                            <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                    </select>
                </div>

                <div className="modal-footer">
                    <button onClick={onClose} className="btn" style={{ background: 'transparent' }}>Cancel</button>
                    <button onClick={handleCreate} disabled={!supplierId || creating} className="btn btn-primary">Create Draft</button>
                </div>
            </div>
        </div>
    );
}

// --- View/Edit Modal ---
const ViewPOModal = ({ order, suppliers, onClose }) => {
    const products = useLiveQuery(() => db.products.toArray()) || [];
    const [items, setItems] = useState(order.items || []);
    const [status, setStatus] = useState(order.status);
    const [expectedDate, setExpectedDate] = useState(order.expected_date || '');

    // Add Item State
    const [addPid, setAddPid] = useState('');
    const [addQty, setAddQty] = useState(1);
    const [addCost, setAddCost] = useState(0);
    const [addTaxRate, setAddTaxRate] = useState(0); // Helper state for tax %
    const [searchTerm, setSearchTerm] = useState(''); // For product dropdown
    const [showResults, setShowResults] = useState(false);

    const supplier = suppliers.find(s => s.id === order.supplier_id);
    // Tax & Settings
    const [taxes, setTaxes] = useState([]);

    // Load tax rates if available in DB
    useEffect(() => {
        db.tax_rates.toArray().then(setTaxes);
    }, []);

    // Calculations
    const calculateTotals = () => {
        let subtotal = 0;
        let taxTotal = 0;
        items.forEach(i => {
            const lineTotal = i.quantity * i.cost;
            subtotal += lineTotal;
            // Assuming simplified tax handling: item.tax_rate is a percentage (e.g., 10 for 10%)
            if (i.tax_rate) {
                taxTotal += lineTotal * (parseFloat(i.tax_rate) / 100);
            }
        });
        return { subtotal, taxTotal, total: subtotal + taxTotal };
    };

    const { subtotal, taxTotal, total } = calculateTotals();

    const handleAddItem = (e) => {
        e.preventDefault();
        if (!addPid) return;

        const newItem = {
            product_id: parseInt(addPid),
            quantity: parseFloat(addQty),
            cost: parseFloat(addCost),
            tax_rate: parseFloat(addTaxRate) || 0
        };
        setItems([...items, newItem]);
        // console.log("Added Item:", newItem);
        setAddPid('');
        setAddQty(1);
        setAddCost(0);
        setAddTaxRate(0); // Resetting to 0 is safer.
        setSearchTerm(''); // Reset search
        setShowResults(false);
    };

    const handleRemoveItem = (idx) => {
        const newItems = [...items];
        newItems.splice(idx, 1);
        setItems(newItems);
    };

    const saveChanges = async () => {
        await db.purchase_orders.update(order.id, {
            items,
            status,
            expected_date: expectedDate
        });
        toast.success("Order updated");
        onClose();
    };

    return (

        <div className="modal-overlay">
            <div className="modal-content" style={{ maxWidth: '1000px', width: '90%', maxHeight: '90vh', display: 'flex', flexDirection: 'column', padding: 0 }}>
                {/* Header */}
                <div className="modal-header" style={{ padding: '1.5rem', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                            <h2 className="modal-title" style={{ fontFamily: 'monospace' }}>PO-{order.id}</h2>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginTop: '0.5rem', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                                <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><Truck size={14} /> {supplier?.name}</span>
                                <span>•</span>
                                <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><Calendar size={14} /> {new Date(order.date_created).toLocaleDateString()}</span>
                            </div>
                        </div>
                        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                            <select
                                className="form-input"
                                value={status}
                                onChange={e => setStatus(e.target.value)}
                                style={{ padding: '0.4rem', fontSize: '0.9rem' }}
                            >
                                <option value="draft">Draft</option>
                                <option value="ordered">Ordered</option>
                                <option value="received">Received</option>
                                <option value="cancelled">Cancelled</option>
                            </select>
                            <button onClick={onClose} className="btn-icon">
                                <X size={20} />
                            </button>
                        </div>
                    </div>
                </div>

                {/* Body */}
                <div className="modal-body" style={{ flex: 1, overflowY: 'auto', padding: '1.5rem', display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '2rem' }}>
                    {/* Items List */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

                        {/* Add Item Form (Only if Draft) - MOVED TO TOP */}
                        {status === 'draft' && (
                            <div className="glass-panel" style={{ background: 'rgba(255,255,255,0.03)', overflow: 'visible' }}> {/* Overflow visible for dropdown */}
                                <h4 style={{ fontSize: '0.9rem', fontWeight: 'bold', marginBottom: '1rem' }}>Add Item</h4>
                                <form onSubmit={handleAddItem} style={{ display: 'flex', gap: '1rem', alignItems: 'end' }}>
                                    <div style={{ flex: 1, position: 'relative' }}>
                                        <label className="input-label">Product Search</label>
                                        <div style={{ position: 'relative' }}>
                                            <input
                                                type="text"
                                                className="form-input"
                                                placeholder="Type to search product..."
                                                value={searchTerm}
                                                onChange={e => {
                                                    setSearchTerm(e.target.value);
                                                    setShowResults(true);
                                                    setAddPid(''); // Reset selected if typing
                                                }}
                                                onFocus={() => setShowResults(true)}
                                            />
                                            {/* Custom Dropdown Results */}
                                            {showResults && searchTerm && (
                                                <div className="glass-panel" style={{
                                                    position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100,
                                                    maxHeight: '200px', overflowY: 'auto', padding: '0.5rem', background: '#1e293b',
                                                    border: '1px solid rgba(255,255,255,0.1)'
                                                }}>
                                                    {products
                                                        .filter(p => p.name.toLowerCase().includes(searchTerm.toLowerCase()))
                                                        .map(p => (
                                                            <div
                                                                key={p.id}
                                                                style={{
                                                                    padding: '8px', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.05)',
                                                                    display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                                                                }}
                                                                className="search-result-item"
                                                                onClick={() => {
                                                                    setSearchTerm(p.name);
                                                                    setAddPid(p.id);
                                                                    if (p.cost_price) setAddCost(p.cost_price);
                                                                    setShowResults(false);
                                                                }}
                                                            >
                                                                <span>{p.name}</span>
                                                                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>${p.cost_price || 0}</span>
                                                            </div>
                                                        ))}
                                                    {products.filter(p => p.name.toLowerCase().includes(searchTerm.toLowerCase())).length === 0 && (
                                                        <div style={{ padding: '8px', color: 'var(--text-muted)' }}>No products found</div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                    <div style={{ width: '80px' }}>
                                        <label className="input-label">Qty</label>
                                        <input type="number" className="form-input" value={addQty} onChange={e => setAddQty(e.target.value)} />
                                    </div>
                                    <div style={{ width: '100px' }}>
                                        <label className="input-label">Unit Cost</label>
                                        <input type="number" step="0.01" className="form-input" value={addCost} onChange={e => setAddCost(e.target.value)} />
                                    </div>
                                    <div style={{ width: '100px' }}>
                                        <label className="input-label">Tax %</label>
                                        <select
                                            className="form-input"
                                            value={addTaxRate}
                                            onChange={e => setAddTaxRate(e.target.value)}
                                            style={{ paddingRight: '0' }}
                                        >
                                            <option value="0">0%</option>
                                            {taxes.map(t => (
                                                <option key={t.id} value={t.rate}>
                                                    {t.name} ({parseFloat(t.rate).toFixed(1)}%)
                                                </option>
                                            ))}
                                            {/* Fallback if no taxes loaded */}
                                            {taxes.length === 0 && <option value="10">Standard (10%)</option>}
                                        </select>
                                    </div>
                                    <button type="submit" className="btn btn-secondary" disabled={!addPid}><Plus size={16} /></button>
                                </form>
                            </div>
                        )}

                        <div>
                            <h3 className="modal-section-title">Order Items</h3>
                            <div className="glass-panel" style={{ padding: 0, overflow: 'hidden' }}>
                                <table className="inventory-table" style={{ margin: 0 }}>
                                    <thead>
                                        <tr>
                                            <th>Product</th>
                                            <th style={{ textAlign: 'right' }}>Qty</th>
                                            <th style={{ textAlign: 'right' }}>Unit Cost</th>
                                            <th style={{ textAlign: 'right' }}>Tax</th>
                                            <th style={{ textAlign: 'right' }}>Total</th>
                                            <th style={{ width: '40px' }}></th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {items.map((item, idx) => {
                                            const p = products.find(x => x.id === item.product_id);
                                            return (
                                                <tr key={idx}>
                                                    <td>
                                                        <div style={{ fontWeight: 500 }}>{p?.name || 'Unknown Product'}</div>
                                                        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{p?.sku}</div>
                                                    </td>
                                                    <td style={{ textAlign: 'right' }}>{item.quantity}</td>
                                                    <td style={{ textAlign: 'right' }}>${item.cost.toFixed(2)}</td>
                                                    <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>
                                                        {item.tax_rate > 0 ? `${item.tax_rate}%` : '-'}
                                                    </td>
                                                    <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>
                                                        ${((item.quantity * item.cost) * (1 + (item.tax_rate || 0) / 100)).toFixed(2)}
                                                    </td>
                                                    <td style={{ textAlign: 'center' }}>
                                                        {status === 'draft' && (
                                                            <button onClick={() => handleRemoveItem(idx)} className="btn-icon" style={{ color: '#ef4444' }}>
                                                                <Trash2 size={14} />
                                                            </button>
                                                        )}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                        {items.length === 0 && (
                                            <tr><td colSpan="6" style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>No items in order.</td></tr>
                                        )}
                                    </tbody>
                                    <tfoot>
                                        <tr style={{ background: 'rgba(255,255,255,0.02)' }}>
                                            <td colSpan="4" style={{ textAlign: 'right', color: 'var(--text-muted)' }}>Subtotal:</td>
                                            <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>${subtotal.toFixed(2)}</td>
                                            <td></td>
                                        </tr>
                                        <tr style={{ background: 'rgba(255,255,255,0.02)' }}>
                                            <td colSpan="4" style={{ textAlign: 'right', color: 'var(--text-muted)' }}>Tax:</td>
                                            <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>${taxTotal.toFixed(2)}</td>
                                            <td></td>
                                        </tr>
                                        <tr style={{ background: 'rgba(255,255,255,0.05)', fontWeight: 'bold' }}>
                                            <td colSpan="4" style={{ textAlign: 'right' }}>Total:</td>
                                            <td style={{ textAlign: 'right', color: '#10b981', fontFamily: 'monospace' }}>${total.toFixed(2)}</td>
                                            <td></td>
                                        </tr>
                                    </tfoot>
                                </table>
                            </div>
                        </div>
                    </div>

                    {/* Details Sidebar */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                        <div>
                            <label className="input-label">Expected Delivery Date</label>
                            <input
                                type="date"
                                className="form-input"
                                value={expectedDate ? new Date(expectedDate).toISOString().split('T')[0] : ''}
                                onChange={e => setExpectedDate(e.target.value)}
                            />
                        </div>

                        <div className="glass-panel" style={{ background: 'rgba(255,255,255,0.03)' }}>
                            <h4 className="modal-section-title">Supplier Info</h4>
                            {supplier ? (
                                <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                    <p style={{ color: 'var(--text-primary)', fontWeight: 'bold' }}>{supplier.name}</p>
                                    <p>{supplier.contact_person}</p>
                                    <p>{supplier.email}</p>
                                    <p>{supplier.phone}</p>
                                </div>
                            ) : <p className="text-muted">N/A</p>}
                        </div>
                    </div>
                </div>

                <div className="modal-footer" style={{ padding: '1.5rem', borderTop: '1px solid rgba(255,255,255,0.1)', display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
                    <button onClick={onClose} className="btn" style={{ background: 'transparent' }}>Close</button>
                    <button onClick={saveChanges} className="btn btn-primary">Save Order</button>
                </div>
            </div>
        </div>
    );
};

export default PurchaseOrders;
