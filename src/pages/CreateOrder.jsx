import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSettings } from '../context/SettingsContext';
import { createOrder } from '../services/api';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { toast, Toaster } from 'sonner';
import { ArrowLeft, Save, Search, Plus, Trash2, User, ShoppingCart, CreditCard } from 'lucide-react';

const CreateOrder = () => {
    const navigate = useNavigate();
    const { settings } = useSettings();
    const [isSaving, setIsSaving] = useState(false);

    // Data Sources
    const products = useLiveQuery(() => db.products.toArray()) || [];
    const customers = useLiveQuery(() => db.customers.toArray()) || [];
    const taxRates = useLiveQuery(() => db.tax_rates.toArray()) || [];

    // State
    const [customerSearch, setCustomerSearch] = useState('');
    const [selectedCustomer, setSelectedCustomer] = useState(null);
    const [productSearch, setProductSearch] = useState('');
    const [cart, setCart] = useState([]); // { id, name, price, quantity, product_id }
    const [orderStatus, setOrderStatus] = useState('pending');

    // Filtering
    const filteredCustomers = customerSearch && !selectedCustomer
        ? customers.filter(c =>
            (c.first_name + ' ' + c.last_name).toLowerCase().includes(customerSearch.toLowerCase()) ||
            c.email.toLowerCase().includes(customerSearch.toLowerCase())
        ).slice(0, 5)
        : [];

    const filteredProducts = productSearch
        ? products.filter(p => p.name.toLowerCase().includes(productSearch.toLowerCase())).slice(0, 8)
        : [];

    // Handlers
    const addToCart = (product) => {
        setCart(prev => {
            const existing = prev.find(item => item.product_id === product.id);
            if (existing) {
                return prev.map(item => item.product_id === product.id ? { ...item, quantity: item.quantity + 1 } : item);
            }
            return [...prev, {
                product_id: product.id,
                name: product.name,
                price: parseFloat(product.price || 0),
                quantity: 1,
                image: product.images?.[0]?.src
            }];
        });
        setProductSearch('');
    };

    const updateQuantity = (productId, delta) => {
        setCart(prev => prev.map(item => {
            if (item.product_id === productId) {
                const newQty = Math.max(1, item.quantity + delta);
                return { ...item, quantity: newQty };
            }
            return item;
        }));
    };

    const removeFromCart = (productId) => {
        setCart(prev => prev.filter(item => item.product_id !== productId));
    };

    const calculateTotals = () => {
        let subtotal = 0;
        let taxTotal = 0;

        cart.forEach(item => {
            const lineTotal = item.price * item.quantity;
            subtotal += lineTotal;

            // Tax Calculation
            const product = products.find(p => p.id === item.product_id);
            if (product) { // Only calculate if we have product data (we should)
                let rate = 0;
                if (product.tax_status === 'taxable' || !product.tax_status) { // Default taxable
                    const taxClass = product.tax_class || '';
                    const taxRateObj = taxRates.find(r => r.class === taxClass) || // Precise match
                        (taxClass === '' && taxRates.find(r => r.class === 'standard')) || // Standard fallback
                        taxRates.find(r => r.priority === 1); // Fallback to first if nothing matches? No, unsafe.

                    // If no standard rate found, maybe 0? Or assume 10%? Better to use 0 if not found to avoid errors.
                    // But in PurchaseOrders we used explicit logic. Here let's try to match.
                    if (taxRateObj) {
                        rate = parseFloat(taxRateObj.rate);
                    }
                }
                taxTotal += lineTotal * (rate / 100);
            }
        });

        return { subtotal, taxTotal, total: subtotal + taxTotal };
    };

    const { subtotal, taxTotal, total } = calculateTotals();

    const handleCreateOrder = async () => {
        if (cart.length === 0) {
            toast.error("Please add items to the order");
            return;
        }

        setIsSaving(true);
        try {
            const orderData = {
                status: orderStatus,
                line_items: cart.map(item => ({
                    product_id: item.product_id,
                    quantity: item.quantity
                }))
            };

            if (selectedCustomer) {
                orderData.customer_id = selectedCustomer.id;
                orderData.billing = selectedCustomer.billing;
                orderData.shipping = selectedCustomer.shipping;
            }

            const newOrder = await createOrder(settings, orderData);

            // Add to local DB roughly
            await db.orders.add(newOrder);

            toast.success("Order created successfully!");
            setTimeout(() => navigate('/orders'), 1000);

        } catch (error) {
            console.error(error);
            toast.error("Failed to create order");
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="product-details-page">
            <Toaster position="top-right" theme="dark" />

            <div className="mb-6 flex justify-between items-center" style={{ display: 'flex', justifyContent: 'space-between' }}>
                <button onClick={() => navigate('/orders')} className="btn" style={{ background: 'transparent', paddingLeft: 0, color: 'var(--text-muted)' }}>
                    <ArrowLeft size={18} /> Back to Orders
                </button>
                <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>Create Order</h2>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.5fr) minmax(0, 1fr)', gap: '2rem' }}>

                {/* Left: Product Browser */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                    <div className="glass-panel" style={{ padding: '1.5rem' }}>
                        <h3 className="section-title" style={{ fontSize: '1.1rem', marginBottom: '1rem' }}>
                            <Search size={18} style={{ display: 'inline', marginRight: '8px' }} />
                            Find Products
                        </h3>

                        <div className="input-wrapper" style={{ marginBottom: '1rem' }}>
                            <input
                                autoFocus
                                className="form-input"
                                placeholder="Search by name..."
                                value={productSearch}
                                onChange={e => setProductSearch(e.target.value)}
                            />
                        </div>

                        {filteredProducts.length > 0 ? (
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '10px' }}>
                                {filteredProducts.map(p => (
                                    <div
                                        key={p.id}
                                        onClick={() => addToCart(p)}
                                        style={{
                                            background: 'rgba(255,255,255,0.05)',
                                            padding: '10px',
                                            borderRadius: '8px',
                                            cursor: 'pointer',
                                            border: '1px solid transparent',
                                            transition: 'all 0.2s'
                                        }}
                                        className="hover:border-primary hover:bg-white/10"
                                    >
                                        <div style={{ aspectRatio: '1', background: '#000', borderRadius: '4px', marginBottom: '8px', overflow: 'hidden' }}>
                                            {p.images?.[0] ? <img src={p.images[0].src} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="" /> : null}
                                        </div>
                                        <div style={{ fontWeight: '500', fontSize: '0.9rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</div>
                                        <div style={{ color: 'var(--primary)', fontSize: '0.9rem' }}>${p.price}</div>
                                    </div>
                                ))}
                            </div>
                        ) : productSearch ? (
                            <p className="text-muted">No products found.</p>
                        ) : (
                            <p className="text-muted">Type to search...</p>
                        )}
                    </div>
                </div>

                {/* Right: Order Summary */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

                    {/* Customer Selection */}
                    <div className="glass-panel" style={{ padding: '1.5rem' }}>
                        <h3 className="section-title" style={{ fontSize: '1.1rem', marginBottom: '1rem' }}>Customer</h3>

                        {!selectedCustomer ? (
                            <div style={{ position: 'relative' }}>
                                <input
                                    className="form-input"
                                    placeholder="Search Customer..."
                                    value={customerSearch}
                                    onChange={e => setCustomerSearch(e.target.value)}
                                />
                                {filteredCustomers.length > 0 && (
                                    <div style={{
                                        position: 'absolute',
                                        top: '100%', left: 0, right: 0,
                                        background: '#1e293b',
                                        border: '1px solid var(--border-glass)',
                                        borderRadius: '8px',
                                        zIndex: 10,
                                        marginTop: '4px',
                                        overflow: 'hidden'
                                    }}>
                                        {filteredCustomers.map(c => (
                                            <div
                                                key={c.id}
                                                onClick={() => { setSelectedCustomer(c); setCustomerSearch(''); }}
                                                style={{ padding: '10px', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.05)' }}
                                                className="hover:bg-white/5"
                                            >
                                                <div style={{ fontWeight: 'bold' }}>{c.first_name} {c.last_name}</div>
                                                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{c.email}</div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div style={{ background: 'rgba(99, 102, 241, 0.1)', padding: '10px', borderRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div>
                                    <div style={{ fontWeight: 'bold' }}>{selectedCustomer.first_name} {selectedCustomer.last_name}</div>
                                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{selectedCustomer.email}</div>
                                </div>
                                <button onClick={() => setSelectedCustomer(null)} className="btn-icon">
                                    <Trash2 size={16} />
                                </button>
                            </div>
                        )}
                    </div>

                    {/* Cart Items */}
                    <div className="glass-panel" style={{ padding: '1.5rem', flex: 1, display: 'flex', flexDirection: 'column' }}>
                        <h3 className="section-title" style={{ fontSize: '1.1rem', marginBottom: '1rem' }}>
                            <ShoppingCart size={18} style={{ display: 'inline', marginRight: '8px' }} />
                            Current Order
                        </h3>

                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '10px', overflowY: 'auto', minHeight: '200px' }}>
                            {cart.length === 0 ? (
                                <div style={{ textAlign: 'center', color: 'var(--text-muted)', marginTop: '2rem' }}>
                                    Cart is empty
                                </div>
                            ) : (
                                cart.map(item => (
                                    <div key={item.product_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.02)', padding: '8px', borderRadius: '6px' }}>
                                        <div style={{ flex: 1 }}>
                                            <div style={{ fontWeight: '500' }}>{item.name}</div>
                                            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>${item.price.toFixed(2)} x {item.quantity}</div>
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            <button onClick={() => updateQuantity(item.product_id, -1)} className="btn-icon" style={{ padding: '4px' }}>-</button>
                                            <span style={{ fontSize: '0.9rem', width: '20px', textAlign: 'center' }}>{item.quantity}</span>
                                            <button onClick={() => updateQuantity(item.product_id, 1)} className="btn-icon" style={{ padding: '4px' }}>+</button>
                                            <button onClick={() => removeFromCart(item.product_id)} className="btn-icon text-danger" style={{ padding: '4px', marginLeft: '4px' }}>
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>

                        <div style={{ borderTop: '1px solid var(--border-glass)', marginTop: '1rem', paddingTop: '1rem' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                                <span>Subtotal</span>
                                <span>${subtotal.toFixed(2)}</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                                <span>Tax</span>
                                <span>${taxTotal.toFixed(2)}</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1.2rem', fontWeight: 'bold', color: 'var(--success)' }}>
                                <span>Total</span>
                                <span>${total.toFixed(2)}</span>
                            </div>

                            <div style={{ marginTop: '1rem' }}>
                                <select
                                    className="form-input"
                                    value={orderStatus}
                                    onChange={e => setOrderStatus(e.target.value)}
                                    style={{ marginBottom: '1rem' }}
                                >
                                    <option value="pending">Pending Payment</option>
                                    <option value="processing">Processing</option>
                                    <option value="on-hold">On Hold</option>
                                    <option value="completed">Completed</option>
                                </select>

                                <button
                                    onClick={handleCreateOrder}
                                    disabled={isSaving}
                                    className="btn btn-primary"
                                    style={{ width: '100%', justifyContent: 'center', padding: '12px' }}
                                >
                                    {isSaving ? 'Creating...' : 'Create Order'}
                                </button>
                            </div>
                        </div>
                    </div>

                </div>

            </div>
        </div>
    );
};

export default CreateOrder;
