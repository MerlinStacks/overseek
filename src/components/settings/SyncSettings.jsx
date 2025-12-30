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
    return (
        <form onSubmit={handleSave} className="fade-in">
            <div className="settings-content-header">
                <h2 className="settings-title">Data Synchronization</h2>
                <p className="settings-subtitle">Manage how often your dashboard pulls data from WooCommerce.</p>
            </div>

            <div className="settings-section">
                <div className="glass-card">
                    <h3 className="section-label">Auto-Sync</h3>
                    <div className="form-group mb-0">
                        <label className="form-label">Refresh Interval</label>
                        <select className="form-input" value={syncInterval} onChange={(e) => setSyncInterval(parseInt(e.target.value, 10))}>
                            <option value="0">Manual Only</option>
                            <option value="1">Every 1 Minute</option>
                            <option value="5">Every 5 Minutes</option>
                            <option value="15">Every 15 Minutes</option>
                            <option value="30">Every 30 Minutes</option>
                        </select>
                        <p className="help-text">Controls how frequently live carts and orders are checked.</p>
                    </div>
                </div>
            </div>

            <div className="settings-section">
                <div className="glass-card glass-card-success">
                    <h3 className="section-label text-success">Manual Sync</h3>
                    <p className="text-muted text-sm mb-4">Pull the latest data from your store immediately.</p>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: '8px', marginBottom: '1.5rem' }}>
                        {Object.entries(syncOptions).map(([key, value]) => (
                            <label key={key} className="flex items-center gap-2 cursor-pointer select-none text-sm">
                                <input
                                    type="checkbox"
                                    checked={value}
                                    onChange={e => setSyncOptions(prev => ({ ...prev, [key]: e.target.checked }))}
                                    style={{ accentColor: '#10b981' }}
                                />
                                {key.charAt(0).toUpperCase() + key.slice(1)}
                            </label>
                        ))}
                    </div>

                    <div className="flex gap-4">
                        <button
                            type="button"
                            onClick={() => startSync({ ...syncOptions, forceFull: false })}
                            disabled={isSyncing || !settings.storeUrl}
                            className="btn btn-primary bg-success border-none flex-1 justify-center"
                        >
                            {isSyncing ? 'Syncing...' : 'Quick Sync'}
                        </button>

                        <button
                            type="button"
                            onClick={() => startSync({ ...syncOptions, forceFull: true })}
                            disabled={isSyncing || !settings.storeUrl}
                            className="btn btn-secondary"
                            title="Full re-verification of all data"
                        >
                            Full Re-Sync
                        </button>
                    </div>

                    {syncStatus && <div className="mt-4 p-2 rounded bg-black/20 text-success text-sm font-mono">
                        {typeof syncStatus === 'string' ? syncStatus : (
                            <div className="flex justify-between">
                                <span>{syncStatus.entity}: {syncStatus.details || 'Processing...'}</span>
                                <span>{syncStatus.progress}%</span>
                            </div>
                        )}
                    </div>}
                </div>
            </div>

            <div className="settings-section">
                <div className="glass-card glass-card-danger">
                    <h3 className="section-label text-danger">Danger Zone</h3>
                    <p className="text-muted text-sm mb-4">
                        Switching stores? Clear all local data to prevent mixing products from different sites.
                    </p>
                    <button type="button" onClick={handleClearData} disabled={isClearing || isSyncing} className="btn btn-secondary border-danger text-danger hover:bg-danger-10 w-full justify-center">
                        {isClearing ? 'Processing...' : 'Reset / Clear All Data'}
                    </button>
                </div>
            </div>

            <div className="form-actions mt-4 flex justify-end">
                <button type="submit" disabled={isSaving} className="btn btn-primary min-w-[140px]">Save Settings</button>
            </div>
        </form>
    );
};

export default SyncSettings;
