
import React, { useState, useEffect } from 'react';
import { db } from '../../db/db';
import { useAccount } from '../../context/AccountContext';
import { toast } from 'sonner';
import { Save, RefreshCw, CheckCircle, AlertCircle } from 'lucide-react';

const MarketingSettings = () => {
    const { activeAccount } = useAccount();
    const [metaApi, setMetaApi] = useState({ token: '', pixelId: '', adAccountId: '', enabled: false });
    const [googleApi, setGoogleApi] = useState({ token: '', customerId: '', enabled: false });
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const loadSettings = async () => {
            if (!activeAccount) return;

            const meta = await db.ad_integrations.get([activeAccount.id, 'meta']);
            const google = await db.ad_integrations.get([activeAccount.id, 'google']);

            if (meta) setMetaApi(meta);
            if (google) setGoogleApi(google);
            setLoading(false);
        };
        loadSettings();
    }, [activeAccount]);

    const handleSave = async (platform, data) => {
        if (!activeAccount) return;
        try {
            await db.ad_integrations.put({
                ...data,
                account_id: activeAccount.id,
                platform
            });
            toast.success(`${platform === 'meta' ? 'Meta' : 'Google'} settings saved`);
        } catch (e) {
            console.error(e);
            toast.error('Failed to save settings');
        }
    };

    if (loading) return <div className="p-8">Loading integrations...</div>;

    return (
        <div className="animate-fade-in">
            <h2 className="settings-section-title">Marketing Integrations</h2>
            <p className="section-desc">Connect your ad platforms to enable AI-driven revenue tracking and optimization suggestions.</p>

            <div className="settings-grid">

                {/* Meta Ads Card */}
                <div className="glass-panel" style={{ padding: '1.5rem', borderLeft: '4px solid #1877f2' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
                        <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <img src="https://upload.wikimedia.org/wikipedia/commons/5/51/Facebook_f_logo_%282019%29.svg" width="20" alt="FB" />
                            Meta Ads (Facebook/Instagram)
                        </h3>
                        <label className="switch">
                            <input
                                type="checkbox"
                                checked={metaApi.enabled}
                                onChange={(e) => setMetaApi({ ...metaApi, enabled: e.target.checked })}
                            />
                            <span className="slider round"></span>
                        </label>
                    </div>

                    <div className="form-group">
                        <label>Ad Account ID</label>
                        <input
                            className="form-input"
                            value={metaApi.adAccountId || ''}
                            onChange={e => setMetaApi({ ...metaApi, adAccountId: e.target.value })}
                            placeholder="act_123456789"
                        />
                    </div>
                    <div className="form-group">
                        <label>Access Token</label>
                        <input
                            type="password"
                            className="form-input"
                            value={metaApi.token || ''}
                            onChange={e => setMetaApi({ ...metaApi, token: e.target.value })}
                            placeholder="EAAG..."
                        />
                    </div>
                    <div className="form-group">
                        <label>Pixel ID (Optional)</label>
                        <input
                            className="form-input"
                            value={metaApi.pixelId || ''}
                            onChange={e => setMetaApi({ ...metaApi, pixelId: e.target.value })}
                            placeholder="1234567890"
                        />
                    </div>

                    <button className="btn btn-primary mt-4" onClick={() => handleSave('meta', metaApi)}>
                        <Save size={16} /> Save Meta Settings
                    </button>
                </div>

                {/* Google Ads Card */}
                <div className="glass-panel" style={{ padding: '1.5rem', borderLeft: '4px solid #ea4335' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
                        <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            Google Ads
                        </h3>
                        <label className="switch">
                            <input
                                type="checkbox"
                                checked={googleApi.enabled}
                                onChange={(e) => setGoogleApi({ ...googleApi, enabled: e.target.checked })}
                            />
                            <span className="slider round"></span>
                        </label>
                    </div>

                    <div className="form-group">
                        <label>Customer ID</label>
                        <input
                            className="form-input"
                            value={googleApi.customerId || ''}
                            onChange={e => setGoogleApi({ ...googleApi, customerId: e.target.value })}
                            placeholder="123-456-7890"
                        />
                    </div>
                    <div className="form-group">
                        <label>Developer Token / API Key</label>
                        <input
                            type="password"
                            className="form-input"
                            value={googleApi.token || ''}
                            onChange={e => setGoogleApi({ ...googleApi, token: e.target.value })}
                        />
                    </div>

                    <button className="btn btn-primary mt-4" onClick={() => handleSave('google', googleApi)}>
                        <Save size={16} /> Save Google Settings
                    </button>
                </div>

            </div>
        </div>
    );
};

export default MarketingSettings;
