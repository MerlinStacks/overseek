import { useState } from 'react';
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

    const handleToggle = async () => {
        if (isSubscribed) {
            await unsubscribe();
        } else {
            await subscribe();
        }
    };

    /**
     * Sends a test push notification to verify the setup is working.
     */
    const handleTestNotification = async () => {
        if (!token || !currentAccount) {
            setTestError('Authentication required');
            setTestStatus('error');
            return;
        }

        setTestStatus('sending');
        setTestError(null);

        try {
            const res = await fetch('/api/notifications/push/test', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount.id
                }
            });

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || 'Failed to send test notification');
            }

            setTestStatus('success');
            // Reset after 3 seconds
            setTimeout(() => setTestStatus('idle'), 3000);
        } catch (error) {
            setTestError(error instanceof Error ? error.message : 'Failed to send test');
            setTestStatus('error');
            // Reset after 5 seconds
            setTimeout(() => {
                setTestStatus('idle');
                setTestError(null);
            }, 5000);
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
                        onClick={handleToggle}
                        disabled={isLoading}
                        className={`px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2 ${isSubscribed
                            ? 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                            : 'bg-blue-600 text-white hover:bg-blue-700'
                            } disabled:opacity-50`}
                    >
                        {isLoading ? (
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
                                checked={preferences.notifyNewMessages}
                                onChange={(e) => updatePreferences({ notifyNewMessages: e.target.checked })}
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
                                checked={preferences.notifyNewOrders}
                                onChange={(e) => updatePreferences({ notifyNewOrders: e.target.checked })}
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
                                    <p className="text-sm text-gray-500">
                                        {testStatus === 'success'
                                            ? 'Notification sent successfully!'
                                            : testStatus === 'error'
                                                ? testError || 'Failed to send notification'
                                                : 'Send a test to verify notifications work'}
                                    </p>
                                </div>
                            </div>
                            <button
                                onClick={handleTestNotification}
                                disabled={testStatus === 'sending'}
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
