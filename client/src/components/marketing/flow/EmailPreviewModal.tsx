/**
 * EmailPreviewModal - Modal for previewing and testing emails
 */
import { useState } from 'react';
import { X, Eye, Send, Loader2, CheckCircle } from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import { useAccount } from '../../../context/AccountContext';

interface Props {
    htmlContent: string;
    subject?: string;
    onClose: () => void;
}

export function EmailPreviewModal({ htmlContent, subject, onClose }: Props) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [testEmail, setTestEmail] = useState('');
    const [sending, setSending] = useState(false);
    const [sent, setSent] = useState(false);
    const [error, setError] = useState('');
    const [activeTab, setActiveTab] = useState<'preview' | 'test'>('preview');

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
                    content: htmlContent
                })
            });

            if (res.ok) {
                setSent(true);
                setTimeout(() => setSent(false), 3000);
            } else {
                const data = await res.json();
                setError(data.message || 'Failed to send test email');
            }
        } catch (err) {
            setError('Failed to send test email');
        } finally {
            setSending(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-xs">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b">
                    <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-blue-100">
                            <Eye size={18} className="text-blue-600" />
                        </div>
                        <div>
                            <h3 className="font-semibold text-gray-900">Preview & Test</h3>
                            <p className="text-sm text-gray-500">Preview your email and send a test</p>
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
                            ? 'bg-blue-100 text-blue-700'
                            : 'text-gray-600 hover:bg-gray-100'
                            }`}
                    >
                        <Eye size={14} className="inline mr-2" />
                        Preview
                    </button>
                    <button
                        onClick={() => setActiveTab('test')}
                        className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${activeTab === 'test'
                            ? 'bg-blue-100 text-blue-700'
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
                            {htmlContent ? (
                                <iframe
                                    srcDoc={htmlContent}
                                    className="w-full h-full min-h-[400px] bg-white"
                                    title="Email Preview"
                                    sandbox="allow-same-origin"
                                />
                            ) : (
                                <div className="flex items-center justify-center h-full text-gray-400">
                                    No content to preview
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="max-w-md mx-auto py-8">
                            <div className="text-center mb-6">
                                <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                                    <Send size={24} className="text-blue-600" />
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
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                    />
                                </div>

                                {error && (
                                    <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
                                )}

                                {sent && (
                                    <p className="text-sm text-green-600 bg-green-50 px-3 py-2 rounded-lg flex items-center gap-2">
                                        <CheckCircle size={16} />
                                        Test email sent successfully!
                                    </p>
                                )}

                                <button
                                    onClick={handleSendTest}
                                    disabled={sending || !testEmail}
                                    className="w-full flex items-center justify-center gap-2 px-5 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium transition-colors disabled:opacity-50"
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
