import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
    ArrowLeft, Mail, Loader2
} from 'lucide-react';

/**
 * Share Target Handler Page
 * 
 * Handles content shared TO the PWA via the Web Share Target API.
 * The manifest.json share_target config routes shared content here.
 */
export default function MobileShareHandler() {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const [isProcessing, setIsProcessing] = useState(true);
    const [sharedData, setSharedData] = useState({
        subject: '',
        body: '',
        link: ''
    });

    useEffect(() => {
        // Extract shared data from URL params
        const subject = searchParams.get('subject') || '';
        const body = searchParams.get('body') || '';
        const link = searchParams.get('link') || '';

        setSharedData({ subject, body, link });

        // Combine body and link if both present
        const fullBody = [body, link].filter(Boolean).join('\n\n');

        // If we have content, redirect to inbox compose
        if (subject || fullBody) {
            // Store shared content in sessionStorage for the inbox to pick up
            sessionStorage.setItem('sharedContent', JSON.stringify({
                subject: subject || 'Shared Content',
                body: fullBody,
                timestamp: Date.now()
            }));

            // Redirect to inbox with compose flag
            setTimeout(() => {
                navigate('/m/inbox?compose=true', { replace: true });
            }, 500);
        } else {
            setIsProcessing(false);
        }
    }, [searchParams, navigate]);

    const handleManualCompose = () => {
        navigate('/m/inbox?compose=true', { replace: true });
    };

    const handleBack = () => {
        navigate('/m/dashboard', { replace: true });
    };

    return (
        <div className="min-h-screen bg-slate-900 text-white flex flex-col">
            {/* Header */}
            <header className="sticky top-0 z-20 bg-slate-800/80 backdrop-blur-xl border-b border-white/10 px-4 py-3 flex items-center gap-3">
                <button
                    onClick={handleBack}
                    className="p-2 -ml-2 rounded-lg hover:bg-white/10 transition-colors"
                >
                    <ArrowLeft className="w-5 h-5" />
                </button>
                <h1 className="text-lg font-semibold">Share to OverSeek</h1>
            </header>

            {/* Content */}
            <div className="flex-1 flex flex-col items-center justify-center p-6">
                {isProcessing ? (
                    <div className="text-center">
                        <Loader2 className="w-12 h-12 text-indigo-400 animate-spin mx-auto mb-4" />
                        <p className="text-slate-400">Processing shared content...</p>
                    </div>
                ) : (
                    <div className="text-center max-w-sm">
                        <div className="w-16 h-16 bg-indigo-500/20 rounded-2xl flex items-center justify-center mx-auto mb-4">
                            <Mail className="w-8 h-8 text-indigo-400" />
                        </div>
                        <h2 className="text-xl font-semibold mb-2">No Content Received</h2>
                        <p className="text-slate-400 mb-6">
                            No shared content was detected. Would you like to compose a new message?
                        </p>
                        <button
                            onClick={handleManualCompose}
                            className="w-full py-3 px-4 bg-indigo-500 hover:bg-indigo-600 rounded-xl font-medium transition-colors"
                        >
                            Compose New Message
                        </button>
                    </div>
                )}

                {/* Debug info in development */}
                {!isProcessing && (sharedData.subject || sharedData.body || sharedData.link) && (
                    <div className="mt-8 p-4 bg-slate-800 rounded-xl text-sm">
                        <p className="text-slate-500 mb-2">Shared data received:</p>
                        <pre className="text-slate-400 whitespace-pre-wrap">
                            {JSON.stringify(sharedData, null, 2)}
                        </pre>
                    </div>
                )}
            </div>
        </div>
    );
}
