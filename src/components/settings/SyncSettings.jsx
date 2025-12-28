import React, { useState } from 'react';
import { useSync } from '../../context/SyncContext';
import { db } from '../../db/db';
import { toast } from 'sonner';

const SyncSettings = ({ settings, updateSettings }) => {
    const { startSync, status: syncStatus } = useSync();
    const [isSaving, setIsSaving] = useState(false);
    const [isClearing, setIsClearing] = useState(false);

    // Local state for auto-refresh interval (persisted in DB)
    const [syncInterval, setSyncInterval] = useState(settings.syncInterval || 0);

    const [syncOptions, setSyncOptions] = useState(() => {
        try {
            const saved = localStorage.getItem('sync_prefs');
            return saved ? JSON.parse(saved) : { products: true, orders: true, customers: true, reviews: true, taxes: true };
        } catch (e) {
            return { products: true, orders: true, customers: true, reviews: true, taxes: true };
        }
    });

    React.useEffect(() => {
        localStorage.setItem('sync_prefs', JSON.stringify(syncOptions));
    }, [syncOptions]);

    const isSyncing = syncStatus === 'running';

    const handleSync = async () => {
        // Force full sync to ensure we catch new schema changes (like variations)
        startSync(true, syncOptions);
    };

    const handleClearData = async () => {
        if (!window.confirm("ARE YOU SURE? This will delete all products, orders, and customers from this dashboard. This action cannot be undone.")) return;

        setIsClearing(true);
        const toastId = toast.loading("Clearing database...");

        try {
            // Clear all data tables, keep settings and users
            await Promise.all([
                db.products.clear(),
                db.orders.clear(),
                db.customers.clear(),
                db.coupons.clear(),
                db.segments.clear(),
                db.automations.clear(),
                db.customer_notes.clear(),
                db.reports.clear(),
                db.product_components.clear(),
                db.suppliers.clear(),
                db.purchase_orders.clear(),
                db.visits.clear(), // Visitor log
                db.tax_rates.clear(),
                db.todos.clear()
            ]);

            // Clear sync checkpoints so next sync is full
            localStorage.removeItem('last_sync_products');
            localStorage.removeItem('last_sync_orders');
            localStorage.removeItem('last_sync_customers');

            toast.dismiss(toastId);
            toast.success("Database cleared successfully. Ready to sync new store.");
        } catch (error) {
            console.error(error);
            toast.dismiss(toastId);
            toast.error("Failed to clear database.");
        } finally {
            setIsClearing(false);
        }
    };

    const handleSave = async (e) => {
        e.preventDefault();
        setIsSaving(true);
        try {
            await updateSettings({ syncInterval });
            toast.success('Sync settings saved');
        } catch (error) {
            toast.error('Failed to save settings');
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <form onSubmit={handleSave} className="fade-in">
            <h2 className="section-title mb-6">Synchronization</h2>
            <div className="form-group">
                <label className="form-label">Auto-Refresh Interval (Live Carts)</label>
                <select className="form-input" value={syncInterval} onChange={(e) => setSyncInterval(parseInt(e.target.value, 10))}>
                    <option value="0">Manual Only</option>
                    <option value="1">Every 1 Minute</option>
                    <option value="5">Every 5 Minutes</option>
                    <option value="15">Every 15 Minutes</option>
                    <option value="30">Every 30 Minutes</option>
                </select>
            </div>

            <div style={{ background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.2)', padding: '1.5rem', borderRadius: '8px', marginTop: '2rem' }}>
                <h3 style={{ fontSize: '1rem', fontWeight: 600, color: '#34d399', marginBottom: '1rem' }}>Manual Sync</h3>
                <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '1.5rem' }}>Pull the latest data from your store immediately.</p>

                {/* Granular Sync Options */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: '10px', marginBottom: '1.5rem' }}>
                    {Object.entries(syncOptions).map(([key, value]) => (
                        <label key={key} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', color: 'var(--text-primary)', fontSize: '0.9rem' }}>
                            <input
                                type="checkbox"
                                checked={value}
                                onChange={e => setSyncOptions(prev => ({ ...prev, [key]: e.target.checked }))}
                                style={{ width: '16px', height: '16px', accentColor: '#10b981' }}
                            />
                            {key.charAt(0).toUpperCase() + key.slice(1)}
                        </label>
                    ))}
                </div>

                <button type="button" onClick={handleSync} disabled={isSyncing || !settings.storeUrl} className="btn btn-primary" style={{ background: '#10b981' }}>
                    {isSyncing ? 'Syncing...' : 'Sync Data Now'}
                </button>
                {syncStatus && <p style={{ color: '#10b981', marginTop: '10px', fontSize: '0.9rem' }}>{syncStatus}</p>}
            </div>

            <div style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)', padding: '1.5rem', borderRadius: '8px', marginTop: '2rem' }}>
                <h3 style={{ fontSize: '1rem', fontWeight: 600, color: '#ef4444', marginBottom: '1rem' }}>Danger Zone</h3>
                <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '1.5rem' }}>
                    Switching stores? Clear all local data to prevent mixing products from different sites.
                    This will remove all synced Orders, Products, and Customers from this device.
                </p>
                <button type="button" onClick={handleClearData} disabled={isClearing || isSyncing} className="btn" style={{ background: 'rgba(239, 68, 68, 0.2)', color: '#ef4444', borderColor: '#ef4444' }}>
                    {isClearing ? 'Processing...' : 'Reset / Clear All Data'}
                </button>
            </div>

            <div className="form-actions mt-8">
                <button type="submit" disabled={isSaving} className="btn btn-primary">Save Settings</button>
            </div>
        </form>
    );
};

export default SyncSettings;
