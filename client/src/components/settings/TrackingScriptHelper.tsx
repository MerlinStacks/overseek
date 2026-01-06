
import { useState } from 'react';
import { Copy, Check, Info } from 'lucide-react';
import { useAccount } from '../../context/AccountContext';

export function TrackingScriptHelper() {
    const { currentAccount } = useAccount();
    const [copied, setCopied] = useState(false);

    // In a real scenario, this URL would be dynamic based on the app deployment.
    // For now we assume window.location.origin, or a fixed configured value.
    // Since we are running the tracking script from the same backend usually, 
    // we can use the API URL. But the script itself is usually served statically or we provide the code inline.
    // The plan said: provide a JS snippet.

    // We'll use a "loader" pattern where they copy a snippet that loads our tracking.js from the server.
    // OR we provide the full inline script as described in the plan.


    const [configCopied, setConfigCopied] = useState(false);

    // Get the base API URL (e.g. https://api.overseek.com or the current domain)
    // In development we might want to hardcode or detect.
    // Assuming the client is served from the same domain hierarchy or we use window.location.origin
    // BUT for the plugin we need the API server URL.
    // If we are in dev `localhost:5173`, the api is `localhost:5000`.
    // Let's assume production for now or use a clearer ENV.
    const apiUrl = import.meta.env.VITE_API_URL || window.location.origin;

    const connectionConfig = JSON.stringify({
        apiUrl: apiUrl,
        accountId: currentAccount.id
    }, null, 2);

    const handleCopyConfig = () => {
        navigator.clipboard.writeText(connectionConfig);
        setConfigCopied(true);
        setTimeout(() => setConfigCopied(false), 2000);
    };

    return (
        <div className="space-y-6">
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

            <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700">Connection Configuration (JSON)</label>
                <div className="relative">
                    <div className="absolute top-3 right-3">
                        <button
                            onClick={handleCopyConfig}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${configCopied
                                ? 'bg-green-100 text-green-700'
                                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                }`}
                        >
                            {configCopied ? <Check size={16} /> : <Copy size={16} />}
                            {configCopied ? 'Copied!' : 'Copy Config'}
                        </button>
                    </div>
                    <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg overflow-x-auto font-mono text-sm leading-relaxed border border-gray-700">
                        {connectionConfig}
                    </pre>
                </div>
                <p className="text-sm text-gray-500">
                    Paste this entire block into the "Connection Config" field in your WooCommerce plugin settings.
                </p>
            </div>
        </div>
    );
}
