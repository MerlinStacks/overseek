
import React, { useState } from 'react';
import { Truck, Plus, Trash2, ExternalLink, Mail } from 'lucide-react';
import { db } from '../db/db';
import { updateOrder } from '../services/api';
import { toast } from 'sonner';

const ShipmentTracking = ({ orderId, trackingItems = [], settings, onEmailTracking }) => {
    const [isAdding, setIsAdding] = useState(false);
    const [newTracking, setNewTracking] = useState({
        provider: '',
        number: '',
        date_shipped: new Date().toISOString().split('T')[0]
    });

    const providers = [
        { label: 'Custom', value: '' },
        { label: 'USPS', url: 'https://tools.usps.com/go/TrackConfirmAction_input?qtc_tLabels1=%NUMBER%' },
        { label: 'UPS', url: 'https://www.ups.com/track?tracknum=%NUMBER%' },
        { label: 'FedEx', url: 'https://www.fedex.com/fedextrack/?trknbr=%NUMBER%' },
        { label: 'DHL', url: 'https://www.dhl.com/en/express/tracking.html?AWB=%NUMBER%' },
        { label: 'Australia Post', url: 'https://auspost.com.au/mypost/track/#/details/%NUMBER%' },
        { label: 'Canada Post', url: 'https://www.canadapost.ca/trackweb/en#/search?searchFor=%NUMBER%' },
        { label: 'Royal Mail', url: 'https://www.royalmail.com/track-your-item#/tracking-results/%NUMBER%' },
    ];

    const getTrackingLink = (providerName, number) => {
        const provider = providers.find(p => p.label === providerName);
        if (provider && provider.url) {
            return provider.url.replace('%NUMBER%', number);
        }
        return null;
    };

    const handleAddTracking = async () => {
        if (!newTracking.number) return toast.error("Tracking number is required");

        const newItem = {
            tracking_provider: newTracking.provider || 'Custom',
            tracking_number: newTracking.number,
            date_shipped: newTracking.date_shipped,
            tracking_link: getTrackingLink(newTracking.provider, newTracking.number)
        };

        const updatedTracking = [...trackingItems, newItem];

        try {
            // Update local DB
            await db.orders.update(orderId, {
                meta_data: [
                    ...((await db.orders.get(orderId)).meta_data || []).filter(m => m.key !== '_wc_shipment_tracking_items'),
                    { key: '_wc_shipment_tracking_items', value: updatedTracking }
                ]
            });

            // Ideally update remote as well (assuming custom endpoint or meta data update support)
            // await updateOrder(settings, orderId, { meta_data: ... }); 
            // Simplified for now: just local persistence + toast

            toast.success("Tracking added!");
            setIsAdding(false);
            setNewTracking({ provider: '', number: '', date_shipped: new Date().toISOString().split('T')[0] });
        } catch (e) {
            console.error(e);
            toast.error("Failed to save tracking info");
        }
    };

    const handleDelete = async (index) => {
        if (!window.confirm("Remove this tracking number?")) return;

        const updatedTracking = trackingItems.filter((_, i) => i !== index);
        try {
            await db.orders.update(orderId, {
                meta_data: [
                    ...((await db.orders.get(orderId)).meta_data || []).filter(m => m.key !== '_wc_shipment_tracking_items'),
                    { key: '_wc_shipment_tracking_items', value: updatedTracking }
                ]
            });
            toast.success("Tracking removed");
        } catch (e) {
            console.error(e);
            toast.error("Failed to remove tracking");
        }
    }

    return (
        <div className="section-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h3 className="section-title" style={{ margin: 0 }}>Shipment Tracking</h3>
                {!isAdding && (
                    <button onClick={() => setIsAdding(true)} className="btn-icon-sm" title="Add Tracking">
                        <Plus size={16} />
                    </button>
                )}
            </div>

            <div className="tracking-list" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {trackingItems.length === 0 && !isAdding && (
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', fontStyle: 'italic' }}>No tracking info available.</p>
                )}

                {trackingItems.map((item, idx) => {
                    const link = item.tracking_link || getTrackingLink(item.tracking_provider, item.tracking_number);
                    return (
                        <div key={idx} style={{
                            background: 'rgba(255,255,255,0.03)',
                            padding: '10px',
                            borderRadius: '8px',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center'
                        }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <Truck size={14} className="text-muted" />
                                    <span style={{ fontWeight: 500 }}>{item.tracking_provider}</span>
                                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{item.date_shipped}</span>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    <code style={{ background: 'rgba(0,0,0,0.2)', padding: '2px 6px', borderRadius: '4px', fontSize: '0.85rem' }}>
                                        {item.tracking_number}
                                    </code>
                                    {link && (
                                        <a href={link} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--primary)', display: 'flex', alignItems: 'center' }}>
                                            <ExternalLink size={12} />
                                        </a>
                                    )}
                                </div>
                            </div>
                            <div style={{ display: 'flex', gap: '4px' }}>
                                {onEmailTracking && (
                                    <button
                                        onClick={() => onEmailTracking(item)}
                                        className="btn-icon"
                                        title="Email to Customer"
                                        style={{ padding: '4px', opacity: 0.7 }}
                                    >
                                        <Mail size={14} />
                                    </button>
                                )}
                                <button onClick={() => handleDelete(idx)} className="btn-icon text-error" style={{ padding: '4px' }}>
                                    <Trash2 size={14} />
                                </button>
                            </div>
                        </div>
                    );
                })}

                {isAdding && (
                    <div className="add-tracking-form animate-fade-in" style={{ background: 'rgba(255,255,255,0.05)', padding: '12px', borderRadius: '8px', border: '1px solid var(--border-glass)' }}>
                        <div style={{ display: 'grid', gap: '8px' }}>
                            <select
                                className="form-input"
                                value={newTracking.provider}
                                onChange={e => setNewTracking({ ...newTracking, provider: e.target.value })}
                            >
                                <option value="" disabled>Select Provider</option>
                                {providers.map(p => <option key={p.label} value={p.label}>{p.label}</option>)}
                            </select>
                            <input
                                className="form-input"
                                placeholder="Tracking Number"
                                value={newTracking.number}
                                onChange={e => setNewTracking({ ...newTracking, number: e.target.value })}
                            />
                            <input
                                type="date"
                                className="form-input"
                                value={newTracking.date_shipped}
                                onChange={e => setNewTracking({ ...newTracking, date_shipped: e.target.value })}
                            />
                            <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                                <button onClick={handleAddTracking} className="btn btn-primary" style={{ flex: 1 }}>Save</button>
                                <button onClick={() => setIsAdding(false)} className="btn" style={{ flex: 1 }}>Cancel</button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default ShipmentTracking;
