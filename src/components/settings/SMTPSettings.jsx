import React, { useState, useEffect } from 'react';
import { Mail } from 'lucide-react';
import { toast } from 'sonner';
import { fetchSMTP, saveSMTP } from '../../services/api';

const SMTPSettings = ({ settings }) => {
    const [formData, setFormData] = useState({
        enabled: 'no',
        host: '',
        port: '587',
        username: '',
        password: '',
        encryption: 'tls',
        from_email: '',
        from_name: ''
    });
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!settings.storeUrl) return;
        const load = async () => {
            setLoading(true);
            try {
                const data = await fetchSMTP(settings);
                setFormData(data);
            } catch (e) {
                console.error("Failed to load SMTP", e);
            } finally {
                setLoading(false);
            }
        };
        load();
    }, [settings]);

    const handleChange = (e) => setFormData({ ...formData, [e.target.name]: e.target.value });

    const handleSave = async (e) => {
        e.preventDefault();
        setSaving(true);
        try {
            await saveSMTP(settings, formData);
            toast.success("SMTP Settings Saved");
        } catch (e) {
            toast.error("Failed to save SMTP settings");
        } finally {
            setSaving(false);
        }
    };

    if (!settings.storeUrl) return (
        <div>
            <div className="settings-header">
                <div className="settings-icon-wrapper">
                    <Mail size={32} />
                </div>
                <div className="settings-title">
                    <h2>SMTP Configuration</h2>
                    <p>Configure how your store sends emails.</p>
                </div>
            </div>
            <div className="warning-box" style={{ padding: '2rem', textAlign: 'center', background: 'rgba(245, 158, 11, 0.1)', borderRadius: '8px', border: '1px solid rgba(245, 158, 11, 0.2)', color: '#f59e0b' }}>
                <p>Please configure your <strong>Store URL</strong> in the General tab before setting up SMTP.</p>
            </div>
        </div>
    );

    return (
        <div>
            <div className="settings-header">
                <div className="settings-icon-wrapper">
                    <Mail size={32} />
                </div>
                <div className="settings-title">
                    <h2>SMTP Configuration</h2>
                    <p>Configure how your store sends emails.</p>
                </div>
            </div>

            {loading ? <p>Loading...</p> : (
                <form onSubmit={handleSave} className="settings-form">
                    <div className="form-group">
                        <label className="form-label">Enable SMTP</label>
                        <select name="enabled" value={formData.enabled} onChange={handleChange} className="form-input">
                            <option value="no">No (Use default WP Mail)</option>
                            <option value="yes">Yes (Use SMTP)</option>
                        </select>
                    </div>

                    {formData.enabled === 'yes' && (
                        <>
                            <div className="form-group">
                                <label className="form-label">SMTP Host</label>
                                <input name="host" value={formData.host} onChange={handleChange} className="form-input" placeholder="smtp.gmail.com" />
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                                <div className="form-group">
                                    <label className="form-label">Port</label>
                                    <input name="port" value={formData.port} onChange={handleChange} className="form-input" placeholder="587" />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Encryption</label>
                                    <select name="encryption" value={formData.encryption} onChange={handleChange} className="form-input">
                                        <option value="tls">TLS</option>
                                        <option value="ssl">SSL</option>
                                        <option value="none">None</option>
                                    </select>
                                </div>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Username</label>
                                <input name="username" value={formData.username} onChange={handleChange} className="form-input" />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Password</label>
                                <input type="password" name="password" value={formData.password} onChange={handleChange} className="form-input" />
                            </div>
                            <div className="form-group">
                                <label className="form-label">From Email</label>
                                <input name="from_email" value={formData.from_email} onChange={handleChange} className="form-input" />
                            </div>
                            <div className="form-group">
                                <label className="form-label">From Name</label>
                                <input name="from_name" value={formData.from_name} onChange={handleChange} className="form-input" />
                            </div>
                        </>
                    )}

                    <div className="form-actions">
                        <button type="submit" disabled={saving} className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }}>
                            {saving ? 'Saving...' : 'Save SMTP Settings'}
                        </button>
                    </div>
                </form>
            )}
        </div>
    );
};

export default SMTPSettings;
