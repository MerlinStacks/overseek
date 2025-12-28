import React, { useState, useEffect } from 'react';
import { Lock, Server } from 'lucide-react';
import { toast } from 'sonner';
import { fetchProducts } from '../../services/api';

const GeneralSettings = ({ settings, updateSettings }) => {
    const [formData, setFormData] = useState({
        storeUrl: '',
        consumerKey: '',
        consumerSecret: '',
        authMethod: 'auto',
        minProfitMargin: 0,
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

            // 0. DIAGNOSTIC: Check public access first
            toast.loading("Checking public access...", { id: 'conn-test' });
            try {
                await fetch(`${storeUrl}/wp-json/`, {
                    method: 'GET',
                    headers: { 'Content-Type': 'application/json' }
                });
            } catch (err) {
                toast.dismiss('conn-test');
                console.error("Diagnostic Check Failed", err);
                toast.error(
                    <div>
                        <strong>Site Unreachable / CORS Blocked</strong>
                        <p style={{ fontSize: '0.8rem', marginTop: '4px' }}>
                            Could not connect to <code>{storeUrl}</code>.
                            <br />- Check if URL is correct (https vs http).
                            <br />- Check if site is online.
                            <br />- <strong>Update Plugin:</strong> Ensure <code>woo-dashboard-helper.php</code> is updated on your site.
                        </p>
                    </div>
                    , { duration: 8000 });
                return;
            }

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
            <h2 className="section-title mb-6">Store Configuration</h2>
            <div className="form-group">
                <label className="form-label">Store URL</label>
                <div className="input-wrapper">
                    <input type="url" name="storeUrl" value={formData.storeUrl} onChange={handleChange} placeholder="https://your-store.com" className="form-input" required />
                </div>
            </div>
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
            <div className="form-group">
                <label className="form-label">Auth Method</label>
                <select name="authMethod" value={formData.authMethod} onChange={handleChange} className="form-input">
                    <option value="auto">Auto (Recommended)</option>
                    <option value="query_string">Query String</option>
                    <option value="basic">Basic Auth Header</option>
                </select>
            </div>

            <div className="form-group">
                <label className="form-label">Dashboard Time Zone</label>
                <select name="timeZone" value={formData.timeZone} onChange={handleChange} className="form-input">
                    {Intl.supportedValuesOf('timeZone').map(tz => (
                        <option key={tz} value={tz}>{tz.replace(/_/g, ' ')}</option>
                    ))}
                </select>
            </div>

            <h2 className="section-title mb-6" style={{ marginTop: '2rem' }}>Product Defaults</h2>
            <div className="form-group">
                <label className="form-label">Minimum Profit Margin (%)</label>
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
                <p className="help-text">Products with margin below this % will be highlighted in red.</p>
            </div>
            <div className="form-actions mt-8">
                <button type="button" onClick={handleTestConnection} disabled={loading || isSaving} className="btn" style={{ background: 'rgba(255,255,255,0.05)' }}>
                    {loading ? 'Testing...' : 'Test Connection'}
                </button>
                <button type="submit" disabled={isSaving} className="btn btn-primary">
                    {isSaving ? 'Saving...' : 'Save Configuration'}
                </button>
            </div>
        </form>
    );
};

export default GeneralSettings;
