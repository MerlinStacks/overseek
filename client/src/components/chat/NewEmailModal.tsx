import { useState, useEffect } from 'react';
import { X, Send, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { RichTextEditor } from '../common/RichTextEditor/RichTextEditor';

interface EmailAccount {
    id: string;
    name: string;
    email: string;
}

interface NewEmailModalProps {
    onClose: () => void;
    onSent: (conversationId: string) => void;
}

export function NewEmailModal({ onClose, onSent }: NewEmailModalProps) {
    const { token, user } = useAuth();
    const { currentAccount } = useAccount();

    const [to, setTo] = useState('');
    const [cc, setCc] = useState('');
    const [subject, setSubject] = useState('');
    const [body, setBody] = useState('');
    const [emailAccountId, setEmailAccountId] = useState('');
    const [emailAccounts, setEmailAccounts] = useState<EmailAccount[]>([]);
    const [showCc, setShowCc] = useState(false);
    const [isSending, setIsSending] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Fetch available email accounts
    useEffect(() => {
        const fetchAccounts = async () => {
            if (!currentAccount || !token) return;
            try {
                const res = await fetch('/api/chat/email-accounts', {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'x-account-id': currentAccount.id
                    }
                });
                if (res.ok) {
                    const accounts = await res.json();
                    setEmailAccounts(accounts);
                    if (accounts.length > 0) {
                        setEmailAccountId(accounts[0].id);
                    }
                }
            } catch (err) {
                console.error('Failed to fetch email accounts', err);
            }
        };
        fetchAccounts();
    }, [currentAccount, token]);

    // Get user's email signature
    const signature = user?.emailSignature || '';

    const handleSend = async () => {
        if (!to.trim() || !subject.trim() || !body.trim()) {
            setError('Please fill in all required fields');
            return;
        }
        if (!emailAccountId) {
            setError('Please select an email account');
            return;
        }

        setIsSending(true);
        setError(null);

        try {
            const res = await fetch('/api/chat/compose', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount?.id || ''
                },
                body: JSON.stringify({
                    to: to.trim(),
                    cc: cc.trim(),
                    subject: subject.trim(),
                    body: body + (signature ? `<br><br>${signature}` : ''),
                    emailAccountId
                })
            });

            const data = await res.json();

            if (!res.ok) {
                throw new Error(data.error || 'Failed to send email');
            }

            onSent(data.conversationId);
        } catch (err: any) {
            setError(err.message || 'Failed to send email');
            setIsSending(false);
        }
    };

    const selectedAccount = emailAccounts.find(a => a.id === emailAccountId);

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
                    <h2 className="text-lg font-semibold text-gray-900">New Email</h2>
                    <button
                        onClick={onClose}
                        className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Form */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                    {/* To Field */}
                    <div className="flex items-center gap-2">
                        <label className="w-16 text-sm font-medium text-gray-600">To:</label>
                        <input
                            type="email"
                            value={to}
                            onChange={(e) => setTo(e.target.value)}
                            placeholder="recipient@example.com"
                            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                        />
                    </div>

                    {/* Via (Email Account) */}
                    <div className="flex items-center gap-2">
                        <label className="w-16 text-sm font-medium text-gray-600">Via:</label>
                        <select
                            value={emailAccountId}
                            onChange={(e) => setEmailAccountId(e.target.value)}
                            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white"
                        >
                            {emailAccounts.length === 0 ? (
                                <option value="">No email accounts configured</option>
                            ) : (
                                emailAccounts.map(account => (
                                    <option key={account.id} value={account.id}>
                                        {account.name} ({account.email})
                                    </option>
                                ))
                            )}
                        </select>
                    </div>

                    {/* Subject */}
                    <div className="flex items-center gap-2">
                        <label className="w-16 text-sm font-medium text-gray-600">Subject:</label>
                        <input
                            type="text"
                            value={subject}
                            onChange={(e) => setSubject(e.target.value)}
                            placeholder="Enter your email subject here"
                            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                        />
                    </div>

                    {/* CC Toggle */}
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={() => setShowCc(!showCc)}
                            className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
                        >
                            {showCc ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                            Cc
                        </button>
                    </div>

                    {/* CC Field (collapsible) */}
                    {showCc && (
                        <div className="flex items-center gap-2">
                            <label className="w-16 text-sm font-medium text-gray-600">Cc:</label>
                            <input
                                type="text"
                                value={cc}
                                onChange={(e) => setCc(e.target.value)}
                                placeholder="email1@example.com, email2@example.com"
                                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                            />
                        </div>
                    )}

                    {/* Body - Rich Text Editor */}
                    <div className="border border-gray-300 rounded-lg overflow-hidden">
                        <RichTextEditor
                            value={body}
                            onChange={setBody}
                            placeholder="Write your message here..."
                            variant="standard"
                            features={['bold', 'italic', 'underline', 'link', 'list']}
                            className="min-h-[200px]"
                        />
                    </div>

                    {/* Signature Preview */}
                    {signature && (
                        <div className="text-xs text-gray-400 border-t border-gray-100 pt-2">
                            <span className="font-medium">Signature will be appended:</span>
                            <div
                                className="mt-1 text-gray-500 line-clamp-2"
                                dangerouslySetInnerHTML={{ __html: signature }}
                            />
                        </div>
                    )}

                    {/* Error Message */}
                    {error && (
                        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                            {error}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 bg-gray-50">
                    <button
                        onClick={onClose}
                        disabled={isSending}
                        className="px-4 py-2 text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50"
                    >
                        Discard
                    </button>
                    <button
                        onClick={handleSend}
                        disabled={isSending || emailAccounts.length === 0}
                        className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {isSending ? (
                            <>
                                <Loader2 size={16} className="animate-spin" />
                                Sending...
                            </>
                        ) : (
                            <>
                                <Send size={16} />
                                Send
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
}
