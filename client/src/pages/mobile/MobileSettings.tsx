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
 * MobileSettings - Premium dark-mode settings for PWA.
 * Provides sync controls and quick access to key settings.
 */

interface SettingItem {
    id: string;
    label: string;
    description: string;
    icon: typeof Bell;
    iconColor: string;
    iconBg: string;
}

export function MobileSettings() {
    const navigate = useNavigate();
    const { token } = useAuth();
    const { currentAccount, accounts, setCurrentAccount } = useAccount();
    const [syncing, setSyncing] = useState(false);
    const [showSwitcher, setShowSwitcher] = useState(false);

    /**
     * Triggers haptic feedback if supported.
     */
    const triggerHaptic = (duration = 10) => {
        if ('vibrate' in navigator) {
            navigator.vibrate(duration);
        }
    };

    const settingSections = [
        {
            title: 'Notifications',
            items: [
                {
                    id: 'push',
                    label: 'Push Notifications',
                    description: 'Manage notification preferences',
                    icon: Bell,
                    iconColor: 'text-purple-400',
                    iconBg: 'bg-purple-500/20'
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
                    iconColor: 'text-orange-400',
                    iconBg: 'bg-orange-500/20'
                },
                {
                    id: 'inbox',
                    label: 'Inbox Settings',
                    description: 'Chat and inbox preferences',
                    icon: MessageSquare,
                    iconColor: 'text-emerald-400',
                    iconBg: 'bg-emerald-500/20'
                }
            ]
        },
        {
            title: 'Active Store',
            items: [
                {
                    id: 'website',
                    label: currentAccount?.name || 'Store',
                    description: currentAccount?.wooUrl || 'No website configured',
                    icon: Globe,
                    iconColor: 'text-blue-400',
                    iconBg: 'bg-blue-500/20'
                }
            ]
        }
    ];

    const handleSync = async () => {
        if (!token || !currentAccount || syncing) return;

        triggerHaptic(20);
        setSyncing(true);
        try {
            await fetch('/api/sync/products/import', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'X-Account-ID': currentAccount.id
                }
            });
            await fetch('/api/sync/orders/import', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'X-Account-ID': currentAccount.id
                }
            });
            triggerHaptic(30);
        } catch (e) {
            Logger.error('[MobileSettings] Sync error:', { error: e });
        } finally {
            setSyncing(false);
        }
    };

    const handleSettingPress = (id: string) => {
        triggerHaptic();
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
        <div className="space-y-6 animate-fade-slide-up">
            {/* Header */}
            <div className="flex items-center gap-3">
                <button
                    onClick={() => {
                        triggerHaptic();
                        navigate(-1);
                    }}
                    className="w-10 h-10 flex items-center justify-center rounded-2xl bg-slate-800/50 backdrop-blur-sm border border-white/10 active:scale-95 transition-transform"
                    aria-label="Go back"
                >
                    <ChevronLeft size={22} className="text-slate-300" />
                </button>
                <h1 className="text-xl font-bold text-white">Settings</h1>
            </div>

            {/* Sync Card */}
            <div className="bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl p-5 text-white shadow-xl shadow-indigo-500/20">
                <h3 className="font-semibold text-lg">Store Sync</h3>
                <p className="text-sm text-white/70 mt-1">Keep products and orders up to date</p>
                <button
                    onClick={handleSync}
                    disabled={syncing}
                    className="mt-4 w-full py-3.5 bg-white/20 hover:bg-white/30 rounded-xl font-semibold flex items-center justify-center gap-2 transition-all active:scale-[0.98] disabled:opacity-50"
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
                    <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3 px-1">
                        {section.title}
                    </h3>
                    <div className="bg-slate-800/50 backdrop-blur-sm border border-white/10 rounded-2xl divide-y divide-white/5 overflow-hidden">
                        {section.items.map((item) => {
                            const Icon = item.icon;
                            return (
                                <button
                                    key={item.id}
                                    onClick={() => handleSettingPress(item.id)}
                                    className="w-full flex items-center gap-4 p-4 text-left active:bg-white/5 transition-colors"
                                >
                                    <div className={`w-10 h-10 rounded-xl ${item.iconBg} flex items-center justify-center`}>
                                        <Icon size={20} className={item.iconColor} />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="font-medium text-white">{item.label}</p>
                                        <p className="text-sm text-slate-400 truncate">{item.description}</p>
                                    </div>
                                    <ChevronRight size={18} className="text-slate-500 flex-shrink-0" />
                                </button>
                            );
                        })}
                    </div>
                </div>
            ))}

            {/* App Info */}
            <div className="text-center text-sm text-slate-500 py-4">
                <p>OverSeek Companion v1.0</p>
                <p className="mt-1">© 2026 SLDevs</p>
            </div>

            {/* Account Switcher Modal */}
            {showSwitcher && (
                <div className="fixed inset-0 z-50 flex items-end justify-center">
                    {/* Backdrop */}
                    <div
                        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
                        onClick={() => setShowSwitcher(false)}
                    />
                    {/* Modal */}
                    <div className="relative w-full max-w-md bg-slate-900 border-t border-white/10 rounded-t-3xl p-6 pb-8 animate-fade-slide-up">
                        <div className="w-12 h-1 bg-slate-700 rounded-full mx-auto mb-4" />
                        <h2 className="text-lg font-bold text-white mb-4">Switch Store</h2>
                        <div className="space-y-2 max-h-64 overflow-y-auto">
                            {accounts.map((account) => (
                                <button
                                    key={account.id}
                                    onClick={() => {
                                        triggerHaptic(15);
                                        setCurrentAccount(account);
                                        setShowSwitcher(false);
                                        window.location.reload();
                                    }}
                                    className={`w-full flex items-center gap-3 p-4 rounded-xl text-left transition-colors ${currentAccount?.id === account.id
                                        ? 'bg-indigo-500/20 border-2 border-indigo-500'
                                        : 'bg-slate-800/50 border-2 border-transparent hover:bg-slate-700/50'
                                        }`}
                                >
                                    <div className={`w-10 h-10 rounded-xl ${currentAccount?.id === account.id ? 'bg-indigo-500/20' : 'bg-slate-700'} flex items-center justify-center`}>
                                        <Globe size={18} className={currentAccount?.id === account.id ? 'text-indigo-400' : 'text-slate-400'} />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className={`font-medium truncate ${currentAccount?.id === account.id ? 'text-indigo-400' : 'text-white'}`}>
                                            {account.name}
                                        </p>
                                        <p className="text-sm text-slate-500 truncate">{account.wooUrl}</p>
                                    </div>
                                    {currentAccount?.id === account.id && (
                                        <span className="text-xs font-medium text-indigo-400 bg-indigo-500/20 px-2.5 py-1 rounded-lg">Active</span>
                                    )}
                                </button>
                            ))}
                        </div>
                        <button
                            onClick={() => setShowSwitcher(false)}
                            className="w-full mt-4 py-3.5 bg-slate-800 border border-white/10 rounded-xl font-medium text-slate-300 active:bg-slate-700"
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
