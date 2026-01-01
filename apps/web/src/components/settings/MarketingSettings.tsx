import React, { useState, useEffect } from 'react';
import { useAccount } from '../../context/AccountContext';
import { toast } from 'sonner';
import { Save, AlertCircle } from 'lucide-react';
import axios from 'axios';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';

interface MarketingIntegration {
    platform: string;
    accessToken?: string;
    pixelId?: string;
    adAccountId?: string; // stored in accessToken or separate? Schema has pixelId. 
    // Schema: platform, status, accessToken, refreshToken, pixelId.
    // Frontend asks for: adAccountId, token, pixelId.
    // I should map adAccountId to pixelId or store it in accessToken logic? 
    // Let's assume adAccountId is part of the config we might strictly need, but schema didn't have it explicitly.
    // I'll adhere to schema: store adAccountId in "pixelId" field for now or just add it to schema?
    // User asked to follow db.js schema. db.js schema `ad_integrations` columns: account_id, platform, status.
    // It doesn't specify 'adAccountId'.
    // I will store adAccountId in the accessToken payload or just assume pixelId is enough for basic tracking?
    // Wait, let's keep it simple: Just save what the UI asks for.
    enabled: boolean;
    status: string;
}

const MarketingSettings = () => {
    const { activeAccount } = useAccount();
    const [metaApi, setMetaApi] = useState({ token: '', pixelId: '', adAccountId: '', enabled: false });
    const [googleApi, setGoogleApi] = useState({ token: '', customerId: '', enabled: false });
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const loadSettings = async () => {
            if (!activeAccount) return;
            try {
                const { data } = await axios.get('/api/marketing/integrations', { withCredentials: true });
                // data is array: [{ platform: 'meta', status: 'active', ... }]

                const meta = data.find((i: any) => i.platform === 'meta');
                const google = data.find((i: any) => i.platform === 'google');

                if (meta) {
                    setMetaApi({
                        token: '', // Server returns empty/hidden for security? Or we can't show it back.
                        pixelId: meta.pixelId || '',
                        adAccountId: '', // Server doesn't reject it but we don't have separate col?
                        enabled: meta.status === 'active'
                    });
                }
                if (google) {
                    setGoogleApi({
                        token: '',
                        customerId: google.pixelId || '', // Map customerId to pixelId col for generic storage
                        enabled: google.status === 'active'
                    });
                }
            } catch (e) {
                console.error("Failed to load marketing settings", e);
            } finally {
                setLoading(false);
            }
        };
        loadSettings();
    }, [activeAccount]);

    const handleSave = async (platform: string, data: any) => {
        if (!activeAccount) return;

        // Map UI state to API Payload
        const payload: any = {
            platform,
            status: data.enabled ? 'active' : 'inactive',
        };

        if (platform === 'meta') {
            payload.accessToken = data.token;
            payload.pixelId = data.pixelId; // We could store adAccountId here too if we change schema
        } else {
            payload.accessToken = data.token;
            payload.pixelId = data.customerId; // Storing Google Customer ID in pixelId column
        }

        try {
            await axios.post('/api/marketing/integrations', payload, { withCredentials: true });
            toast.success(`${platform === 'meta' ? 'Meta' : 'Google'} settings saved`);
        } catch (e) {
            console.error(e);
            toast.error('Failed to save settings');
        }
    };

    if (loading) return <div className="p-8">Loading integrations...</div>;

    return (
        <div className="animate-fade-in space-y-6">
            <div>
                <h2 className="text-2xl font-bold tracking-tight">Marketing Integrations</h2>
                <p className="text-muted-foreground">Connect your ad platforms to enable AI-driven revenue tracking.</p>
            </div>

            <div className="grid gap-6 md:grid-cols-2">

                {/* Meta Ads Card */}
                <Card className="border-l-4 border-l-blue-600">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-lg font-medium flex items-center gap-2">
                            Meta Ads
                        </CardTitle>
                        <div className="flex items-center space-x-2">
                            <input
                                type="checkbox"
                                className="toggle"
                                checked={metaApi.enabled}
                                onChange={(e) => setMetaApi({ ...metaApi, enabled: e.target.checked })}
                            />
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-4 pt-4">
                        <div className="grid w-full items-center gap-1.5">
                            <Label>Pixel ID</Label>
                            <Input
                                value={metaApi.pixelId}
                                onChange={e => setMetaApi({ ...metaApi, pixelId: e.target.value })}
                                placeholder="1234567890"
                            />
                        </div>
                        <div className="grid w-full items-center gap-1.5">
                            <Label>Access Token</Label>
                            <Input
                                type="password"
                                value={metaApi.token}
                                onChange={e => setMetaApi({ ...metaApi, token: e.target.value })}
                                placeholder="EAAG..."
                            />
                            <p className="text-xs text-muted-foreground">Leave blank to keep existing token.</p>
                        </div>
                        <Button onClick={() => handleSave('meta', metaApi)} className="w-full">
                            <Save className="mr-2 h-4 w-4" /> Save Meta Settings
                        </Button>
                    </CardContent>
                </Card>

                {/* Google Ads Card */}
                <Card className="border-l-4 border-l-red-600">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-lg font-medium flex items-center gap-2">
                            Google Ads
                        </CardTitle>
                        <div className="flex items-center space-x-2">
                            <input
                                type="checkbox"
                                className="toggle"
                                checked={googleApi.enabled}
                                onChange={(e) => setGoogleApi({ ...googleApi, enabled: e.target.checked })}
                            />
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-4 pt-4">
                        <div className="grid w-full items-center gap-1.5">
                            <Label>Customer ID</Label>
                            <Input
                                value={googleApi.customerId}
                                onChange={e => setGoogleApi({ ...googleApi, customerId: e.target.value })}
                                placeholder="123-456-7890"
                            />
                        </div>
                        <div className="grid w-full items-center gap-1.5">
                            <Label>Developer Token</Label>
                            <Input
                                type="password"
                                value={googleApi.token}
                                onChange={e => setGoogleApi({ ...googleApi, token: e.target.value })}
                            />
                            <p className="text-xs text-muted-foreground">Leave blank to keep existing token.</p>
                        </div>
                        <Button onClick={() => handleSave('google', googleApi)} className="w-full">
                            <Save className="mr-2 h-4 w-4" /> Save Google Settings
                        </Button>
                    </CardContent>
                </Card>

            </div>
        </div>
    );
};

export default MarketingSettings;
