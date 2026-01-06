import { useState } from 'react';
import { Copy, Check, Info, Monitor, RefreshCw, AlertCircle } from 'lucide-react';
import { useAccount } from '../../context/AccountContext';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../services/api';

export function TrackingScriptHelper() {
    const { currentAccount } = useAccount();
    const { token } = useAuth();
    const [copied, setCopied] = useState(false);

    // Status Check State
    const [checkStatus, setCheckStatus] = useState<'idle' | 'loading' | 'connected' | 'inactive' | 'error'>('idle');
    const [lastSignal, setLastSignal] = useState<string | null>(null);

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
            console.error('Connection Check Failed:', error);
            setCheckStatus('error');
        }
    };

    // We'll use a "loader" pattern where they copy a snippet that loads our tracking.js from the server.
    // OR we provide the full inline script as described in the plan.


    const [configCopied, setConfigCopied] = useState(false);

    // Get the base API URL (e.g. https://api.overseek.com or the current domain)
    const apiUrl = import.meta.env.VITE_API_URL || window.location.origin;

    const connectionConfig = JSON.stringify({
        apiUrl: apiUrl,
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
                <Info className="flex-shrink-0 w-5 h-5 text-blue-600 mt-0.5" />
                <div className="text-sm text-blue-800">
                    <p className="font-medium mb-1">WooCommerce Plugin Setup</p>
                    <p>To enable Live View and abandoned cart tracking, install the OverSeek plugin and paste the configuration below.</p>
                    <div className="mt-3">
                        <a
                            href={`${apiUrl}/uploads/plugins/overseek-wc-plugin.zip`}
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
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors shadow-sm ${configCopied
                                ? 'bg-green-100 text-green-700 border border-green-200'
                                : 'bg-white text-gray-700 hover:bg-gray-50 border border-gray-200'
                                }`}
                        >
                            {configCopied ? <Check size={14} /> : <Copy size={14} />}
                            {configCopied ? 'Copied' : 'Copy'}
                        </button>
                    </div>
                    <pre className="bg-slate-950 text-slate-50 p-4 rounded-lg overflow-x-auto font-mono text-sm leading-relaxed border border-slate-800 shadow-sm relative">
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

                <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm text-gray-700 font-medium">Verify Installation</p>
                            <p className="text-xs text-gray-500 mt-1">Check if OverSeek is receiving data from your store.</p>
                        </div>
                        <button
                            onClick={checkConnection}
                            disabled={checkStatus === 'loading'}
                            className="flex items-center gap-2 px-3 py-1.5 bg-white border border-gray-300 text-gray-700 rounded-md text-sm hover:bg-gray-50 disabled:opacity-50 transition-colors shadow-sm"
                        >
                            <RefreshCw size={14} className={checkStatus === 'loading' ? 'animate-spin' : ''} />
                            Check Status
                        </button>
                    </div>

                    {/* Status Feedback */}
                    {checkStatus !== 'idle' && (
                        <div className={`mt-4 p-3 rounded-md text-sm border flex items-start gap-3 ${checkStatus === 'connected' ? 'bg-green-50 border-green-200 text-green-800' :
                            checkStatus === 'inactive' ? 'bg-amber-50 border-amber-200 text-amber-800' :
                                'bg-red-50 border-red-200 text-red-800'
                            }`}>
                            {checkStatus === 'connected' && <Check className="w-5 h-5 text-green-600 flex-shrink-0" />}
                            {checkStatus === 'inactive' && <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0" />}
                            {checkStatus === 'error' && <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0" />}

                            <div>
                                <p className="font-semibold">
                                    {checkStatus === 'connected' ? 'Connection Active' :
                                        checkStatus === 'inactive' ? 'No Recent Activity' : 'Connection Error'}
                                </p>
                                <p className="mt-1 opacity-90">
                                    {checkStatus === 'connected' ? (
                                        <>We received a signal from your store. Last activity: <span className="font-mono">{new Date(lastSignal!).toLocaleString()}</span></>
                                    ) : checkStatus === 'inactive' ? (
                                        "We haven't received any events yet. Try visiting your store in a new tab to trigger a pageview."
                                    ) : (
                                        "Could not check status. Ensure your internet is connected."
                                    )}
                                </p>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
