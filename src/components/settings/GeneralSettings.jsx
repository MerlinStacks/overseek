import React, { useState, useEffect } from 'react';
import { Lock, Server } from 'lucide-react';
import { toast } from 'sonner';
import { fetchProducts } from '../../services/api';

import { useSync } from '../../context/SyncContext';
import { useAccount } from '../../context/AccountContext';

const GeneralSettings = ({ settings, updateSettings }) => {
    const { startSync, status: syncStatus } = useSync();
    const { activeAccount } = useAccount();
    const [formData, setFormData] = useState({
        storeUrl: '',
        consumerKey: '',
        consumerSecret: '',
        authMethod: 'auto',
        minProfitMargin: 0,
        goldPrice: 0,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
    });
    const [loading, setLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        setFormData({
            storeUrl: settings.storeUrl || '',
            consumerKey: settings.consumerKey || '',
            consumerSecret: settings.consumerSecret || '',
            authMethod: settings.authMethod || 'auto',
            minProfitMargin: settings.minProfitMargin || 0,
            goldPrice: settings.goldPrice || 2600, // Default ~$2600 if not set
            timeZone: settings.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone
        });
    }, [settings]);

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleTestConnection = async (e) => {
        e.preventDefault();
        try {
            setLoading(true);
            let { storeUrl, consumerKey, consumerSecret, authMethod } = formData;

            if (!storeUrl || !consumerKey || !consumerSecret) {
                toast.error('Please fill in all fields');
                return;
            }

            // Clean URL first
            storeUrl = storeUrl.replace(/\/$/, '');

            toast.loading("Verifying credentials...", { id: 'conn-test' });

            // Attempt 1: Use selected or default auth
            try {
                await fetchProducts({ ...formData }, { per_page: 1 });
            } catch (err) {
                const isNetworkError = err.message === 'Network Error' || !err.response;
                if (isNetworkError && (authMethod === 'auto' || authMethod === 'basic')) {
                    toast.loading("Retrying with Query String authentication...", { duration: 2000 });

                    // Force query_string for this test
                    await fetchProducts({ ...formData, authMethod: 'query_string' }, { per_page: 1 });

                    toast.success('Connection successful (via Query String)!');
                    if (authMethod === 'auto') {
                        setFormData(prev => ({ ...prev, authMethod: 'query_string' }));
                        toast.info("Auth method updated to Query String for better compatibility.");
                    }
                    return;
                }
                throw err;
            }

            toast.dismiss('conn-test');
            toast.success('Connection successful!');
        } catch (error) {
            toast.dismiss('conn-test');
            console.error(error);
            const msg = error.response?.data?.message || error.message;

            if (msg === 'Network Error') {
                toast.error(
                    <div>
                        <strong>Connection Failed: Network Error</strong>
                        <p style={{ fontSize: '0.8rem', marginTop: '4px' }}>
                            This is usually caused by CORS blocking the request.
                            <br />1. Ensure your site supports HTTPS {'<->'} HTTPS.
                            <br />2. Try converting the Auth Method to "Query String".
                            <br />3. You may need a CORS plugin on your WordPress site.
                        </p>
                    </div>
                    , { duration: 8000 });
            } else {
                toast.error(`Connection failed: ${msg}`);
            }
        } finally {
            setLoading(false);
        }
    };

    const handleFullResync = () => {
        if (window.confirm("This will re-download ALL data (Products, Orders, Customers). This may take several minutes. Continue?")) {
            startSync({ forceFull: true }); // forceFull = true
            toast.info("Full resync started in background...");
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setIsSaving(true);
        try {
            if (!formData.storeUrl.startsWith('http')) {
                toast.error('Store URL must start with http:// or https://');
                setIsSaving(false);
                return;
            }

            await updateSettings(formData);
            toast.success('Settings saved successfully');
        } catch (error) {
            toast.error('Failed to save settings');
            console.error(error);
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="fade-in">
            <div className="settings-content-header">
                <h2 className="settings-title">Store Configuration</h2>
                <p className="settings-subtitle">Manage your WooCommerce connection and global shop defaults.</p>
            </div>

            <div className="settings-section">
                <div className="glass-card">
                    <h3 className="section-label"><Server size={18} /> Connection Details</h3>
                    <div className="form-group">
                        <label className="form-label">Store URL</label>
                        <div className="input-wrapper">
                            <input type="url" name="storeUrl" value={formData.storeUrl} onChange={handleChange} placeholder="https://your-store.com" className="form-input" required />
                        </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                        <div className="form-group">
                            <label className="form-label">Consumer Key</label>
                            <div className="input-wrapper">
                                <input type="text" name="consumerKey" value={formData.consumerKey} onChange={handleChange} className="form-input font-mono" required />
                                <Lock className="input-icon" size={16} />
                            </div>
                        </div>
                        <div className="form-group">
                            <label className="form-label">Consumer Secret</label>
                            <div className="input-wrapper">
                                <input type="password" name="consumerSecret" value={formData.consumerSecret} onChange={handleChange} className="form-input font-mono" required />
                                <Lock className="input-icon" size={16} />
                            </div>
                        </div>
                    </div>

                    <div className="form-group mb-0">
                        <label className="form-label">Auth Method</label>
                        <select name="authMethod" value={formData.authMethod} onChange={handleChange} className="form-input">
                            <option value="auto">Auto (Recommended)</option>
                            <option value="query_string">Query String</option>
                            <option value="basic">Basic Auth Header</option>
                        </select>
                    </div>
                </div>
            </div>

            <div className="settings-section">
                <div className="glass-card">
                    <h3 className="section-label">Default Preferences</h3>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                        <div className="form-group">
                            <label className="form-label">Dashboard Time Zone</label>
                            <select name="timeZone" value={formData.timeZone} onChange={handleChange} className="form-input">
                                {Intl.supportedValuesOf('timeZone').map(tz => (
                                    <option key={tz} value={tz}>{tz.replace(/_/g, ' ')}</option>
                                ))}
                            </select>
                        </div>
                        <div className="form-group">
                            <label className="form-label">Min Profit Margin (%)</label>
                            <div className="input-wrapper">
                                <input
                                    type="number"
                                    name="minProfitMargin"
                                    value={formData.minProfitMargin}
                                    onChange={handleChange}
                                    className="form-input"
                                    placeholder="e.g. 20"
                                />
                            </div>
                            <p className="help-text">Low margin warning threshold.</p>
                        </div>
                    </div>

                    {activeAccount?.features?.goldPrice && (
                        <div className="form-group mt-4 pt-4 border-t border-glass">
                            <label className="form-label text-warning">Live Gold Price ($/oz)</label>
                            <div className="input-wrapper">
                                <input
                                    type="number"
                                    name="goldPrice"
                                    value={formData.goldPrice}
                                    onChange={handleChange}
                                    className="form-input border-warning-20 box-shadow-none"
                                    placeholder="e.g. 2650.50"
                                    style={{ borderColor: 'rgba(245, 158, 11, 0.3)' }}
                                />
                            </div>
                        </div>
                    )}
                </div>
            </div>

            <div className="form-actions" style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '2rem' }}>
                <button type="button" onClick={handleTestConnection} disabled={loading || isSaving} className="btn btn-secondary">
                    {loading ? 'Testing...' : 'Test Connection'}
                </button>
                <button
                    type="button"
                    onClick={handleFullResync}
                    disabled={syncStatus === 'running'}
                    className="btn btn-secondary text-warning border-warning-20 bg-warning-10"
                >
                    {syncStatus === 'running' ? 'Syncing...' : 'Resync Data'}
                </button>
                <button type="submit" disabled={isSaving} className="btn btn-primary min-w-[140px]">
                    {isSaving ? 'Saving...' : 'Save Changes'}
                </button>
            </div>
        </form>
    );
};

export default GeneralSettings;
