
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

    const apiUrl = window.location.origin; // e.g. https://overseek.plateit.au or http://localhost:5173

    const scriptCode = `
<!-- OverSeek Analytics Tracking -->
<script>
(function(w,d,s,id){
  w.OverSeek=w.OverSeek||function(){(w.OverSeek.q=w.OverSeek.q||[]).push(arguments)};
  var f=d.getElementsByTagName(s)[0],j=d.createElement(s);
  j.async=true;j.src='${apiUrl}/api/tracking/tracking.js?id='+id;
  f.parentNode.insertBefore(j,f);
})(window,document,'script','${currentAccount?.id || 'YOUR_ACCOUNT_ID'}');
</script>
<!-- End OverSeek Analytics -->
    `.trim();

    const handleCopy = () => {
        navigator.clipboard.writeText(scriptCode);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="space-y-4">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex gap-3">
                <Info className="flex-shrink-0 w-5 h-5 text-blue-600 mt-0.5" />
                <div className="text-sm text-blue-800">
                    <p className="font-medium mb-1">Installation Required</p>
                    <p>To enable Live View and abandoned cart tracking, you must install the official OverSeek WooCommerce plugin.</p>
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

            <div className="relative">
                <div className="absolute top-3 right-3">
                    <button
                        onClick={handleCopy}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${copied
                            ? 'bg-green-100 text-green-700'
                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                            }`}
                    >
                        {copied ? <Check size={16} /> : <Copy size={16} />}
                        {copied ? 'Copied!' : 'Copy Code'}
                    </button>
                </div>
                <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg overflow-x-auto font-mono text-sm leading-relaxed border border-gray-700">
                    {scriptCode}
                </pre>
            </div>

            <div className="text-sm text-gray-500">
                <p>This script is optimized for performance and will not slow down your site. It loads asynchronously.</p>
            </div>
        </div>
    );
}
