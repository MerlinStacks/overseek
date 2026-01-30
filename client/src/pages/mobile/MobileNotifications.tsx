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
        <div className="min-h-screen bg-gray-50">
            {/* Header */}
            <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3 sticky top-0 z-10">
                <button
                    onClick={() => navigate('/m/more')}
                    className="p-2 -ml-2 rounded-full hover:bg-gray-100 active:bg-gray-200"
                >
                    <ArrowLeft size={24} />
                </button>
                <h1 className="text-lg font-bold text-gray-900">Notifications</h1>
            </header>

            <div className="p-4 space-y-4">
                {/* iOS Not-Installed Warning - only show if not in native app */}
                {isIOS && !isStandalone && !isCapacitorNative && !isSupported && (
                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                        <p className="font-medium text-amber-800">Add to Home Screen Required</p>
                        <p className="text-sm text-amber-700 mt-1">
                            To enable push notifications on iOS, add this app to your Home Screen:
                        </p>
                        <ol className="text-sm text-amber-700 mt-2 list-decimal ml-4 space-y-1">
                            <li>Tap the Share button</li>
                            <li>Select "Add to Home Screen"</li>
                            <li>Open the app from your Home Screen</li>
                        </ol>
                    </div>
                )}

                {/* Push Notifications Master Toggle */}
                <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="p-2.5 bg-indigo-100 rounded-xl">
                                <Bell size={22} className="text-indigo-600" />
                            </div>
                            <div>
                                <p className="font-semibold text-gray-900">Push Notifications</p>
                                <p className="text-sm text-gray-500">
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
                            className={`w-14 h-8 rounded-full transition-colors relative ${isSubscribed ? 'bg-indigo-600' : 'bg-gray-300'
                                } ${!isSupported ? 'opacity-50' : ''}`}
                        >
                            <div className={`w-6 h-6 bg-white rounded-full shadow-md absolute top-1 transition-all ${isSubscribed ? 'right-1' : 'left-1'
                                }`} />
                        </button>
                    </div>
                </div>

                {/* Test Notification Buttons */}
                {isSubscribed && (
                    <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 space-y-3">
                        <button
                            onClick={sendTestNotification}
                            disabled={testLoading}
                            className="w-full py-3 px-4 bg-indigo-50 text-indigo-600 font-semibold rounded-xl active:bg-indigo-100 disabled:opacity-50"
                        >
                            {testLoading ? 'Sending...' : '🔔 Send Test Notification'}
                        </button>
                        <button
                            onClick={sendTestOrderNotification}
                            disabled={orderTestLoading}
                            className="w-full py-3 px-4 bg-blue-50 text-blue-600 font-semibold rounded-xl active:bg-blue-100 disabled:opacity-50"
                        >
                            {orderTestLoading ? 'Sending...' : '🛒 Test Order Notification'}
                        </button>
                        {testResult && (
                            <p className="text-sm text-center mt-2 text-gray-600">{testResult}</p>
                        )}
                    </div>
                )}


                {/* Notification Types */}
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 divide-y divide-gray-100">
                    {settings.map((setting) => {
                        const Icon = setting.icon;
                        return (
                            <button
                                key={setting.id}
                                onClick={() => toggleSetting(setting.id)}
                                className="w-full flex items-center justify-between p-4 text-left active:bg-gray-50"
                            >
                                <div className="flex items-center gap-3">
                                    <div className={`p-2 rounded-xl bg-gray-100`}>
                                        <Icon size={20} className={setting.color} />
                                    </div>
                                    <div>
                                        <p className="font-medium text-gray-900">{setting.label}</p>
                                        <p className="text-sm text-gray-500">{setting.description}</p>
                                    </div>
                                </div>
                                <div className={`w-11 h-6 rounded-full transition-colors relative ${setting.enabled ? 'bg-indigo-600' : 'bg-gray-300'
                                    }`}>
                                    <div className={`w-5 h-5 bg-white rounded-full shadow-md absolute top-0.5 transition-all ${setting.enabled ? 'right-0.5' : 'left-0.5'
                                        }`} />
                                </div>
                            </button>
                        );
                    })}
                </div>

                {/* Info */}
                <p className="text-sm text-gray-500 text-center px-4">
                    Notification settings are synced across all your devices.
                </p>
            </div>
        </div>
    );
}
