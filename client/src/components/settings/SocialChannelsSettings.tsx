/**
 * Social Channels Settings Component
 * Allows users to connect/disconnect Facebook, Instagram, and TikTok
 * for direct messaging integration with the Inbox.
 */

import { useState, useEffect } from 'react';
import { Facebook, Instagram, Music2, Link2, Unlink, Loader2, AlertCircle, CheckCircle } from 'lucide-react';
import { useAccount } from '../../context/AccountContext';
import { api } from '../../services/api';

interface SocialAccount {
    id: string;
    platform: 'FACEBOOK' | 'INSTAGRAM' | 'TIKTOK';
    name: string;
    externalId: string;
    tokenExpiry: string | null;
    createdAt: string;
}

/**
 * Why: Centralizes social messaging channel management, allowing users
 * to connect their FB Pages, IG accounts, and TikTok for inbox DMs.
 */
export function SocialChannelsSettings() {
    const { currentAccount } = useAccount();
    const [accounts, setAccounts] = useState<SocialAccount[]>([]);
    const [loading, setLoading] = useState(true);
    const [connecting, setConnecting] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);

    // Check URL params for OAuth callback status
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const success = params.get('success');
        const errorParam = params.get('error');
        const message = params.get('message');

        if (success) {
            if (success === 'meta_connected') {
                setSuccessMessage('Facebook page connected successfully!' +
                    (params.get('instagram') === 'connected' ? ' Instagram also linked.' : ''));
            } else if (success === 'tiktok_connected') {
                setSuccessMessage('TikTok account connected successfully!');
            }
            // Clear params from URL
            window.history.replaceState({}, '', window.location.pathname + '?tab=channels');
            fetchAccounts();
        }

        if (errorParam) {
            const errorMessages: Record<string, string> = {
                oauth_denied: 'Authorization was denied.',
                no_pages: 'No Facebook Pages found. Please create a Page first.',
                not_configured: 'Platform not configured. Contact your administrator.',
                token_exchange_failed: 'Failed to connect account. Please try again.',
            };
            setError(errorMessages[errorParam] || message || 'Connection failed.');
            window.history.replaceState({}, '', window.location.pathname + '?tab=channels');
        }
    }, []);

    const fetchAccounts = async () => {
        try {
            setLoading(true);
            const response = await api.get<{ socialAccounts: SocialAccount[] }>('/api/oauth/social-accounts');
            setAccounts(response.socialAccounts || []);
        } catch (err: any) {
            setError(err.message || 'Failed to load connected accounts.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchAccounts();
    }, [currentAccount]);

    const connectPlatform = async (platform: 'meta' | 'tiktok') => {
        try {
            setConnecting(platform);
            setError(null);

            const endpoint = platform === 'meta'
                ? '/api/oauth/meta/messaging/authorize?redirect=/settings?tab=channels'
                : '/api/oauth/tiktok/authorize?redirect=/settings?tab=channels';

            const response = await api.get<{ authUrl: string }>(endpoint);

            // Redirect to OAuth consent screen
            window.location.href = response.authUrl;
        } catch (err: any) {
            setError(err.message || `Failed to start ${platform} connection.`);
            setConnecting(null);
        }
    };

    const disconnectAccount = async (accountId: string, platform: string) => {
        if (!confirm(`Disconnect ${platform}? You will no longer receive messages from this account.`)) {
            return;
        }

        try {
            await api.delete(`/api/oauth/social-accounts/${accountId}`);
            setAccounts(prev => prev.filter(a => a.id !== accountId));
            setSuccessMessage(`${platform} disconnected.`);
        } catch (err: any) {
            setError(err.response?.data?.error || 'Failed to disconnect.');
        }
    };

    const getPlatformIcon = (platform: string) => {
        switch (platform) {
            case 'FACEBOOK': return <Facebook className="text-blue-600" size={20} />;
            case 'INSTAGRAM': return <Instagram className="text-pink-600" size={20} />;
            case 'TIKTOK': return <Music2 className="text-gray-900" size={20} />;
            default: return null;
        }
    };

    const getPlatformLabel = (platform: string) => {
        switch (platform) {
            case 'FACEBOOK': return 'Facebook Messenger';
            case 'INSTAGRAM': return 'Instagram DMs';
            case 'TIKTOK': return 'TikTok Messages';
            default: return platform;
        }
    };

    const isConnected = (platform: string) => accounts.some(a => a.platform === platform);

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <Loader2 className="animate-spin text-gray-400" size={24} />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Status Messages */}
            {error && (
                <div className="flex items-center gap-2 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
                    <AlertCircle size={18} />
                    <span>{error}</span>
                    <button onClick={() => setError(null)} className="ml-auto text-red-500 hover:text-red-700">×</button>
                </div>
            )}
            {successMessage && (
                <div className="flex items-center gap-2 p-4 bg-green-50 border border-green-200 rounded-lg text-green-700">
                    <CheckCircle size={18} />
                    <span>{successMessage}</span>
                    <button onClick={() => setSuccessMessage(null)} className="ml-auto text-green-500 hover:text-green-700">×</button>
                </div>
            )}

            {/* Connected Accounts */}
            {accounts.length > 0 && (
                <div className="bg-white rounded-xl shadow-xs border border-gray-200 overflow-hidden">
                    <div className="p-4 border-b border-gray-200">
                        <h3 className="font-medium text-gray-900">Connected Channels</h3>
                    </div>
                    <ul className="divide-y divide-gray-200">
                        {accounts.map(account => (
                            <li key={account.id} className="p-4 flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    {getPlatformIcon(account.platform)}
                                    <div>
                                        <p className="font-medium text-gray-900">{account.name}</p>
                                        <p className="text-sm text-gray-500">{getPlatformLabel(account.platform)}</p>
                                    </div>
                                </div>
                                <button
                                    onClick={() => disconnectAccount(account.id, account.platform)}
                                    className="flex items-center gap-1 text-sm text-red-600 hover:text-red-700"
                                >
                                    <Unlink size={14} />
                                    Disconnect
                                </button>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {/* Available Platforms */}
            <div className="bg-white rounded-xl shadow-xs border border-gray-200 overflow-hidden">
                <div className="p-4 border-b border-gray-200">
                    <h3 className="font-medium text-gray-900">Connect Messaging Channels</h3>
                    <p className="text-sm text-gray-500 mt-1">
                        Link your social accounts to receive and respond to messages in your inbox.
                    </p>
                </div>

                <div className="p-4 space-y-3">
                    {/* Meta (Facebook + Instagram) */}
                    <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                        <div className="flex items-center gap-3">
                            <div className="flex items-center gap-1">
                                <Facebook className="text-blue-600" size={20} />
                                <span className="text-gray-400">/</span>
                                <Instagram className="text-pink-600" size={20} />
                            </div>
                            <div>
                                <p className="font-medium text-gray-900">Facebook & Instagram</p>
                                <p className="text-sm text-gray-500">Connect your Facebook Page to receive Messenger & IG DMs</p>
                            </div>
                        </div>
                        {isConnected('FACEBOOK') || isConnected('INSTAGRAM') ? (
                            <span className="flex items-center gap-1 text-sm text-green-600">
                                <CheckCircle size={14} />
                                Connected
                            </span>
                        ) : (
                            <button
                                onClick={() => connectPlatform('meta')}
                                disabled={!!connecting}
                                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                            >
                                {connecting === 'meta' ? (
                                    <Loader2 className="animate-spin" size={16} />
                                ) : (
                                    <Link2 size={16} />
                                )}
                                Connect
                            </button>
                        )}
                    </div>

                    {/* TikTok */}
                    <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                        <div className="flex items-center gap-3">
                            <Music2 className="text-gray-900" size={20} />
                            <div>
                                <p className="font-medium text-gray-900">TikTok Business</p>
                                <p className="text-sm text-gray-500">Receive TikTok DMs (48-hour reply window)</p>
                            </div>
                        </div>
                        {isConnected('TIKTOK') ? (
                            <span className="flex items-center gap-1 text-sm text-green-600">
                                <CheckCircle size={14} />
                                Connected
                            </span>
                        ) : (
                            <button
                                onClick={() => connectPlatform('tiktok')}
                                disabled={!!connecting}
                                className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:opacity-50"
                            >
                                {connecting === 'tiktok' ? (
                                    <Loader2 className="animate-spin" size={16} />
                                ) : (
                                    <Link2 size={16} />
                                )}
                                Connect
                            </button>
                        )}
                    </div>
                </div>

                {/* Info Note */}
                <div className="p-4 bg-blue-50 border-t border-blue-100">
                    <p className="text-sm text-blue-700">
                        <strong>Note:</strong> Facebook/Instagram requires a Facebook Page. TikTok messaging is not available in EEA, Switzerland, or UK regions.
                    </p>
                </div>
            </div>
        </div>
    );
}
