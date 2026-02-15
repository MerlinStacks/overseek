import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    ArrowLeft,
    Bell,
    Package,
    MessageSquare,
    TrendingDown,
    DollarSign
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { usePushNotifications } from '../../hooks/usePushNotifications';

interface NotificationSetting {
    id: string;
    label: string;
    description: string;
    icon: typeof Bell;
    color: string;
    enabled: boolean;
}

export function MobileNotifications() {
    const navigate = useNavigate();
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const { isSupported, isSubscribed, subscribe, unsubscribe, preferences, updatePreferences } = usePushNotifications();

    const [settings, setSettings] = useState<NotificationSetting[]>([
        { id: 'newOrders', label: 'New Orders', description: 'Get notified when new orders come in', icon: Package, color: 'text-blue-600', enabled: true },
        { id: 'newMessages', label: 'New Messages', description: 'Get notified for customer messages', icon: MessageSquare, color: 'text-green-600', enabled: true },
        { id: 'lowStock', label: 'Low Stock Alerts', description: 'When inventory drops below threshold', icon: TrendingDown, color: 'text-amber-600', enabled: false },
        { id: 'dailySummary', label: 'Daily Summary', description: 'Daily sales and activity report', icon: DollarSign, color: 'text-purple-600', enabled: false },
    ]);

    useEffect(() => {
        // Sync with push notification preferences
        if (preferences) {
            setSettings(prev => prev.map(s => {
                if (s.id === 'newOrders') return { ...s, enabled: preferences.notifyNewOrders };
                if (s.id === 'newMessages') return { ...s, enabled: preferences.notifyNewMessages };
                if (s.id === 'lowStock') return { ...s, enabled: preferences.notifyLowStock };
                if (s.id === 'dailySummary') return { ...s, enabled: preferences.notifyDailySummary };
                return s;
            }));
        }
    }, [preferences]);

    const toggleSetting = async (id: string) => {
        // Haptic feedback
        if ('vibrate' in navigator) {
            navigator.vibrate(10);
        }

        const setting = settings.find(s => s.id === id);
        if (!setting) return;

        const newEnabled = !setting.enabled;
        setSettings(prev => prev.map(s => s.id === id ? { ...s, enabled: newEnabled } : s));

        // Update backend for push preferences
        if (id === 'newOrders') {
            await updatePreferences({ notifyNewOrders: newEnabled });
        } else if (id === 'newMessages') {
            await updatePreferences({ notifyNewMessages: newEnabled });
        } else if (id === 'lowStock') {
            await updatePreferences({ notifyLowStock: newEnabled });
        } else if (id === 'dailySummary') {
            await updatePreferences({ notifyDailySummary: newEnabled });
        }
    };

    const handlePushToggle = async () => {
        if ('vibrate' in navigator) {
            navigator.vibrate(10);
        }
        if (isSubscribed) {
            await unsubscribe();
        } else {
            await subscribe();
        }
    };

    const [testResult, setTestResult] = useState<string | null>(null);
    const [testLoading, setTestLoading] = useState(false);
    const [orderTestLoading, setOrderTestLoading] = useState(false);

    const sendTestNotification = async () => {
        if (!token || !currentAccount) return;

        setTestLoading(true);
        setTestResult(null);

        try {
            const res = await fetch('/api/notifications/push/test', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount.id
                }
            });

            const data = await res.json();
            if (res.ok && data.success) {
                setTestResult(`✅ Sent to ${data.sent} device(s)`);
            } else {
                setTestResult(`❌ ${data.error || 'Failed to send'}`);
            }
        } catch (error) {
            setTestResult('❌ Network error');
        } finally {
            setTestLoading(false);
        }
    };

    const sendTestOrderNotification = async () => {
        if (!token || !currentAccount) return;

        setOrderTestLoading(true);
        setTestResult(null);

        try {
            const res = await fetch('/api/notifications/push/test-order', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount.id
                }
            });

            const data = await res.json();
            if (res.ok && data.success) {
                setTestResult(`✅ Order #${data.orderNumber} sent to ${data.sent} device(s)`);
            } else {
                setTestResult(`❌ ${data.error || 'Failed to send'}`);
            }
        } catch (error) {
            setTestResult('❌ Network error');
        } finally {
            setOrderTestLoading(false);
        }
    };


    // Detect iOS (for specific PWA guidance)
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
        (window.navigator as any).standalone === true;
    // Check if running inside Capacitor native app
    const capacitor = (window as any).Capacitor;
    const isCapacitorNative = capacitor?.isNativePlatform?.() ?? !!capacitor?.platform;

    return (
        <div className="space-y-4 animate-fade-slide-up">
            {/* Header */}
            <div className="flex items-center gap-3 mb-2">
                <button
                    onClick={() => navigate('/m/more')}
                    className="p-2 -ml-2 rounded-xl hover:bg-white/5 active:bg-white/10 transition-colors"
                >
                    <ArrowLeft size={24} className="text-white" />
                </button>
                <h1 className="text-2xl font-bold text-white">Notifications</h1>
            </div>

            {/* iOS Not-Installed Warning - only show if not in native app */}
            {isIOS && !isStandalone && !isCapacitorNative && !isSupported && (
                <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-4">
                    <p className="font-medium text-amber-300">Add to Home Screen Required</p>
                    <p className="text-sm text-amber-400/80 mt-1">
                        To enable push notifications on iOS, add this app to your Home Screen:
                    </p>
                    <ol className="text-sm text-amber-400/80 mt-2 list-decimal ml-4 space-y-1">
                        <li>Tap the Share button</li>
                        <li>Select "Add to Home Screen"</li>
                        <li>Open the app from your Home Screen</li>
                    </ol>
                </div>
            )}

            {/* Push Notifications Master Toggle */}
            <div className="pwa-card p-4">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="p-2.5 bg-indigo-500/20 rounded-xl">
                            <Bell size={22} className="text-indigo-400" />
                        </div>
                        <div>
                            <p className="font-semibold text-white">Push Notifications</p>
                            <p className="text-sm text-slate-400">
                                {!isSupported
                                    ? (isIOS ? 'Requires iOS 16.4+ and Home Screen install' : 'Not supported on this device')
                                    : (isSubscribed ? 'Enabled' : 'Disabled')
                                }
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={handlePushToggle}
                        disabled={!isSupported}
                        className={`w-14 h-8 rounded-full transition-colors relative ${isSubscribed ? 'bg-indigo-600' : 'bg-slate-600'
                            } ${!isSupported ? 'opacity-50' : ''}`}
                    >
                        <div className={`w-6 h-6 bg-white rounded-full shadow-md absolute top-1 transition-all ${isSubscribed ? 'right-1' : 'left-1'
                            }`} />
                    </button>
                </div>
            </div>

            {/* Test Notification Buttons */}
            {isSubscribed && (
                <div className="pwa-card p-4 space-y-3">
                    <button
                        onClick={sendTestNotification}
                        disabled={testLoading}
                        className="w-full py-3 px-4 bg-indigo-500/20 text-indigo-400 font-semibold rounded-xl active:bg-indigo-500/30 disabled:opacity-50 transition-colors"
                    >
                        {testLoading ? 'Sending...' : '🔔 Send Test Notification'}
                    </button>
                    <button
                        onClick={sendTestOrderNotification}
                        disabled={orderTestLoading}
                        className="w-full py-3 px-4 bg-blue-500/20 text-blue-400 font-semibold rounded-xl active:bg-blue-500/30 disabled:opacity-50 transition-colors"
                    >
                        {orderTestLoading ? 'Sending...' : '🛒 Test Order Notification'}
                    </button>
                    {testResult && (
                        <p className="text-sm text-center mt-2 text-slate-400">{testResult}</p>
                    )}
                </div>
            )}

            {/* Notification Types */}
            <div className="pwa-card divide-y divide-white/5 overflow-hidden">
                {settings.map((setting) => {
                    const Icon = setting.icon;
                    // Map light-mode colors to dark-mode equivalents
                    const darkColorMap: Record<string, { text: string; bg: string }> = {
                        'text-blue-600': { text: 'text-blue-400', bg: 'bg-blue-500/20' },
                        'text-green-600': { text: 'text-emerald-400', bg: 'bg-emerald-500/20' },
                        'text-amber-600': { text: 'text-amber-400', bg: 'bg-amber-500/20' },
                        'text-purple-600': { text: 'text-purple-400', bg: 'bg-purple-500/20' },
                    };
                    const darkColors = darkColorMap[setting.color] || { text: 'text-slate-400', bg: 'bg-slate-500/20' };
                    return (
                        <button
                            key={setting.id}
                            onClick={() => toggleSetting(setting.id)}
                            className="w-full flex items-center justify-between p-4 text-left active:bg-white/5 transition-colors"
                        >
                            <div className="flex items-center gap-3">
                                <div className={`p-2 rounded-xl ${darkColors.bg}`}>
                                    <Icon size={20} className={darkColors.text} />
                                </div>
                                <div>
                                    <p className="font-medium text-white">{setting.label}</p>
                                    <p className="text-sm text-slate-400">{setting.description}</p>
                                </div>
                            </div>
                            <div className={`w-11 h-6 rounded-full transition-colors relative ${setting.enabled ? 'bg-indigo-600' : 'bg-slate-600'
                                }`}>
                                <div className={`w-5 h-5 bg-white rounded-full shadow-md absolute top-0.5 transition-all ${setting.enabled ? 'right-0.5' : 'left-0.5'
                                    }`} />
                            </div>
                        </button>
                    );
                })}
            </div>

            {/* Info */}
            <p className="text-sm text-slate-500 text-center px-4">
                Notification settings are synced across all your devices.
            </p>
        </div>
    );
}
