import { useState } from 'react';
import { Logger } from '../../utils/logger';
import { getPublicApiUrl } from '../../utils/url';
import { Copy, Check, Info, Monitor, RefreshCw, AlertCircle, Zap, Store, ExternalLink } from 'lucide-react';
import { useAccount } from '../../context/AccountContext';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../services/api';

// Type for store verification response
interface StoreVerificationResult {
    success: boolean;
    storeUrl?: string;
    storeName?: string;
    storeReachable: boolean;
    pluginInstalled: boolean;
    pluginVersion?: string;
    configured?: boolean;
    accountMatch?: boolean;
    trackingEnabled?: boolean;
    chatEnabled?: boolean;
    woocommerceActive?: boolean;
    woocommerceVersion?: string;
    error?: string;
}

export function TrackingScriptHelper() {
    const { currentAccount } = useAccount();
    const { token } = useAuth();
    const [copied, setCopied] = useState(false);

    // Status Check State
    const [checkStatus, setCheckStatus] = useState<'idle' | 'loading' | 'connected' | 'inactive' | 'error'>('idle');
    const [lastSignal, setLastSignal] = useState<string | null>(null);

    // Test Event State
    const [testStatus, setTestStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');

    // Store Verification State
    const [storeStatus, setStoreStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
    const [storeResult, setStoreResult] = useState<StoreVerificationResult | null>(null);

    // Internal API URL for direct requests (may be Docker container name)
    const apiUrl = import.meta.env.VITE_API_URL || window.location.origin;

    // Public API URL for external clients (derived from browser location)
    const publicApiUrl = getPublicApiUrl();

    const sendTestEvent = async () => {
        setTestStatus('loading');
        try {
            // Generate a test visitor ID
            const testVisitorId = `test-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

            // Send a test pageview event directly to the tracking endpoint
            await fetch(`${apiUrl}/api/tracking/events`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    accountId: currentAccount?.id,
                    visitorId: testVisitorId,
                    type: 'pageview',
                    url: 'https://test.overseek.internal/diagnostic-check',
                    pageTitle: 'OverSeek Connection Test',
                    payload: { source: 'dashboard-diagnostic', timestamp: new Date().toISOString() }
                })
            });

            setTestStatus('success');

            // After sending test event, check connection status
            setTimeout(() => {
                checkConnection();
            }, 1000);
        } catch (error) {
            Logger.error('Test Event Failed:', { error: error });
            setTestStatus('error');
        }
    };

    const checkConnection = async () => {
        setCheckStatus('loading');
        try {
            // Using the api helper which expects: (endpoint, token, accountId)
            // It returns the data directly, not { data }
            const result = await api.get<{ connected: boolean; lastSignal: string | null }>(
                '/api/tracking/status',
                token || undefined,
                currentAccount?.id || ''
            );

            if (result.connected) {
                setCheckStatus('connected');
                setLastSignal(result.lastSignal);
            } else {
                setCheckStatus('inactive');
                setLastSignal(null);
            }
        } catch (error) {
            Logger.error('Connection Check Failed:', { error: error });
            setCheckStatus('error');
        }
    };

    const verifyStore = async () => {
        setStoreStatus('loading');
        setStoreResult(null);
        try {
            const result = await api.get<StoreVerificationResult>(
                '/api/tracking/verify-store',
                token || undefined,
                currentAccount?.id || ''
            );

            setStoreResult(result);
            setStoreStatus(result.success ? 'success' : 'error');
        } catch (error) {
            Logger.error('Store Verification Failed:', { error: error });
            setStoreStatus('error');
            setStoreResult({
                success: false,
                storeReachable: false,
                pluginInstalled: false,
                error: 'Failed to verify store connection'
            });
        }
    };

    // We'll use a "loader" pattern where they copy a snippet that loads our tracking.js from the server.
    // OR we provide the full inline script as described in the plan.


    const [configCopied, setConfigCopied] = useState(false);

    const connectionConfig = JSON.stringify({
        apiUrl: publicApiUrl,
        accountId: currentAccount?.id || ''
    }, null, 2);

    const handleCopyConfig = () => {
        navigator.clipboard.writeText(connectionConfig);
        setConfigCopied(true);
        setTimeout(() => setConfigCopied(false), 2000);
    };

    return (
        <div className="space-y-8">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex gap-3">
                <Info className="shrink-0 w-5 h-5 text-blue-600 mt-0.5" />
                <div className="text-sm text-blue-800">
                    <p className="font-medium mb-1">WooCommerce Plugin Setup</p>
                    <p>To enable Live View and abandoned cart tracking, install the OverSeek plugin and paste the configuration below.</p>
                    <div className="mt-3">
                        <a
                            href={`${publicApiUrl}/uploads/plugins/overseek-wc-plugin.zip`}
                            download
                            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 transition-colors"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" x2="12" y1="15" y2="3" /></svg>
                            Download Plugin
                        </a>
                    </div>
                </div>
            </div>

            <div className="space-y-3">
                <div className="flex items-center justify-between">
                    <label className="block text-sm font-medium text-gray-700">Connection Configuration (JSON)</label>
                    <span className="text-xs text-gray-500">Paste this into the plugin settings</span>
                </div>
                <div className="relative group">
                    <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                            onClick={handleCopyConfig}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors shadow-xs ${configCopied
                                ? 'bg-green-100 text-green-700 border border-green-200'
                                : 'bg-white text-gray-700 hover:bg-gray-50 border border-gray-200'
                                }`}
                        >
                            {configCopied ? <Check size={14} /> : <Copy size={14} />}
                            {configCopied ? 'Copied' : 'Copy'}
                        </button>
                    </div>
                    <pre className="bg-slate-950 text-slate-50 p-4 rounded-lg overflow-x-auto font-mono text-sm leading-relaxed border border-slate-800 shadow-xs relative">
                        <code>{connectionConfig || 'Loading configuration...'}</code>
                    </pre>
                </div>
            </div>

            {/* Status Checker */}
            <div className="border-t border-gray-100 pt-6">
                <h3 className="text-sm font-medium text-gray-900 mb-3 flex items-center gap-2">
                    <Monitor size={16} className="text-gray-500" />
                    Connection Diagnosis
                </h3>

                <div className="bg-gray-50 rounded-lg p-4 border border-gray-200 space-y-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm text-gray-700 font-medium">Verify Installation</p>
                            <p className="text-xs text-gray-500 mt-1">Check if OverSeek is receiving data from your store.</p>
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={sendTestEvent}
                                disabled={testStatus === 'loading'}
                                className="flex items-center gap-2 px-3 py-1.5 bg-purple-600 text-white rounded-md text-sm hover:bg-purple-700 disabled:opacity-50 transition-colors shadow-xs"
                            >
                                <Zap size={14} className={testStatus === 'loading' ? 'animate-pulse' : ''} />
                                {testStatus === 'loading' ? 'Sending...' : 'Send Test Event'}
                            </button>
                            <button
                                onClick={checkConnection}
                                disabled={checkStatus === 'loading'}
                                className="flex items-center gap-2 px-3 py-1.5 bg-white border border-gray-300 text-gray-700 rounded-md text-sm hover:bg-gray-50 disabled:opacity-50 transition-colors shadow-xs"
                            >
                                <RefreshCw size={14} className={checkStatus === 'loading' ? 'animate-spin' : ''} />
                                Check Status
                            </button>
                        </div>
                    </div>

                    {/* Test Event Feedback */}
                    {testStatus === 'success' && (
                        <div className="p-3 rounded-md text-sm border bg-purple-50 border-purple-200 text-purple-800 flex items-start gap-3">
                            <Zap className="w-5 h-5 text-purple-600 shrink-0" />
                            <div>
                                <p className="font-semibold">Test Event Sent!</p>
                                <p className="mt-1 opacity-90">A test pageview was sent directly to your analytics. Checking connection status...</p>
                            </div>
                        </div>
                    )}

                    {testStatus === 'error' && (
                        <div className="p-3 rounded-md text-sm border bg-red-50 border-red-200 text-red-800 flex items-start gap-3">
                            <AlertCircle className="w-5 h-5 text-red-600 shrink-0" />
                            <div>
                                <p className="font-semibold">Test Event Failed</p>
                                <p className="mt-1 opacity-90">Could not send test event. Check your network connection.</p>
                            </div>
                        </div>
                    )}

                    {/* Status Feedback */}
                    {checkStatus !== 'idle' && (
                        <div className={`p-3 rounded-md text-sm border flex items-start gap-3 ${checkStatus === 'connected' ? 'bg-green-50 border-green-200 text-green-800' :
                            checkStatus === 'inactive' ? 'bg-amber-50 border-amber-200 text-amber-800' :
                                'bg-red-50 border-red-200 text-red-800'
                            }`}>
                            {checkStatus === 'connected' && <Check className="w-5 h-5 text-green-600 shrink-0" />}
                            {checkStatus === 'inactive' && <AlertCircle className="w-5 h-5 text-amber-600 shrink-0" />}
                            {checkStatus === 'error' && <AlertCircle className="w-5 h-5 text-red-600 shrink-0" />}

                            <div>
                                <p className="font-semibold">
                                    {checkStatus === 'connected' ? 'Connection Active' :
                                        checkStatus === 'inactive' ? 'No Recent Activity' : 'Connection Error'}
                                </p>
                                <p className="mt-1 opacity-90">
                                    {checkStatus === 'connected' ? (
                                        <>We received a signal from your store. Last activity: <span className="font-mono">{new Date(lastSignal!).toLocaleString()}</span></>
                                    ) : checkStatus === 'inactive' ? (
                                        <>No events received yet. Click <strong>"Send Test Event"</strong> to verify the connection, or visit your store with the plugin installed.</>
                                    ) : (
                                        "Could not check status. Ensure your internet is connected."
                                    )}
                                </p>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Store Plugin Verification */}
            <div className="border-t border-gray-100 pt-6">
                <h3 className="text-sm font-medium text-gray-900 mb-3 flex items-center gap-2">
                    <Store size={16} className="text-gray-500" />
                    Store Plugin Verification
                </h3>

                <div className="bg-gray-50 rounded-lg p-4 border border-gray-200 space-y-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm text-gray-700 font-medium">Verify WooCommerce Plugin</p>
                            <p className="text-xs text-gray-500 mt-1">Check if the OverSeek plugin is installed and configured on your store.</p>
                        </div>
                        <button
                            onClick={verifyStore}
                            disabled={storeStatus === 'loading'}
                            className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700 disabled:opacity-50 transition-colors shadow-xs"
                        >
                            <Store size={14} className={storeStatus === 'loading' ? 'animate-pulse' : ''} />
                            {storeStatus === 'loading' ? 'Verifying...' : 'Verify Store Plugin'}
                        </button>
                    </div>

                    {/* Store Verification Result */}
                    {storeResult && (
                        <div className={`p-4 rounded-md text-sm border ${storeResult.success ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'
                            }`}>
                            <div className="flex items-start gap-3">
                                {storeResult.success ? (
                                    <Check className="w-5 h-5 text-green-600 shrink-0 mt-0.5" />
                                ) : (
                                    <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                                )}
                                <div className="flex-1 space-y-2">
                                    <p className={`font-semibold ${storeResult.success ? 'text-green-800' : 'text-amber-800'}`}>
                                        {storeResult.success ? 'Plugin Verified!' : 'Plugin Issue Detected'}
                                    </p>

                                    {storeResult.storeUrl && (
                                        <p className="text-gray-700 text-xs flex items-center gap-1">
                                            Store: <a href={storeResult.storeUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline flex items-center gap-1">
                                                {storeResult.storeUrl} <ExternalLink size={10} />
                                            </a>
                                        </p>
                                    )}

                                    {storeResult.error && (
                                        <p className="text-amber-700">{storeResult.error}</p>
                                    )}

                                    {storeResult.success && (
                                        <div className="grid grid-cols-2 gap-2 mt-3 text-xs">
                                            <div className="flex items-center gap-2">
                                                <span className={`w-2 h-2 rounded-full ${storeResult.pluginInstalled ? 'bg-green-500' : 'bg-red-500'}`}></span>
                                                Plugin: {storeResult.pluginVersion || 'Installed'}
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <span className={`w-2 h-2 rounded-full ${storeResult.configured ? 'bg-green-500' : 'bg-amber-500'}`}></span>
                                                Configured: {storeResult.configured ? 'Yes' : 'No'}
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <span className={`w-2 h-2 rounded-full ${storeResult.trackingEnabled ? 'bg-green-500' : 'bg-amber-500'}`}></span>
                                                Tracking: {storeResult.trackingEnabled ? 'Enabled' : 'Disabled'}
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <span className={`w-2 h-2 rounded-full ${storeResult.accountMatch ? 'bg-green-500' : 'bg-red-500'}`}></span>
                                                Account Match: {storeResult.accountMatch ? 'Yes' : 'No'}
                                            </div>
                                            {storeResult.woocommerceVersion && (
                                                <div className="flex items-center gap-2 col-span-2">
                                                    <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                                                    WooCommerce: v{storeResult.woocommerceVersion}
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {!storeResult.pluginInstalled && storeResult.storeReachable && (
                                        <p className="text-xs text-amber-700 mt-2">
                                            Your store is reachable but the OverSeek plugin is not detected. Please install and activate the plugin.
                                        </p>
                                    )}

                                    {!storeResult.storeReachable && (
                                        <p className="text-xs text-amber-700 mt-2">
                                            Could not reach your store. Ensure the store URL is correct and the site is online.
                                        </p>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
