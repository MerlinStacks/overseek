import { useEffect, useRef, useState } from 'react';
import { Bell, BellOff, MessageSquare, ShoppingCart, Loader2, Smartphone, Send, CheckCircle, XCircle } from 'lucide-react';
import { usePushNotifications } from '../../hooks/usePushNotifications';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';

/**
 * Settings panel for configuring push notifications.
 * 
 * Allows users to enable/disable push notifications and configure
 * which notification types they want to receive.
 */
export function NotificationSettings() {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    // Remount both the panel and its device-subscription hook when the auth scope changes.
    return <NotificationSettingsPanel key={JSON.stringify([currentAccount?.id, token])} />;
}

function NotificationSettingsPanel() {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const {
        isSupported,
        isSubscribed,
        isLoading,
        preferences,
        permissionState,
        subscribe,
        unsubscribe,
        updatePreferences
    } = usePushNotifications();

    const [testStatus, setTestStatus] = useState<'idle' | 'sending' | 'success' | 'error'>('idle');
    const [testError, setTestError] = useState<string | null>(null);
    const [testSummary, setTestSummary] = useState('');
    const [actionError, setActionError] = useState<string | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const active = useRef(false);
    const pending = useRef(false);
    const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const testRequest = useRef<AbortController | null>(null);

    useEffect(() => {
        active.current = true;
        return () => {
            active.current = false;
            clearTimeout(timer.current);
            testRequest.current?.abort();
        };
    }, []);

    const saveChange = async (change: () => Promise<boolean>, errorMessage: string) => {
        if (pending.current || isLoading) return;
        pending.current = true;
        setIsSaving(true);
        setActionError(null);
        try {
            const saved = await change();
            if (!saved && active.current) setActionError(errorMessage);
        } catch {
            if (active.current) setActionError(errorMessage);
        } finally {
            if (active.current) { pending.current = false; setIsSaving(false); }
        }
    };

    const handleToggle = async () => {
        await saveChange(isSubscribed ? unsubscribe : subscribe,
            isSubscribed ? 'Could not disable notifications. Please try again.' : 'Could not enable notifications. Check browser permissions and try again.');
    };

    /**
     * Sends a test push notification to verify the setup is working.
     */
    const handleTestNotification = async () => {
        if (pending.current || isLoading) return;
        if (!token || !currentAccount) {
            setTestError('Authentication required');
            setTestStatus('error');
            return;
        }

        pending.current = true;
        clearTimeout(timer.current);
        const controller = new AbortController();
        testRequest.current = controller;
        setTestStatus('sending');
        setTestError(null);

        try {
            const res = await fetch('/api/notifications/push/test', {
                method: 'POST',
                signal: controller.signal,
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount.id
                }
            });

            const data = await res.json().catch(() => ({}));
            if (!res.ok || data.success !== true || !Number.isFinite(data.sent) || data.sent <= 0) {
                throw new Error(data.error || 'Failed to send test notification');
            }

            if (!active.current) return;
            setTestSummary(`Test push accepted for ${data.sent} subscription(s).${data.failed > 0 ? ` ${data.failed} subscription(s) failed.` : ''} Delivery on this device is not guaranteed.`);
            setTestStatus('success');
            // Reset after 3 seconds
            timer.current = setTimeout(() => setTestStatus('idle'), 3000);
        } catch (error) {
            if (!active.current || controller.signal.aborted) return;
            setTestError(error instanceof Error ? error.message : 'Failed to send test');
            setTestStatus('error');
            // Reset after 5 seconds
            timer.current = setTimeout(() => {
                setTestStatus('idle');
                setTestError(null);
            }, 5000);
        } finally {
            if (active.current) pending.current = false;
        }
    };

    if (!isSupported) {
        return (
            <div className="bg-white rounded-xl shadow-xs border border-gray-200 p-6">
                <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center">
                        <BellOff className="w-5 h-5 text-gray-400" />
                    </div>
                    <div>
                        <h3 className="font-medium text-gray-900">Push Notifications Not Supported</h3>
                        <p className="text-sm text-gray-500">Your browser doesn't support push notifications</p>
                    </div>
                </div>
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800">
                    <p className="font-medium mb-1">Try these options:</p>
                    <ul className="list-disc list-inside space-y-1">
                        <li>Use Chrome, Firefox, or Safari (iOS 16.4+)</li>
                        <li>On iOS, add this site to your Home Screen</li>
                        <li>Make sure you're using HTTPS</li>
                    </ul>
                </div>
            </div>
        );
    }

    return (
        <div className="bg-white rounded-xl shadow-xs border border-gray-200 overflow-hidden">
            <div className="p-6 border-b border-gray-200">
                <h2 className="text-lg font-medium text-gray-900">Push Notifications</h2>
                <p className="text-sm text-gray-500 mt-1">
                    Receive notifications on your phone when new messages or orders arrive
                </p>
            </div>

            <div className="p-6 space-y-6">
                {actionError && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{actionError}</p>}
                {/* Main Toggle */}
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${isSubscribed ? 'bg-blue-100' : 'bg-gray-100'
                            }`}>
                            {isSubscribed ? (
                                <Bell className="w-5 h-5 text-blue-600" />
                            ) : (
                                <BellOff className="w-5 h-5 text-gray-400" />
                            )}
                        </div>
                        <div>
                            <p className="font-medium text-gray-900">
                                {isSubscribed ? 'Notifications Enabled' : 'Notifications Disabled'}
                            </p>
                            <p className="text-sm text-gray-500">
                                {isSubscribed
                                    ? 'You will receive push notifications on this device'
                                    : 'Enable to receive notifications on this device'
                                }
                            </p>
                        </div>
                    </div>
                    <button
                        type="button" aria-label={isSubscribed ? 'Disable push notifications' : 'Enable push notifications'}
                        onClick={handleToggle}
                        disabled={isLoading || isSaving || testStatus === 'sending' || (!isSubscribed && permissionState === 'denied')}
                        className={`px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2 ${isSubscribed
                            ? 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                            : 'bg-blue-600 text-white hover:bg-blue-700'
                            } disabled:opacity-50`}
                    >
                        {isLoading || isSaving ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                        ) : isSubscribed ? (
                            <>
                                <BellOff className="w-4 h-4" />
                                Disable
                            </>
                        ) : (
                            <>
                                <Bell className="w-4 h-4" />
                                Enable
                            </>
                        )}
                    </button>
                </div>

                {/* Permission Warning */}
                {permissionState === 'denied' && (
                    <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-800">
                        <p className="font-medium mb-1">Notifications Blocked</p>
                        <p>You've blocked notifications for this site. To enable them:</p>
                        <ol className="list-decimal list-inside mt-2 space-y-1">
                            <li>Click the lock icon in your browser's address bar</li>
                            <li>Find "Notifications" and change it to "Allow"</li>
                            <li>Refresh the page</li>
                        </ol>
                    </div>
                )}

                {/* Preference Toggles */}
                {isSubscribed && (
                    <div className="border-t border-gray-200 pt-6 space-y-4">
                        <h3 className="text-sm font-medium text-gray-900 uppercase tracking-wide">
                            Notification Types
                        </h3>

                        {/* New Messages */}
                        <label className="flex items-center justify-between p-4 bg-gray-50 rounded-lg cursor-pointer hover:bg-gray-100 transition-colors">
                            <div className="flex items-center gap-3">
                                <MessageSquare className="w-5 h-5 text-blue-600" />
                                <div>
                                    <p className="font-medium text-gray-900">New Messages</p>
                                    <p className="text-sm text-gray-500">
                                        Get notified when customers send messages
                                    </p>
                                </div>
                            </div>
                            <input
                                type="checkbox"
                                disabled={isLoading || isSaving || testStatus === 'sending'}
                                checked={preferences.notifyNewMessages}
                                onChange={(e) => { const checked = e.target.checked; void saveChange(() => updatePreferences({ notifyNewMessages: checked }), 'Could not save notification preferences. Please try again.'); }}
                                className="w-5 h-5 rounded-sm border-gray-300 text-blue-600 focus:ring-blue-500"
                            />
                        </label>

                        {/* New Orders */}
                        <label className="flex items-center justify-between p-4 bg-gray-50 rounded-lg cursor-pointer hover:bg-gray-100 transition-colors">
                            <div className="flex items-center gap-3">
                                <ShoppingCart className="w-5 h-5 text-green-600" />
                                <div>
                                    <p className="font-medium text-gray-900">New Orders</p>
                                    <p className="text-sm text-gray-500">
                                        Get notified when new orders are placed
                                    </p>
                                </div>
                            </div>
                            <input
                                type="checkbox"
                                disabled={isLoading || isSaving || testStatus === 'sending'}
                                checked={preferences.notifyNewOrders}
                                onChange={(e) => { const checked = e.target.checked; void saveChange(() => updatePreferences({ notifyNewOrders: checked }), 'Could not save notification preferences. Please try again.'); }}
                                className="w-5 h-5 rounded-sm border-gray-300 text-green-600 focus:ring-green-500"
                            />
                        </label>
                    </div>
                )}

                {/* Test Notification */}
                {isSubscribed && (
                    <div className="border-t border-gray-200 pt-6">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${testStatus === 'success' ? 'bg-green-100' :
                                    testStatus === 'error' ? 'bg-red-100' :
                                        'bg-purple-100'
                                    }`}>
                                    {testStatus === 'success' ? (
                                        <CheckCircle className="w-5 h-5 text-green-600" />
                                    ) : testStatus === 'error' ? (
                                        <XCircle className="w-5 h-5 text-red-600" />
                                    ) : (
                                        <Send className="w-5 h-5 text-purple-600" />
                                    )}
                                </div>
                                <div>
                                    <p className="font-medium text-gray-900">Test Notification</p>
                                    <p role={testStatus === 'error' ? 'alert' : 'status'} className="text-sm text-gray-500">
                                        {testStatus === 'success'
                                            ? testSummary
                                            : testStatus === 'error'
                                                ? testError || 'Failed to send notification'
                                                : 'Send a test to verify notifications work'}
                                    </p>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={handleTestNotification}
                                disabled={testStatus === 'sending' || isSaving || isLoading}
                                className="px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2 bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50"
                            >
                                {testStatus === 'sending' ? (
                                    <>
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        Sending...
                                    </>
                                ) : (
                                    <>
                                        <Send className="w-4 h-4" />
                                        Send Test
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                )}

                {/* Mobile Tip */}
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-800">
                    <div className="flex items-start gap-3">
                        <Smartphone className="w-5 h-5 mt-0.5 shrink-0" />
                        <div>
                            <p className="font-medium mb-1">Mobile App Experience</p>
                            <p>
                                For the best experience on mobile, add this site to your home screen.
                                You'll get native push notifications just like a regular app!
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
