import React, { useState, useMemo, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { useSettings } from '../context/SettingsContext';
import { useAccount } from '../context/AccountContext';
import { updateOrder, sendEmail } from '../services/api';
import { toast, Toaster } from 'sonner';
import { generateInvoicePDF } from '../utils/pdfGenerator';
import ShipmentTracking from '../components/ShipmentTracking';
import {
    ArrowLeft, MapPin, Mail, Phone, Calendar, CreditCard, RefreshCw,
    Save, Download, X, Send, Tag, GripVertical, Settings2, Check, Printer
} from 'lucide-react';
import { Reorder, motion, AnimatePresence } from 'framer-motion';
import { InvoiceRenderer } from '../components/InvoiceRenderer';
import './OrderDetails.css';

// --- Widget Components ---

const WidgetCard = ({ id, title, children, isCustomizing, onRemove }) => {
    return (
        <Reorder.Item
            value={id}
            id={id}
            dragListener={isCustomizing}
            className={`widget-card ${isCustomizing ? 'customizing' : ''}`}
        >
            <div className="widget-header">
                <div className="widget-title">
                    {isCustomizing && <GripVertical size={16} style={{ cursor: 'grab', opacity: 0.5 }} />}
                    {title}
                </div>
            </div>
            <div className="widget-content">
                {children}
            </div>
        </Reorder.Item>
    );
};

const ItemsWidget = ({ order }) => {
    const formatCurrency = (val) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val);
    return (
        <>
            <table className="items-table">
                <thead>
                    <tr>
                        <th>Product</th>
                        <th>Cost</th>
                        <th>Qty</th>
                        <th style={{ textAlign: 'right' }}>Total</th>
                    </tr>
                </thead>
                <tbody>
                    {order.line_items.map(item => (
                        <tr key={item.id}>
                            <td>
                                <div className="item-name">{item.name}</div>
                                <div className="item-meta">SKU: {item.sku || 'N/A'}</div>
                                {item.meta_data && item.meta_data.map((meta, idx) => (
                                    !meta.key.startsWith('_') && (
                                        <div key={idx} className="item-meta-row" style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '4px' }}>
                                            <strong style={{ fontWeight: 600 }}>{meta.display_key || meta.key}:</strong>
                                            <span style={{ marginLeft: '4px' }}>{meta.display_value || meta.value}</span>
                                        </div>
                                    )
                                ))}
                            </td>
                            <td>{formatCurrency(item.price)}</td>
                            <td>x{item.quantity}</td>
                            <td style={{ textAlign: 'right' }}>{formatCurrency(item.total)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>

            <div className="order-totals" style={{ maxWidth: '300px', marginLeft: 'auto' }}>
                <div className="totals-row">
                    <span>Subtotal</span>
                    <span>{formatCurrency(order.total - order.total_tax - order.shipping_total)}</span>
                </div>
                <div className="totals-row">
                    <span>Shipping</span>
                    <span>{formatCurrency(order.shipping_total)}</span>
                </div>
                {order.tax_lines && order.tax_lines.length > 0 ? (
                    order.tax_lines.map((tax, index) => (
                        <div key={index} className="totals-row">
                            <span>{tax.label || 'Tax'}</span>
                            <span>{formatCurrency(parseFloat(tax.tax_total) + parseFloat(tax.shipping_tax_total))}</span>
                        </div>
                    ))
                ) : (
                    parseFloat(order.total_tax) > 0 && (
                        <div className="totals-row">
                            <span>Tax</span>
                            <span>{formatCurrency(order.total_tax)}</span>
                        </div>
                    )
                )}
                <div className="totals-row grand-total">
                    <span>Total</span>
                    <span>{formatCurrency(order.total)}</span>
                </div>
            </div>
        </>
    );
};

const CustomerWidget = ({ order }) => (
    <div className="address-box">
        <p style={{ fontWeight: 600, color: 'var(--text-main)', fontSize: '1.1rem', marginBottom: '8px' }}>
            {order.billing.first_name} {order.billing.last_name}
        </p>
        <div className="contact-row">
            <Mail size={16} /> <a href={`mailto:${order.billing.email}`} style={{ color: 'inherit', textDecoration: 'none' }}>{order.billing.email}</a>
        </div>
        <div className="contact-row">
            <Phone size={16} /> {order.billing.phone}
        </div>
    </div>
);

const AddressWidget = ({ title, address }) => (
    <div className="address-box">
        <p>{address.address_1}</p>
        {address.address_2 && <p>{address.address_2}</p>}
        <p>{address.city}, {address.state} {address.postcode}</p>
        <p>{address.country}</p>
    </div>
);

const PaymentWidget = ({ order }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-muted)' }}>
        <CreditCard size={18} />
        <span>via {order.payment_method_title}</span>
    </div>
);

const TagsWidget = ({ order, onAddTag, onRemoveTag }) => {
    const [tagInput, setTagInput] = useState('');
    return (
        <div className="tags-manager">
            <div className="input-wrapper" style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
                <input
                    className="glass-input"
                    placeholder="Add tag..."
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                            if (tagInput.trim()) {
                                onAddTag(tagInput.trim());
                                setTagInput('');
                            }
                        }
                    }}
                    style={{ flex: 1 }}
                />
                <button className="btn-icon" onClick={() => {
                    if (tagInput.trim()) {
                        onAddTag(tagInput.trim());
                        setTagInput('');
                    }
                }}>
                    <Tag size={16} />
                </button>
            </div>
            <div className="tags-list">
                {(order.local_tags || []).map(tag => (
                    <span key={tag} className="tag-badge">
                        {tag}
                        <button onClick={() => onRemoveTag(tag)} className="tag-remove-btn">
                            <X size={12} />
                        </button>
                    </span>
                ))}
                {(!order.local_tags || order.local_tags.length === 0) && (
                    <span className="text-small-muted" style={{ fontSize: '0.8rem', opacity: 0.7 }}>No tags yet.</span>
                )}
            </div>
        </div>
    );
};

const MetadataWidget = ({ order }) => (
    <div className="metadata-list">
        {order.meta_data && order.meta_data.filter(m => !m.key.startsWith('_') && m.value).length > 0 ? (
            order.meta_data
                .filter(m => !m.key.startsWith('_') && m.value)
                .map((meta, idx) => (
                    <div key={idx} className="meta-item" style={{ marginBottom: '8px', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '8px' }}>
                        <div className="meta-key" style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>
                            {meta.key.replace(/_/g, ' ')}
                        </div>
                        <div className="meta-value" style={{ fontSize: '0.9rem', color: 'var(--text-main)', wordBreak: 'break-word' }}>
                            {typeof meta.value === 'string' ? meta.value : JSON.stringify(meta.value)}
                        </div>
                    </div>
                ))
        ) : (
            <div className="text-small-muted">No additional metadata.</div>
        )}
    </div>
);

// --- Main Page Component ---

const OrderDetails = () => {
    const { id } = useParams();
    const navigate = useNavigate();
    const { settings } = useSettings();
    const { activeAccount } = useAccount();
    const orderId = parseInt(id);

    const order = useLiveQuery(() =>
        activeAccount ? db.orders.get([activeAccount.id, orderId]) : null
        , [activeAccount, orderId]);

    const [updating, setUpdating] = useState(false);
    const [newStatus, setNewStatus] = useState('');
    const [isCustomizing, setIsCustomizing] = useState(false);

    // Email State
    const [emailModalOpen, setEmailModalOpen] = useState(false);
    const [emailSubject, setEmailSubject] = useState('');
    const [emailMessage, setEmailMessage] = useState('');
    const [sendingEmail, setSendingEmail] = useState(false);

    // Layout State
    const defaultLayout = {
        main: ['items'],
        side: ['tracking', 'customer', 'billing', 'shipping', 'payment', 'tags', 'metadata']
    };

    const [layout, setLayout] = useState(() => {
        try {
            const saved = localStorage.getItem('orderDetailsLayout');
            return saved ? JSON.parse(saved) : defaultLayout;
        } catch {
            return defaultLayout;
        }
    });

    const invoiceLayout = useMemo(() => {
        if (!settings?.invoiceLayout) return [];
        try {
            return typeof settings.invoiceLayout === 'string' ? JSON.parse(settings.invoiceLayout) : settings.invoiceLayout;
        } catch (e) {
            console.error("Failed to parse invoice layout", e);
            return [];
        }
    }, [settings]);

    useEffect(() => {
        if (order) setNewStatus(order.status);
    }, [order]);

    // Save layout when custom mode ends
    const toggleCustomizing = () => {
        if (isCustomizing) {
            localStorage.setItem('orderDetailsLayout', JSON.stringify(layout));
            toast.success("Layout saved!");
        }
        setIsCustomizing(!isCustomizing);
    };

    const handleAddTag = async (tag) => {
        const currentTags = order.local_tags || [];
        if (!currentTags.includes(tag)) {
            await db.orders.update([activeAccount.id, orderId], { local_tags: [...currentTags, tag] });
            toast.success(`Tag "${tag}" added`);
        }
    };

    const handleRemoveTag = async (tagToRemove) => {
        const currentTags = order.local_tags || [];
        const newTags = currentTags.filter(t => t !== tagToRemove);
        await db.orders.update([activeAccount.id, orderId], { local_tags: newTags });
        toast.success(`Tag "${tagToRemove}" removed`);
    };

    const handleStatusUpdate = async () => {
        if (!newStatus || newStatus === order.status) return;
        setUpdating(true);
        try {
            const updatedOrder = await updateOrder(settings, orderId, { status: newStatus });
            // API returns generic order obj, need to ensure composite key integrity if needed, 
            // but db.put uses the object's keys. Make sure to preserve account_id.
            updatedOrder.account_id = activeAccount.id;
            updatedOrder.local_tags = order.local_tags; // preserve tags if unseen

            await db.orders.put(updatedOrder);
            toast.success(`Order status updated to ${newStatus}`);
        } catch (error) {
            console.error(error);
            toast.error('Failed to update status. Check your connection/keys.');
        } finally {
            setUpdating(false);
        }
    };

    // Tracking Logic
    const shipmentTrackingItems = useMemo(() => {
        if (!order || !order.meta_data) return [];
        const meta = order.meta_data.find(m => m.key === '_wc_shipment_tracking_items');
        if (!meta) return [];
        return Array.isArray(meta.value) ? meta.value : [];
    }, [order]);

    const handleEmailTracking = (item) => {
        const link = item.tracking_link || `(No Link)`;
        const msg = `Hi ${order.billing.first_name},\n\nGood news! Your order #${order.id} has been shipped.\n\nTracking Provider: ${item.tracking_provider}\nTracking Number: ${item.tracking_number}\nTrack here: ${link}\n\nThank you for shopping with us!`;
        setEmailSubject(`Shipment Update: Order #${order.id}`);
        setEmailMessage(msg);
        setEmailModalOpen(true);
    };

    const handleSendEmail = async () => {
        if (!order.billing.email) return toast.error("No customer email found");
        setSendingEmail(true);
        try {
            const brandColor = settings.brandColor || '#6366f1';
            const styledHtml = `
                <div style="font-family: sans-serif; color: #1e293b; max-width: 600px; margin: 0 auto;">
                    <div style="background-color: ${brandColor}; padding: 24px; color: white; border-radius: 12px 12px 0 0;">
                        <h2 style="margin:0; font-size: 20px;">${emailSubject}</h2>
                    </div>
                    <div style="padding: 24px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 12px 12px; background-color: #ffffff;">
                        <div style="font-size: 16px; line-height: 1.6;">
                            ${emailMessage.replace(/\n/g, '<br>')}
                        </div>
                        <div style="margin-top: 30px; pt-4; border-top: 1px solid #f1f5f9; font-size: 12px; color: #94a3b8; text-align: center;">
                            Sent via WooDash
                        </div>
                    </div>
                </div>
            `;

            await sendEmail(settings, {
                to: order.billing.email,
                subject: emailSubject,
                message: styledHtml
            });
            toast.success("Email sent!");
            setEmailModalOpen(false);
        } catch (e) {
            console.error(e);
            toast.error("Failed to send email");
        } finally {
            setSendingEmail(false);
        }
    };

    if (!order) return <div className="p-8 text-white">Loading order...</div>;

    // --- Widget Mapping ---
    const WIDGET_REGISTRY = {
        'items': { title: 'Items', component: <ItemsWidget order={order} /> },
        'tracking': {
            title: 'Shipment Tracking',
            component: <ShipmentTracking
                trackingItems={shipmentTrackingItems}
                orderId={orderId}
                settings={settings}
                onEmailTracking={handleEmailTracking}
            />
        },
        'customer': { title: 'Customer', component: <CustomerWidget order={order} /> },
        'billing': { title: 'Billing Address', component: <AddressWidget address={order.billing} /> },
        'shipping': { title: 'Shipping Address', component: <AddressWidget address={order.shipping} /> },
        'payment': { title: 'Payment', component: <PaymentWidget order={order} /> },
        'tags': { title: 'Tags', component: <TagsWidget order={order} onAddTag={handleAddTag} onRemoveTag={handleRemoveTag} /> },
        'metadata': { title: 'Order Metadata', component: <MetadataWidget order={order} /> }
    };

    const renderColumn = (columnId, itemIds) => (
        <Reorder.Group
            axis="y"
            values={itemIds}
            onReorder={(newOrder) => setLayout(prev => ({ ...prev, [columnId]: newOrder }))}
            className="widget-column"
        >
            {itemIds.map(id => {
                const widget = WIDGET_REGISTRY[id];
                if (!widget) return null; // Safety check
                return (
                    <WidgetCard
                        key={id}
                        id={id}
                        title={widget.title}
                        isCustomizing={isCustomizing}
                    >
                        {widget.component}
                    </WidgetCard>
                );
            })}
        </Reorder.Group>
    );

    return (
        <div className={`order-details-page ${isCustomizing ? 'customizing-mode' : ''}`}>
            <Toaster position="top-right" theme="dark" />

            {/* Header */}
            <div className="order-header-refined">
                {/* Top Nav Row */}
                <div className="header-nav-row">
                    <button onClick={() => navigate('/orders')} className="nav-back-btn">
                        <ArrowLeft size={18} />
                        <span>Orders</span>
                    </button>

                    <div className="header-controls">
                        <div className="meta-date">
                            <Calendar size={14} />
                            <span>{new Date(order.date_created).toLocaleDateString()} {new Date(order.date_created).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                        <div className="divider-v"></div>
                        <button
                            onClick={toggleCustomizing}
                            className={`header-btn ${isCustomizing ? 'active' : ''}`}
                        >
                            {isCustomizing ? <Check size={16} /> : <Settings2 size={16} />}
                            <span>{isCustomizing ? 'Done' : 'Customize'}</span>
                        </button>
                        <button onClick={() => window.print()} className="header-btn" title="Print Invoice">
                            <Printer size={16} />
                        </button>
                        <button onClick={() => generateInvoicePDF(order, settings)} className="header-btn" title="Download PDF">
                            <Download size={16} />
                        </button>
                    </div>
                </div>

                {/* Main Title Row */}
                <div className="header-title-row">
                    <div className="title-wrapper">
                        <h1 className="order-id-text">Order #{order.id}</h1>

                        <div className={`status-badge-interactive ${order.status}`}>
                            <span className="status-dot"></span>
                            <select
                                value={newStatus}
                                onChange={(e) => setNewStatus(e.target.value)}
                                className="status-dropdown-hidden"
                            >
                                <option value="pending">Pending</option>
                                <option value="processing">Processing</option>
                                <option value="on-hold">On Hold</option>
                                <option value="completed">Completed</option>
                                <option value="cancelled">Cancelled</option>
                                <option value="refunded">Refunded</option>
                                <option value="failed">Failed</option>
                            </select>
                            <span className="status-label">{newStatus}</span>
                        </div>

                        {newStatus !== order.status && (
                            <motion.button
                                initial={{ opacity: 0, x: -10 }}
                                animate={{ opacity: 1, x: 0 }}
                                onClick={handleStatusUpdate}
                                disabled={updating}
                                className="status-save-btn"
                            >
                                {updating ? <RefreshCw className="spin" size={14} /> : <Save size={14} />}
                                Save
                            </motion.button>
                        )}
                    </div>
                </div>
            </div>

            {/* Layout Grid */}
            <div className="order-widgets-grid">
                {renderColumn('main', layout.main)}
                {renderColumn('side', layout.side)}
            </div>

            {/* Email Modal */}
            {emailModalOpen && (
                <div className="modal-overlay">
                    <div className="modal-content glass-panel" style={{ width: '500px' }}>
                        <div className="modal-header">
                            <h3>Send Email</h3>
                            <button className="btn-icon" onClick={() => setEmailModalOpen(false)}><X size={20} /></button>
                        </div>
                        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                            <div>
                                <label className="form-label">To</label>
                                <input className="glass-input" style={{ width: '100%' }} value={order.billing.email} disabled />
                            </div>
                            <div>
                                <label className="form-label">Subject</label>
                                <input
                                    className="glass-input"
                                    style={{ width: '100%' }}
                                    value={emailSubject}
                                    onChange={(e) => setEmailSubject(e.target.value)}
                                />
                            </div>
                            <div>
                                <label className="form-label">Message</label>
                                <textarea
                                    className="glass-input"
                                    style={{ width: '100%' }}
                                    rows="10"
                                    value={emailMessage}
                                    onChange={(e) => setEmailMessage(e.target.value)}
                                />
                            </div>
                            <div className="modal-actions" style={{ justifyContent: 'flex-end', display: 'flex', gap: '10px' }}>
                                <button className="btn" onClick={() => setEmailModalOpen(false)}>Cancel</button>
                                <button className="btn btn-primary" onClick={handleSendEmail} disabled={sendingEmail}>
                                    {sendingEmail ? 'Sending...' : 'Send Email'} <Send size={14} style={{ marginLeft: '6px' }} />
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Hidden Print Area */}
            <div className="invoice-print-area">
                <InvoiceRenderer
                    layout={invoiceLayout}
                    data={order}
                    footerText={settings?.footerText || "Thank you for your business!"}
                />
            </div>
        </div>
    );
};

export default OrderDetails;
