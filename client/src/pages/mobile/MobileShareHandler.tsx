import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Mail, Loader2 } from 'lucide-react';

/** Receives the manifest's Web Share Target parameters and transfers a draft to the inbox. */
export default function MobileShareHandler() {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const query = searchParams.toString();
    const subject = searchParams.get('subject') || '';
    const body = [searchParams.get('body'), searchParams.get('link')].filter(Boolean).join('\n\n');
    const hasContent = Boolean(subject || body);
    const [failure, setFailure] = useState<{ query: string; message: string } | null>(null);
    const [retry, setRetry] = useState(0);
    const error = failure?.query === query ? failure.message : '';

    useEffect(() => {
        if (!hasContent) return;
        const timer = setTimeout(() => {
            try {
                sessionStorage.setItem('sharedContent', JSON.stringify({ subject: subject || 'Shared Content', body, timestamp: Date.now() }));
                navigate('/m/inbox?compose=true', { replace: true });
            } catch {
                setFailure({ query, message: 'Could not save shared content on this device. Copy it below or retry after enabling browser storage.' });
            }
        }, 0);
        return () => clearTimeout(timer);
    }, [query, subject, body, hasContent, retry, navigate]);

    const compose = () => {
        try {
            sessionStorage.removeItem('sharedContent');
            navigate('/m/inbox?compose=true', { replace: true });
        } catch {
            setFailure({ query, message: 'Browser storage is unavailable. Enable it before opening a new draft.' });
        }
    };

    return (
        <div className="min-h-screen bg-slate-900 text-white flex flex-col">
            <header className="sticky top-0 z-20 bg-slate-800/80 backdrop-blur-xl border-b border-white/10 px-4 py-3 flex items-center gap-3">
                <button type="button" aria-label="Back to dashboard" onClick={() => navigate('/m/dashboard', { replace: true })}
                    className="p-2 -ml-2 rounded-lg hover:bg-white/10 transition-colors">
                    <ArrowLeft aria-hidden="true" className="w-5 h-5" />
                </button>
                <h1 className="text-lg font-semibold">Share to OverSeek</h1>
            </header>
            <div className="flex-1 flex flex-col items-center justify-center p-6">
                {error ? (
                    <div className="max-w-sm space-y-4">
                        <p role="alert">{error}</p>
                        {hasContent && <>
                            <pre aria-label="Shared content" className="whitespace-pre-wrap break-words select-all rounded-lg bg-slate-800 p-4">{[subject, body].filter(Boolean).join('\n\n')}</pre>
                            <button type="button" onClick={() => { setFailure(null); setRetry(value => value + 1); }} className="px-4 py-2 bg-indigo-500 rounded-lg">Retry saving</button>
                        </>}
                    </div>
                ) : hasContent ? (
                    <div role="status" className="text-center">
                        <Loader2 aria-hidden="true" className="w-12 h-12 text-indigo-400 animate-spin motion-reduce:animate-none mx-auto mb-4" />
                        <p className="text-slate-400">Processing shared content...</p>
                    </div>
                ) : (
                    <div className="text-center max-w-sm">
                        <Mail aria-hidden="true" className="w-8 h-8 text-indigo-400 mx-auto mb-4" />
                        <h2 className="text-xl font-semibold mb-2">No Content Received</h2>
                        <p className="text-slate-400 mb-6">No shared content was detected. Would you like to compose a new message?</p>
                        <button type="button" onClick={compose} className="w-full py-3 px-4 bg-indigo-500 hover:bg-indigo-600 rounded-xl font-medium transition-colors">Compose New Message</button>
                    </div>
                )}
            </div>
        </div>
    );
}
