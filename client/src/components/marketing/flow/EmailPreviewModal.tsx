/**
 * EmailPreviewModal - Modal for previewing and testing emails
 */
import { useEffect, useState } from 'react';
import { X, Eye, Send, Loader2, CheckCircle } from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import { useAccount } from '../../../context/AccountContext';

interface Props {
    onPreviewed?: () => void;
    onTestSent?: () => void;
    htmlContent: string;
    subject?: string;
    previewText?: string;
    category?: 'MARKETING' | 'TRANSACTIONAL';
    onClose: () => void;
}

export function EmailPreviewModal({ htmlContent, subject, previewText, category = 'MARKETING', onClose, onPreviewed, onTestSent }: Props) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [testEmail, setTestEmail] = useState('');
    const [sending, setSending] = useState(false);
    const [sent, setSent] = useState(false);
    const [error, setError] = useState('');
    const [activeTab, setActiveTab] = useState<'preview' | 'test'>('preview');
    const [preview, setPreview] = useState<{ html: string; subject: string; previewText: string; orderId: string | null } | null>(null);
    const [previewError, setPreviewError] = useState('');

    useEffect(() => {
        const controller = new AbortController();
        setPreview(null);
        setPreviewError('');
        if (!htmlContent) return;
        void (async () => {
            try {
                const res = await fetch('/api/marketing/preview-email', {
                    method: 'POST', signal: controller.signal,
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'x-account-id': currentAccount?.id || '' },
                    body: JSON.stringify({ content: htmlContent, subject, previewText }),
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || 'Failed to load email preview');
                if (!controller.signal.aborted) setPreview(data);
            } catch (err) {
                if (!controller.signal.aborted) setPreviewError(err instanceof Error ? err.message : 'Failed to load email preview');
            }
        })();
        return () => controller.abort();
    }, [htmlContent, subject, previewText, token, currentAccount?.id]);

    const handleSendTest = async () => {
        if (!testEmail.trim() || !testEmail.includes('@')) {
            setError('Please enter a valid email address');
            return;
        }

        setSending(true);
        setError('');

        try {
            const res = await fetch('/api/marketing/test-email', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                    'x-account-id': currentAccount?.id || ''
                },
                body: JSON.stringify({
                    to: testEmail.trim(),
                    subject: subject || 'Test Email',
                    content: htmlContent,
                    previewText,
                    category,
                    orderId: preview?.orderId
                })
            });

            if (res.ok) {
                setSent(true);
                onTestSent?.();
                setTimeout(() => setSent(false), 3000);
            } else {
                const data = await res.json().catch(() => ({}));
                const reason = data.reason ? ` (${data.reason})` : '';
                setError(data.error || data.message || `Failed to send test email${reason}`);
            }
        } catch (err) {
            setError('Failed to send test email');
        } finally {
            setSending(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 ">
            <div className="bg-white rounded-xl shadow-sm w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b">
                    <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-[var(--brand-subtle)]">
                            <Eye size={18} className="text-[var(--brand-text)]" />
                        </div>
                        <div>
                            <h3 className="font-semibold text-gray-900">Preview & Test</h3>
                            <p className="text-sm text-gray-500">Merge tags use a recent order or sample data, not a live cart.</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                    >
                        <X size={18} className="text-gray-500" />
                    </button>
                </div>

                {/* Tabs */}
                <div className="flex gap-1 px-6 pt-4">
                    <button
                        onClick={() => setActiveTab('preview')}
                        className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${activeTab === 'preview'
                            ? 'bg-[var(--brand-subtle)] text-[var(--brand-text)]'
                            : 'text-gray-600 hover:bg-gray-100'
                            }`}
                    >
                        <Eye size={14} className="inline mr-2" />
                        Preview
                    </button>
                    <button
                        onClick={() => setActiveTab('test')}
                        className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${activeTab === 'test'
                            ? 'bg-[var(--brand-subtle)] text-[var(--brand-text)]'
                            : 'text-gray-600 hover:bg-gray-100'
                            }`}
                    >
                        <Send size={14} className="inline mr-2" />
                        Send Test
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-hidden p-6">
                    {activeTab === 'preview' ? (
                        <div className="h-full border rounded-lg overflow-hidden bg-gray-50">
                            {previewError ? <p role="alert" className="p-4 text-red-600">{previewError}</p> : htmlContent && !preview ? <p className="p-4 text-gray-500">Loading email preview...</p> : preview ? (
                                <>
                                    <p className="border-b bg-white px-4 py-2 text-sm text-gray-700">{preview.subject}</p>
                                    <iframe
                                        onLoad={onPreviewed}
                                        srcDoc={preview.html}
                                        className="w-full h-full min-h-[400px] bg-white"
                                        title="Email Preview"
                                        sandbox="allow-same-origin"
                                    />
                                </>
                            ) : (
                                <div className="flex items-center justify-center h-full text-gray-400">
                                    No content to preview
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="max-w-md mx-auto py-8">
                            <div className="text-center mb-6">
                                <div className="w-16 h-16 bg-[var(--brand-subtle)] rounded-full flex items-center justify-center mx-auto mb-4">
                                    <Send size={24} className="text-[var(--brand-text)]" />
                                </div>
                                <h4 className="text-lg font-medium text-gray-900">Send a Test Email</h4>
                                <p className="text-sm text-gray-500 mt-1">
                                    Preview how this email will look in your inbox
                                </p>
                            </div>

                            <div className="space-y-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                        Email Address
                                    </label>
                                    <input
                                        type="email"
                                        value={testEmail}
                                        onChange={(e) => setTestEmail(e.target.value)}
                                        placeholder="your@email.com"
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[var(--focus-color)] focus:border-[var(--primary-color)]"
                                    />
                                </div>

                                {error && (
                                    <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
                                )}

                                {previewError && <p role="alert" className="text-sm text-red-600">{previewError}</p>}

                                {sent && (
                                    <p className="text-sm text-green-600 bg-green-50 px-3 py-2 rounded-lg flex items-center gap-2">
                                        <CheckCircle size={16} />
                                        Test email sent successfully!
                                    </p>
                                )}

                                <button
                                    onClick={handleSendTest}
                                    disabled={sending || !testEmail || !preview}
                                className="w-full flex items-center justify-center gap-2 px-5 py-3 bg-[var(--primary-color)] text-[var(--primary-foreground)] rounded-lg hover:bg-[var(--primary-hover)] font-medium transition-colors disabled:opacity-50"
                                >
                                    {sending ? (
                                        <Loader2 size={18} className="animate-spin" />
                                    ) : (
                                        <Send size={18} />
                                    )}
                                    Send Test Email
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="px-6 py-4 border-t bg-gray-50">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800 transition-colors"
                    >
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
}
