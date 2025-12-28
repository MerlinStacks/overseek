import React, { useState, useEffect } from 'react';
import { Ticket, Plus, Trash2, Calendar, Tag, Percent, DollarSign, RefreshCw, X } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { useSettings } from '../context/SettingsContext';
import { fetchCoupons, createCoupon, deleteCoupon } from '../services/api';
import { toast, Toaster } from 'sonner';
import './Coupons.css';

const Coupons = () => {
    const { settings } = useSettings();
    const coupons = useLiveQuery(() => db.coupons.toArray());
    const [isCreating, setIsCreating] = useState(false);
    const [isLoading, setIsLoading] = useState(false);

    // Form State
    const [newCoupon, setNewCoupon] = useState({
        code: '',
        amount: '',
        discount_type: 'percent', // percent or fixed_cart
        date_expires: ''
    });

    const loadCoupons = async () => {
        setIsLoading(true);
        try {
            const data = await fetchCoupons(settings);
            // Sync with local DB
            await db.coupons.clear();
            await db.coupons.bulkAdd(data);
            toast.success("Coupons synced");
        } catch (error) {
            console.error(error);
            toast.error("Failed to sync coupons");
        } finally {
            setIsLoading(false);
        }
    };

    // Initial Load
    useEffect(() => {
        if (settings.storeUrl && (!coupons || coupons.length === 0)) {
            loadCoupons();
        }
    }, [settings.storeUrl]);

    const handleCreate = async (e) => {
        e.preventDefault();
        if (!newCoupon.code || !newCoupon.amount) return;

        setIsLoading(true);
        try {
            const created = await createCoupon(settings, newCoupon);
            await db.coupons.add(created);
            toast.success(`Coupon ${created.code} created!`);
            setIsCreating(false);
            setNewCoupon({ code: '', amount: '', discount_type: 'percent', date_expires: '' });
        } catch (error) {
            console.error(error);
            toast.error("Failed to create coupon");
        } finally {
            setIsLoading(false);
        }
    };

    const handleDelete = async (id) => {
        if (!window.confirm("Delete this coupon?")) return;
        try {
            await deleteCoupon(settings, id);
            await db.coupons.delete(id);
            toast.success("Coupon deleted");
        } catch (error) {
            console.error(error);
            toast.error("Failed to delete coupon");
        }
    };

    return (
        <div className="coupons-page">
            <Toaster position="top-right" theme="dark" />

            <div className="coupons-header">
                <div className="header-content">
                    <div className="products-icon-wrapper" style={{ background: 'rgba(236, 72, 153, 0.1)', color: '#ec4899' }}>
                        <Ticket size={32} />
                    </div>
                    <div>
                        <h2>Coupons</h2>
                        <p style={{ color: 'var(--text-muted)' }}>Manage discounts and promo codes</p>
                    </div>
                </div>
                <div style={{ display: 'flex', gap: '1rem' }}>
                    <button onClick={loadCoupons} className="btn" disabled={isLoading}>
                        <RefreshCw size={18} className={isLoading ? 'spin' : ''} /> Sync
                    </button>
                    <button onClick={() => setIsCreating(true)} className="btn btn-primary">
                        <Plus size={18} /> Create Coupon
                    </button>
                </div>
            </div>

            {isCreating && (
                <div className="modal-overlay">
                    <div className="modal-content" style={{ maxWidth: '400px' }}>
                        <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '1.5rem' }}>
                            <div>
                                <h3 className="modal-title">New Coupon</h3>
                                <p className="modal-desc">Create a discount code.</p>
                            </div>
                            <button onClick={() => setIsCreating(false)} className="btn-icon">
                                <X size={20} />
                            </button>
                        </div>
                        <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                            <div className="form-group">
                                <label className="input-label">Coupon Code</label>
                                <input
                                    className="form-input"
                                    placeholder="SUMMER2025"
                                    required
                                    value={newCoupon.code}
                                    onChange={e => setNewCoupon({ ...newCoupon, code: e.target.value.toUpperCase() })}
                                />
                            </div>
                            <div className="form-group">
                                <label className="input-label">Discount Type</label>
                                <select
                                    className="form-input"
                                    value={newCoupon.discount_type}
                                    onChange={e => setNewCoupon({ ...newCoupon, discount_type: e.target.value })}
                                >
                                    <option value="percent">Percentage (%)</option>
                                    <option value="fixed_cart">Fixed Amount ($)</option>
                                </select>
                            </div>
                            <div className="form-group">
                                <label className="input-label">Amount</label>
                                <input
                                    className="form-input"
                                    type="number"
                                    required
                                    placeholder="10"
                                    value={newCoupon.amount}
                                    onChange={e => setNewCoupon({ ...newCoupon, amount: e.target.value })}
                                />
                            </div>
                            <div className="form-group">
                                <label className="input-label">Expiry Date (Optional)</label>
                                <input
                                    className="form-input"
                                    type="date"
                                    value={newCoupon.date_expires}
                                    onChange={e => setNewCoupon({ ...newCoupon, date_expires: e.target.value })}
                                />
                            </div>
                            <div className="modal-footer" style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid rgba(255,255,255,0.05)', display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
                                <button type="button" onClick={() => setIsCreating(false)} className="btn" style={{ background: 'transparent' }}>Cancel</button>
                                <button type="submit" className="btn btn-primary" disabled={isLoading}>Create Coupon</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1.5rem' }}>
                {coupons?.map(coupon => (
                    <div key={coupon.id} className="coupon-card">
                        <div className="coupon-header">
                            <span className="coupon-code">{coupon.code}</span>
                            <button onClick={() => handleDelete(coupon.id)} className="btn-icon" style={{ color: '#ef4444' }}>
                                <Trash2 size={16} />
                            </button>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px' }}>
                            <span className="coupon-amount">{coupon.amount}</span>
                            <span className="coupon-type">
                                {coupon.discount_type === 'percent' ? '%' : '$'} OFF
                            </span>
                        </div>

                        <div className="coupon-meta">
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <Tag size={14} />
                                <span>{coupon.discount_type.replace('_', ' ')}</span>
                            </div>
                            {coupon.date_expires && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    <Calendar size={14} />
                                    <span>Expires {new Date(coupon.date_expires).toLocaleDateString()}</span>
                                </div>
                            )}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default Coupons;
