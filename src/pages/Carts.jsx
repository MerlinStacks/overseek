import React, { useState, useEffect } from 'react';
import { ShoppingCart, RefreshCw, User, Mail, DollarSign, Send, X } from 'lucide-react';
import { useSettings } from '../context/SettingsContext';
import { fetchCarts, sendEmail } from '../services/api';
import { toast, Toaster } from 'sonner';
import './Carts.css';

const Carts = () => {
    const { settings } = useSettings();
    const [carts, setCarts] = useState([]);
    const [loading, setLoading] = useState(false);

    // Email Modal State
    const [emailModalOpen, setEmailModalOpen] = useState(false);
    const [selectedCart, setSelectedCart] = useState(null);
    const [emailSubject, setEmailSubject] = useState('Did you forget something?');
    const [emailMessage, setEmailMessage] = useState('');
    const [sending, setSending] = useState(false);


    const loadCarts = async () => {
        setLoading(true);
        try {
            const data = await fetchCarts(settings);
            if (Array.isArray(data)) {
                setCarts(data);
            } else {
                setCarts([]); // Should be array
            }
        } catch (error) {
            console.error(error);
            toast.error("Failed to load carts. Make sure Helper Plugin is active.");
            setCarts([]);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        // Initial load skipped if no settings, but we try anyway
        if (settings.storeUrl) {
            loadCarts();
        }

        // Auto Refresh
        let intervalId;
        if (settings.syncInterval > 0) {
            console.log(`Setting up auto-refresh every ${settings.syncInterval} minutes`);
            const ms = settings.syncInterval * 60 * 1000;
            intervalId = setInterval(loadCarts, ms);
        }

        return () => {
            if (intervalId) clearInterval(intervalId);
        };
    }, [settings.syncInterval, settings.storeUrl]); // Re-run if interval changes

    const formatCurrency = (val, currency) => {
        return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD' }).format(val);
    };

    const handleOpenEmail = (cart) => {
        setSelectedCart(cart);
        // Pre-fill
        const name = cart.customer.first_name || 'there';
        setEmailMessage(`Hi ${name},\n\nWe noticed you left some items in your cart. Come back and complete your purchase before they sell out!\n\nBest,\nThe Team`);
        setEmailModalOpen(true);
    };

    const handleSendEmail = async () => {
        if (!selectedCart || !selectedCart.customer.email) {
            toast.error("No email address for this customer");
            return;
        }

        setSending(true);
        try {
            await sendEmail(settings, {
                to: selectedCart.customer.email,
                subject: emailSubject,
                message: emailMessage.replace(/\n/g, '<br>') // Basic formatting
            });
            toast.success("Email sent successfully!");
            setEmailModalOpen(false);
        } catch (error) {
            console.error(error);
            toast.error("Failed to send email. Ensure SMTP is configured in Settings.");
        } finally {
            setSending(false);
        }
    };

    return (
        <div className="carts-page">
            <Toaster position="top-right" theme="dark" />
            <div className="carts-header">
                <div className="header-content">
                    <div className="carts-icon-wrapper">
                        <ShoppingCart size={32} />
                    </div>
                    <div className="carts-title">
                        <h2>Live Carts</h2>
                        <p>Real-time view of active and abandoned carts.</p>
                    </div>
                </div>

                <div className="carts-controls">
                    <div className="carts-control-text">
                        Ensure <code>WooDashHelper</code> plugin is active.
                    </div>
                    <button onClick={loadCarts} className="btn btn-primary" disabled={loading}>
                        <RefreshCw size={18} className={loading ? 'spin' : ''} style={{ marginRight: '6px' }} />
                        Refresh
                    </button>
                </div>
            </div>

            <div className="glass-panel carts-table-container">
                <table className="carts-table">
                    <thead>
                        <tr>
                            <th>Customer</th>
                            <th>Items</th>
                            <th>Total</th>
                            <th>Last Update</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {carts.length > 0 ? (
                            carts.map((cart, index) => (
                                <tr key={cart.session_key || index}>
                                    <td data-label="Customer">
                                        <div className="avatar-cell">
                                            <div className="customer-avatar" style={{ background: 'rgba(255,255,255,0.1)' }}>
                                                {cart.customer.first_name ? cart.customer.first_name[0] : 'G'}
                                            </div>
                                            <div className="customer-info">
                                                <span className="customer-name">
                                                    {cart.customer.first_name !== 'Guest' && cart.customer.first_name
                                                        ? `${cart.customer.first_name} ${cart.customer.last_name || ''}`
                                                        : 'Guest'
                                                    }
                                                </span>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                                                    <Mail size={12} /> {cart.customer.email || 'No email'}
                                                </div>
                                            </div>
                                        </div>
                                    </td>
                                    <td data-label="Items">
                                        <span className="mobile-label">Items:</span>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                            {cart.items.slice(0, 3).map((item, i) => (
                                                <div key={i} style={{ fontSize: '0.85rem' }}>
                                                    {item.qty}x {item.name}
                                                </div>
                                            ))}
                                            {cart.items.length > 3 && (
                                                <span className="text-muted" style={{ fontSize: '0.8rem' }}>+{cart.items.length - 3} more</span>
                                            )}
                                        </div>
                                    </td>
                                    <td data-label="Total">
                                        <span className="mobile-label">Total:</span>
                                        <span style={{ fontWeight: 'bold', color: 'var(--success)' }}>
                                            {formatCurrency(cart.total, cart.currency)}
                                        </span>
                                    </td>
                                    <td data-label="Last Update">
                                        <span className="mobile-label">Updated:</span>
                                        <div>
                                            {new Date(cart.last_update).toLocaleDateString()} <br />
                                            <span className="text-muted" style={{ fontSize: '0.8rem' }}>
                                                {new Date(cart.last_update).toLocaleTimeString()}
                                            </span>
                                        </div>
                                    </td>
                                    <td data-label="Actions">
                                        {cart.customer.email ? (
                                            <button
                                                className="btn"
                                                style={{ padding: '6px 12px', fontSize: '0.8rem', background: 'rgba(236, 72, 153, 0.1)', color: '#ec4899', border: '1px solid rgba(236, 72, 153, 0.2)' }}
                                                onClick={() => handleOpenEmail(cart)}
                                            >
                                                <Send size={14} style={{ marginRight: '4px' }} /> Recover
                                            </button>
                                        ) : (
                                            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>No email</span>
                                        )}
                                    </td>
                                </tr>
                            ))
                        ) : (
                            <tr>
                                <td colSpan="5" style={{ textAlign: 'center', padding: '3rem' }}>
                                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem', color: 'var(--text-muted)' }}>
                                        <ShoppingCart size={48} style={{ opacity: 0.5 }} />
                                        <p>No active carts found (or plugin not connected).</p>
                                    </div>
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            {/* Email Modal */}
            {emailModalOpen && (
                <div className="modal-overlay">
                    <div className="modal-content glass-panel" style={{ width: '500px' }}>
                        <div className="modal-header">
                            <h3>Recover Cart</h3>
                            <button className="btn-icon" onClick={() => setEmailModalOpen(false)}><X size={20} /></button>
                        </div>
                        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                            <div>
                                <label className="form-label">To</label>
                                <input className="form-input" value={selectedCart?.customer.email} disabled />
                            </div>
                            <div>
                                <label className="form-label">Subject</label>
                                <input
                                    className="form-input"
                                    value={emailSubject}
                                    onChange={(e) => setEmailSubject(e.target.value)}
                                />
                            </div>
                            <div>
                                <label className="form-label">Message</label>
                                <textarea
                                    className="form-input"
                                    rows="6"
                                    value={emailMessage}
                                    onChange={(e) => setEmailMessage(e.target.value)}
                                />
                            </div>
                            <div className="modal-actions" style={{ justifyContent: 'flex-end', display: 'flex', gap: '10px' }}>
                                <button className="btn" onClick={() => setEmailModalOpen(false)}>Cancel</button>
                                <button className="btn btn-primary" onClick={handleSendEmail} disabled={sending}>
                                    {sending ? 'Sending...' : 'Send Recovery Email'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Carts;
