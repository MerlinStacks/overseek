import { useState } from 'react';
import { Logger } from '../../utils/logger';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import {
    ChevronLeft,
    ChevronRight,
    Bell,
    Package,
    MessageSquare,
    RefreshCw,
    Globe,
    Loader2
} from 'lucide-react';

/**
 * MobileSettings - Mobile-optimized settings page
 * Provides quick access to key settings in a mobile-friendly format
 */

interface SettingItem {
    id: string;
    label: string;
    description: string;
    icon: typeof Bell;
    color: string;
    badge?: string;
}

export function MobileSettings() {
    const navigate = useNavigate();
    const { token } = useAuth();
    const { currentAccount, accounts, setCurrentAccount } = useAccount();
    const [syncing, setSyncing] = useState(false);
    const [showSwitcher, setShowSwitcher] = useState(false);

    const settingSections = [
        {
            title: 'Notifications',
            items: [
                {
                    id: 'push',
                    label: 'Push Notifications',
                    description: 'Manage notification preferences',
                    icon: Bell,
                    color: 'bg-blue-100 text-blue-600'
                }
            ]
        },
        {
            title: 'Store Settings',
            items: [
                {
                    id: 'products',
                    label: 'Products & Inventory',
                    description: 'Manage stock settings',
                    icon: Package,
                    color: 'bg-green-100 text-green-600'
                },
                {
                    id: 'inbox',
                    label: 'Inbox Settings',
                    description: 'Chat and inbox preferences',
                    icon: MessageSquare,
                    color: 'bg-purple-100 text-purple-600'
                }
            ]
        },
        {
            title: 'Active store',
            items: [
                {
                    id: 'website',
                    label: 'Website',
                    description: (currentAccount as any)?.website || 'No website configured',
                    icon: Globe,
                    color: 'bg-gray-100 text-gray-600'
                }
            ]
        }
    ];

    const handleSync = async () => {
        if (!token || !currentAccount || syncing) return;

        setSyncing(true);
        try {
            await fetch('/api/sync/products/import', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'X-Account-ID': currentAccount.id
                }
            });
            // Also sync orders
            await fetch('/api/sync/orders/import', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'X-Account-ID': currentAccount.id
                }
            });
        } catch (e) {
            Logger.error('[MobileSettings] Sync error:', { error: e });
        } finally {
            setSyncing(false);
        }
    };

    const handleSettingPress = (id: string) => {
        switch (id) {
            case 'push':
                navigate('/m/notifications');
                break;
            case 'products':
                navigate('/m/inventory');
                break;
            case 'inbox':
                navigate('/m/inbox');
                break;
            case 'website':
                if (accounts.length > 1) {
                    setShowSwitcher(true);
                }
                break;
            default:
                break;
        }
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center gap-3">
                <button
                    onClick={() => navigate(-1)}
                    className="w-10 h-10 flex items-center justify-center rounded-full bg-gray-100 active:bg-gray-200"
                    aria-label="Go back"
                >
                    <ChevronLeft size={24} />
                </button>
                <h1 className="text-xl font-bold text-gray-900">Settings</h1>
            </div>

            {/* Sync Card */}
            <div className="bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl p-5 text-white">
                <h3 className="font-semibold text-lg">Store Sync</h3>
                <p className="text-sm text-white/80 mt-1">Keep products and orders up to date</p>
                <button
                    onClick={handleSync}
                    disabled={syncing}
                    className="mt-4 w-full py-3 bg-white/20 hover:bg-white/30 rounded-lg font-medium flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
                >
                    {syncing ? (
                        <>
                            <Loader2 size={18} className="animate-spin" />
                            Syncing...
                        </>
                    ) : (
                        <>
                            <RefreshCw size={18} />
                            Sync Now
                        </>
                    )}
                </button>
            </div>

            {/* Settings Sections */}
            {settingSections.map((section, idx) => (
                <div key={idx}>
                    <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2 px-1">
                        {section.title}
                    </h3>
                    <div className="bg-white rounded-xl shadow-sm border border-gray-100 divide-y divide-gray-100">
                        {section.items.map((item) => {
                            const Icon = item.icon;
                            return (
                                <button
                                    key={item.id}
                                    onClick={() => handleSettingPress(item.id)}
                                    className="w-full flex items-center gap-4 p-4 text-left active:bg-gray-50 transition-colors"
                                >
                                    <div className={`w-10 h-10 rounded-full ${item.color} flex items-center justify-center`}>
                                        <Icon size={20} />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="font-medium text-gray-900">{item.label}</p>
                                        <p className="text-sm text-gray-500 truncate">{item.description}</p>
                                    </div>
                                    <ChevronRight size={20} className="text-gray-400 flex-shrink-0" />
                                </button>
                            );
                        })}
                    </div>
                </div>
            ))}

            {/* App Info */}
            <div className="text-center text-sm text-gray-400 py-4">
                <p>OverSeek Companion v1.0</p>
                <p className="mt-1">© 2026 SLDevs</p>
            </div>

            {/* Account Switcher Modal */}
            {showSwitcher && (
                <div className="fixed inset-0 z-50 flex items-end justify-center">
                    {/* Backdrop */}
                    <div
                        className="absolute inset-0 bg-black/50"
                        onClick={() => setShowSwitcher(false)}
                    />
                    {/* Modal */}
                    <div className="relative w-full max-w-md bg-white rounded-t-2xl p-6 pb-8 animate-slide-up">
                        <div className="w-12 h-1 bg-gray-300 rounded-full mx-auto mb-4" />
                        <h2 className="text-lg font-bold text-gray-900 mb-4">Switch Store</h2>
                        <div className="space-y-2 max-h-64 overflow-y-auto">
                            {accounts.map((account) => (
                                <button
                                    key={account.id}
                                    onClick={() => {
                                        setCurrentAccount(account);
                                        setShowSwitcher(false);
                                        // Refresh the page to reload data for new account
                                        window.location.reload();
                                    }}
                                    className={`w-full flex items-center gap-3 p-4 rounded-xl text-left transition-colors ${currentAccount?.id === account.id
                                        ? 'bg-indigo-50 border-2 border-indigo-500'
                                        : 'bg-gray-50 border-2 border-transparent hover:bg-gray-100'
                                        }`}
                                >
                                    <Globe size={20} className={currentAccount?.id === account.id ? 'text-indigo-600' : 'text-gray-400'} />
                                    <div className="flex-1 min-w-0">
                                        <p className={`font-medium truncate ${currentAccount?.id === account.id ? 'text-indigo-600' : 'text-gray-900'}`}>
                                            {account.name}
                                        </p>
                                        <p className="text-sm text-gray-500 truncate">{account.wooUrl}</p>
                                    </div>
                                    {currentAccount?.id === account.id && (
                                        <span className="text-xs font-medium text-indigo-600 bg-indigo-100 px-2 py-1 rounded-full">Active</span>
                                    )}
                                </button>
                            ))}
                        </div>
                        <button
                            onClick={() => setShowSwitcher(false)}
                            className="w-full mt-4 py-3 bg-gray-100 rounded-xl font-medium text-gray-700 active:bg-gray-200"
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
