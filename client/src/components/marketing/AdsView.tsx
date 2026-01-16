import { useEffect, useState } from 'react';
import { Logger } from '../../utils/logger';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { Plus, Facebook, Loader2, Trash2, ExternalLink, AlertCircle, RefreshCw, BarChart2 } from 'lucide-react';
import { GoogleAdsCampaigns } from './GoogleAdsCampaigns';

interface AdAccount {
    id: string;
    platform: string;
    name: string;
    externalId: string;
}

interface AdInsights {
    spend: number;
    impressions: number;
    clicks: number;
    roas: number;
    currency: string;
}

interface AdsViewProps {
    onSelectAccount?: (account: AdAccount) => void;
}

/**
 * AdsView component for managing connected ad platform accounts.
 * Supports Meta Ads (manual token) and Google Ads (OAuth flow).
 */
export function AdsView({ onSelectAccount }: AdsViewProps = {}) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [accounts, setAccounts] = useState<AdAccount[]>([]);
    const [insights, setInsights] = useState<Record<string, AdInsights>>({});
    const [loadingInsights, setLoadingInsights] = useState<Record<string, boolean>>({});
    const [insightErrors, setInsightErrors] = useState<Record<string, string>>({});
    const [isLoading, setIsLoading] = useState(true);
    const [showConnect, setShowConnect] = useState(false);

    // Form State
    const [formData, setFormData] = useState({ platform: 'META', externalId: '', accessToken: '', name: '' });
    const [isConnecting, setIsConnecting] = useState(false);

    // Pending Google Ads setup state
    const [pendingSetup, setPendingSetup] = useState<{ show: boolean; pendingId: string; customerId: string; isSubmitting: boolean }>({
        show: false,
        pendingId: '',
        customerId: '',
        isSubmitting: false
    });

    // Selected account for campaign breakdown view (only when no onSelectAccount prop)
    const [selectedAccount, setSelectedAccount] = useState<AdAccount | null>(null);


    useEffect(() => {
        fetchAccounts();
    }, [currentAccount, token]);

    async function fetchAccounts() {
        if (!currentAccount) return;
        try {
            const res = await fetch('/api/ads', {
                headers: { 'Authorization': `Bearer ${token}`, 'X-Account-ID': currentAccount.id }
            });
            const data = await res.json();
            setAccounts(data);

            // Lazy fetch insights for each (skip pending accounts)
            if (Array.isArray(data)) {
                data.forEach((acc: AdAccount) => {
                    if (acc.externalId !== 'PENDING_SETUP') {
                        fetchInsights(acc.id);
                    }
                });
            }
        } catch (err) {
            Logger.error('An error occurred', { error: err });
        } finally {
            setIsLoading(false);
        }
    }

    async function fetchInsights(adAccountId: string) {
        setLoadingInsights(prev => ({ ...prev, [adAccountId]: true }));
        setInsightErrors(prev => ({ ...prev, [adAccountId]: '' })); // Clear previous error
        try {
            const res = await fetch(`/api/ads/${adAccountId}/insights`, {
                headers: { 'Authorization': `Bearer ${token}`, 'X-Account-ID': currentAccount?.id || '' }
            });
            const data = await res.json();
            if (!data.error) {
                setInsights(prev => ({ ...prev, [adAccountId]: data }));
            } else {
                Logger.error(`Insights fetch error for ${adAccountId}`, { error: data.error });
                setInsightErrors(prev => ({ ...prev, [adAccountId]: data.error }));
            }
        } catch (err: any) {
            Logger.error('Failed to fetch insights', { error: err });
            setInsightErrors(prev => ({ ...prev, [adAccountId]: err.message || 'Connection error' }));
        } finally {
            setLoadingInsights(prev => ({ ...prev, [adAccountId]: false }));
        }
    }

    async function handleConnect(e: React.FormEvent) {
        e.preventDefault();
        if (!currentAccount) return;

        setIsConnecting(true);
        try {
            const res = await fetch('/api/ads/connect', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'X-Account-ID': currentAccount.id
                },
                body: JSON.stringify(formData)
            });

            if (res.ok) {
                setShowConnect(false);
                setFormData({ platform: 'META', externalId: '', accessToken: '', name: '' });
                fetchAccounts();
            } else {
                const err = await res.json();
                alert(err.error || 'Failed to connect');
            }
        } catch (err) {
            alert('Error connecting account');
        } finally {
            setIsConnecting(false);
        }
    }

    async function handleGoogleOAuth() {
        if (!currentAccount) return;

        try {
            const res = await fetch(`/api/oauth/google/authorize?redirect=${encodeURIComponent('/marketing?tab=ads')}`, {
                headers: { 'Authorization': `Bearer ${token}`, 'X-Account-ID': currentAccount.id }
            });
            const data = await res.json();

            if (data.authUrl) {
                window.location.href = data.authUrl;
            } else {
                alert('Failed to initiate Google OAuth');
            }
        } catch (err) {
            alert('Error initiating Google OAuth');
        }
    }

    async function handleDisconnect(adAccountId: string) {
        if (!confirm('Are you sure you want to disconnect this ad account?')) return;

        try {
            const res = await fetch(`/api/ads/${adAccountId}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}`, 'X-Account-ID': currentAccount?.id || '' }
            });

            if (res.ok) {
                fetchAccounts();
            } else {
                alert('Failed to disconnect');
            }
        } catch (err) {
            alert('Error disconnecting account');
        }
    }

    async function handleCompletePendingSetup() {
        if (!currentAccount || !pendingSetup.customerId.trim()) return;

        setPendingSetup(prev => ({ ...prev, isSubmitting: true }));
        try {
            const res = await fetch(`/api/ads/${pendingSetup.pendingId}/complete-setup`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'X-Account-ID': currentAccount.id
                },
                body: JSON.stringify({ customerId: pendingSetup.customerId.trim() })
            });

            if (res.ok) {
                alert('Google Ads account configured successfully!');
                setPendingSetup({ show: false, pendingId: '', customerId: '', isSubmitting: false });
                fetchAccounts();
            } else {
                const err = await res.json();
                alert(err.error || 'Failed to complete setup');
            }
        } catch (err) {
            alert('Error completing setup');
        } finally {
            setPendingSetup(prev => ({ ...prev, isSubmitting: false }));
        }
    }

    // Check for OAuth callback status
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        if (params.get('success') === 'google_connected') {
            // Show success message and clean URL
            alert('Google Ads account connected successfully!');
            window.history.replaceState({}, '', '/marketing?tab=ads');
            fetchAccounts();
        } else if (params.get('success') === 'google_pending') {
            // Show Customer ID input modal
            const pendingId = params.get('pendingId') || '';
            setPendingSetup({ show: true, pendingId, customerId: '', isSubmitting: false });
            window.history.replaceState({}, '', '/marketing?tab=ads');
            fetchAccounts();
        } else if (params.get('error')) {
            const errorType = params.get('error');
            const errorMessage = params.get('message');
            alert(`OAuth Error: ${errorType}${errorMessage ? ` - ${errorMessage}` : ''}`);
            window.history.replaceState({}, '', '/marketing?tab=ads');
        }
    }, []);

    return (
        <div className="space-y-6">
            {/* Pending Setup Modal */}
            {pendingSetup.show && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-xl shadow-xl p-6 max-w-md w-full mx-4">
                        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                            <AlertCircle className="text-amber-500" size={20} />
                            Complete Google Ads Setup
                        </h3>
                        <p className="text-sm text-gray-600 mb-4">
                            Your Google account has been connected. Please enter your Google Ads Customer ID to complete the setup.
                        </p>
                        <div className="mb-4">
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Google Ads Customer ID
                            </label>
                            <input
                                type="text"
                                className="w-full p-3 border rounded-lg"
                                placeholder="123-456-7890"
                                value={pendingSetup.customerId}
                                onChange={e => setPendingSetup(prev => ({ ...prev, customerId: e.target.value }))}
                            />
                            <p className="text-xs text-gray-500 mt-2">
                                Find your Customer ID in the top-right corner of{' '}
                                <a href="https://ads.google.com" target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">
                                    Google Ads
                                </a>
                                . It looks like: 123-456-7890
                            </p>
                        </div>
                        <div className="flex gap-3 justify-end">
                            <button
                                onClick={() => {
                                    // Delete the pending account
                                    handleDisconnect(pendingSetup.pendingId);
                                    setPendingSetup({ show: false, pendingId: '', customerId: '', isSubmitting: false });
                                }}
                                className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleCompletePendingSetup}
                                disabled={!pendingSetup.customerId.trim() || pendingSetup.isSubmitting}
                                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
                            >
                                {pendingSetup.isSubmitting ? <Loader2 className="animate-spin" size={16} /> : null}
                                Complete Setup
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Campaign Breakdown View */}
            {selectedAccount ? (
                <GoogleAdsCampaigns
                    adAccountId={selectedAccount.id}
                    accountName={selectedAccount.name}
                    onBack={() => setSelectedAccount(null)}
                />
            ) : (
                <>
                    <div className="flex justify-between items-center">
                        <h2 className="text-xl font-semibold text-gray-900">Ad Accounts</h2>
                        <button
                            onClick={() => setShowConnect(!showConnect)}
                            className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
                        >
                            <Plus size={18} /> Connect Account
                        </button>
                    </div>

                    {/* Connect Form */}
                    {showConnect && (
                        <div className="bg-white p-6 rounded-xl shadow-xs border border-gray-200 mb-6">
                            <h3 className="font-semibold mb-4">Connect Ad Platform</h3>
                            <form onSubmit={handleConnect} className="grid gap-4 max-w-md">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Platform</label>
                                    <select
                                        className="w-full p-2 border rounded-lg"
                                        value={formData.platform}
                                        onChange={e => setFormData({ ...formData, platform: e.target.value })}
                                    >
                                        <option value="META">Meta Ads (Facebook/Instagram)</option>
                                        <option value="GOOGLE">Google Ads</option>
                                    </select>
                                </div>

                                {formData.platform === 'GOOGLE' ? (
                                    /* Google Ads - OAuth Flow */
                                    <div className="space-y-4">
                                        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                                            <p className="text-sm text-blue-800">
                                                Google Ads requires OAuth authentication. Click the button below to connect your account securely.
                                            </p>
                                        </div>
                                        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                                            <p className="text-sm text-amber-800 font-medium mb-2">
                                                ⚠️ Google Cloud Console Setup Required
                                            </p>
                                            <p className="text-xs text-amber-700 mb-2">
                                                Add this redirect URI to your Google Cloud OAuth credentials:
                                            </p>
                                            <code className="block bg-white border border-amber-300 rounded-sm px-3 py-2 text-xs font-mono text-gray-800 break-all select-all">
                                                {window.location.origin}/api/oauth/google/callback
                                            </code>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={handleGoogleOAuth}
                                            className="w-full flex items-center justify-center gap-2 bg-white border border-gray-300 px-4 py-3 rounded-lg hover:bg-gray-50 font-medium"
                                        >
                                            <svg className="w-5 h-5" viewBox="0 0 24 24">
                                                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                                                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                                                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                                                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                                            </svg>
                                            Connect with Google
                                        </button>
                                    </div>
                                ) : (
                                    /* Meta Ads - Manual Token Entry */
                                    <>
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-1">Account Name (Optional)</label>
                                            <input
                                                type="text"
                                                className="w-full p-2 border rounded-lg"
                                                placeholder="e.g. Summer Campaign Account"
                                                value={formData.name}
                                                onChange={e => setFormData({ ...formData, name: e.target.value })}
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-1">Ad Account ID</label>
                                            <input
                                                type="text"
                                                className="w-full p-2 border rounded-lg"
                                                placeholder="act_123456789"
                                                value={formData.externalId}
                                                onChange={e => setFormData({ ...formData, externalId: e.target.value })}
                                                required
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-1">Access Token</label>
                                            <input
                                                type="password"
                                                className="w-full p-2 border rounded-lg"
                                                placeholder="EAA..."
                                                value={formData.accessToken}
                                                onChange={e => setFormData({ ...formData, accessToken: e.target.value })}
                                                required
                                            />
                                            <p className="text-xs text-gray-500 mt-1 flex items-center gap-1">
                                                Get a token from{' '}
                                                <a
                                                    href="https://developers.facebook.com/tools/explorer/"
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="text-blue-600 underline inline-flex items-center gap-0.5"
                                                >
                                                    Graph API Explorer <ExternalLink size={12} />
                                                </a>
                                            </p>
                                        </div>
                                        <div className="flex justify-end gap-2 mt-2">
                                            <button
                                                type="button"
                                                onClick={() => setShowConnect(false)}
                                                className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg"
                                            >
                                                Cancel
                                            </button>
                                            <button
                                                type="submit"
                                                disabled={isConnecting}
                                                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                                            >
                                                {isConnecting ? <Loader2 className="animate-spin" size={18} /> : 'Save'}
                                            </button>
                                        </div>
                                    </>
                                )}
                            </form>
                        </div>
                    )
                    }

                    {/* List */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {isLoading ? (
                            <div className="col-span-full text-center py-12"><Loader2 className="animate-spin inline text-gray-400" /></div>
                        ) : accounts.length === 0 ? (
                            <div className="col-span-full text-center py-12 text-gray-500 bg-gray-50 rounded-xl border border-dashed border-gray-300">
                                No ad accounts connected.
                            </div>
                        ) : (
                            accounts.map(acc => {
                                const ins = insights[acc.id];
                                const isPending = acc.externalId === 'PENDING_SETUP';
                                return (
                                    <div key={acc.id} className={`bg-white rounded-xl shadow-xs border p-6 space-y-4 ${isPending ? 'border-amber-300' : 'border-gray-200'}`}>
                                        <div className="flex justify-between items-start">
                                            <div className="flex items-center gap-3">
                                                <div className={`p-2 rounded-lg ${acc.platform === 'META' ? 'bg-blue-50 text-blue-600' : 'bg-red-50 text-red-600'}`}>
                                                    {acc.platform === 'META' ? <Facebook size={24} /> : (
                                                        <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
                                                            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                                                            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                                                            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                                                            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                                                        </svg>
                                                    )}
                                                </div>
                                                <div>
                                                    <h3 className="font-semibold text-gray-900">{acc.name}</h3>
                                                    <p className="text-xs text-gray-500 font-mono">{isPending ? 'Setup not complete' : acc.externalId}</p>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                {isPending ? (
                                                    <>
                                                        <button
                                                            onClick={() => setPendingSetup({ show: true, pendingId: acc.id, customerId: '', isSubmitting: false })}
                                                            className="bg-amber-100 text-amber-800 text-xs px-2 py-1 rounded-full hover:bg-amber-200"
                                                        >
                                                            Complete Setup
                                                        </button>
                                                    </>
                                                ) : (
                                                    <>
                                                        <span className="bg-green-100 text-green-800 text-xs px-2 py-1 rounded-full">Active</span>
                                                        <button
                                                            onClick={() => fetchInsights(acc.id)}
                                                            disabled={loadingInsights[acc.id]}
                                                            className="p-1 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-sm disabled:opacity-50"
                                                            title="Refresh data"
                                                        >
                                                            <RefreshCw size={16} className={loadingInsights[acc.id] ? 'animate-spin' : ''} />
                                                        </button>
                                                        {(acc.platform === 'GOOGLE' || acc.platform === 'META') && !isPending && (
                                                            <button
                                                                onClick={() => onSelectAccount ? onSelectAccount(acc) : setSelectedAccount(acc)}
                                                                className="p-1 text-gray-400 hover:text-purple-600 hover:bg-purple-50 rounded-sm"
                                                                title="View campaign breakdown"
                                                            >
                                                                <BarChart2 size={16} />
                                                            </button>
                                                        )}
                                                    </>
                                                )}
                                                <button
                                                    onClick={() => handleDisconnect(acc.id)}
                                                    className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-sm"
                                                    title="Disconnect"
                                                >
                                                    <Trash2 size={16} />
                                                </button>
                                            </div>
                                        </div>

                                        <div className="border-t pt-4 grid grid-cols-2 gap-4">
                                            <div>
                                                <p className="text-xs text-gray-500 uppercase">Spend (30d)</p>
                                                <p className="text-xl font-bold text-gray-900">
                                                    {ins?.spend != null ? new Intl.NumberFormat('en-US', { style: 'currency', currency: ins.currency || 'USD' }).format(ins.spend) : '...'}
                                                </p>
                                            </div>
                                            <div>
                                                <p className="text-xs text-gray-500 uppercase">ROAS</p>
                                                <p className="text-xl font-bold text-gray-900">
                                                    {ins?.roas != null ? ins.roas.toFixed(2) + 'x' : '...'}
                                                </p>
                                            </div>
                                            <div>
                                                <p className="text-xs text-gray-500 uppercase">Impressions</p>
                                                <p className="font-medium text-gray-700">
                                                    {ins?.impressions != null ? new Intl.NumberFormat('en-US', { notation: "compact" }).format(ins.impressions) : '...'}
                                                </p>
                                            </div>
                                            <div>
                                                <p className="text-xs text-gray-500 uppercase">Clicks</p>
                                                <p className="font-medium text-gray-700">
                                                    {ins?.clicks != null ? new Intl.NumberFormat('en-US').format(ins.clicks) : '...'}
                                                </p>
                                            </div>
                                        </div>

                                        {/* Error Display */}
                                        {insightErrors[acc.id] && (
                                            <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg">
                                                <div className="flex items-start gap-2">
                                                    <AlertCircle className="text-red-500 shrink-0 mt-0.5" size={16} />
                                                    <div className="text-sm text-red-700">
                                                        <p className="font-medium">Failed to load data</p>
                                                        <p className="text-xs mt-1 text-red-600">{insightErrors[acc.id]}</p>
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                );
                            })
                        )}
                    </div>
                </>
            )}
        </div>
    );
}

