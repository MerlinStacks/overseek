import { useState, useEffect, useRef } from 'react';
import DOMPurify from 'dompurify';
import { Logger } from '../../utils/logger';
import { X, Send, Loader2, ChevronDown, ChevronUp, Zap, Paperclip } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { InboxRichTextEditor } from './InboxRichTextEditor';
import { useCannedResponses } from '../../hooks/useCannedResponses';

interface EmailAccount {
    id: string;
    name: string;
    email: string;
}

interface NewEmailModalProps {
    onClose: () => void;
    onSent: (conversationId: string) => void;
}

const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

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
    const [attachments, setAttachments] = useState<File[]>([]);
    const [uploadProgress, setUploadProgress] = useState<number>(0);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Canned responses integration
    const {
        cannedResponses,
        filteredCanned,
        showCanned,
        handleInputForCanned,
        selectCanned,
        setShowCanned
    } = useCannedResponses();

    // Handle body change and check for canned response trigger
    const handleBodyChange = (value: string) => {
        setBody(value);
        handleInputForCanned(value);
    };

    // Select a canned response and replace the body
    const handleSelectCanned = (response: { id: string; shortcut: string; content: string }) => {
        const context = {
            agentFirstName: user?.fullName?.split(' ')[0],
            agentFullName: user?.fullName ?? undefined
        };
        const content = selectCanned(response as any, context);
        setBody(content);
    };

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
                Logger.error('Failed to fetch email accounts', { error: err });
            }
        };
        fetchAccounts();
    }, [currentAccount, token]);

    // Get user's email signature
    const signature = user?.emailSignature || '';

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files) {
            setAttachments(prev => [...prev, ...Array.from(e.target.files!)]);
        }
        // Reset input so same file can be selected again
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    const removeAttachment = (index: number) => {
        setAttachments(prev => prev.filter((_, i) => i !== index));
    };

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
        setUploadProgress(0);

        try {
            const formData = new FormData();
            formData.append('to', to.trim());
            formData.append('cc', cc.trim());
            formData.append('subject', subject.trim());
            formData.append('body', body + (signature ? `<br><br>${signature}` : ''));
            formData.append('emailAccountId', emailAccountId);

            attachments.forEach(file => {
                formData.append('attachments', file);
            });

            // Use XMLHttpRequest to track upload progress
            const xhr = new XMLHttpRequest();

            const result = await new Promise<{ success: boolean; conversationId?: string; error?: string }>((resolve, reject) => {
                xhr.upload.onprogress = (event) => {
                    if (event.lengthComputable) {
                        const percent = Math.round((event.loaded / event.total) * 100);
                        setUploadProgress(percent);
                    }
                };

                xhr.onload = () => {
                    try {
                        const data = JSON.parse(xhr.responseText);
                        if (xhr.status >= 200 && xhr.status < 300) {
                            resolve({ success: true, conversationId: data.conversationId });
                        } else {
                            resolve({ success: false, error: data.error || 'Failed to send email' });
                        }
                    } catch {
                        resolve({ success: false, error: 'Failed to parse response' });
                    }
                };

                xhr.onerror = () => {
                    reject(new Error('Network error'));
                };

                xhr.open('POST', '/api/chat/compose');
                xhr.setRequestHeader('Authorization', `Bearer ${token}`);
                xhr.setRequestHeader('x-account-id', currentAccount?.id || '');
                xhr.send(formData);
            });

            if (!result.success) {
                throw new Error(result.error);
            }

            onSent(result.conversationId!);
        } catch (err: any) {
            setError(err.message || 'Failed to send email');
            setIsSending(false);
            setUploadProgress(0);
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

                    {/* Canned Responses Dropdown */}
                    {showCanned && (
                        <div className="border border-gray-200 rounded-lg bg-white max-h-48 overflow-y-auto">
                            <div className="p-2 text-xs text-gray-500 border-b bg-gray-50 flex items-center justify-between">
                                <span>Canned Responses (type to filter)</span>
                            </div>
                            {filteredCanned.length > 0 ? (
                                filteredCanned.map(r => (
                                    <button
                                        key={r.id}
                                        onClick={() => handleSelectCanned(r)}
                                        className="w-full text-left px-3 py-2 hover:bg-blue-50 transition-colors border-b border-gray-50 last:border-0"
                                    >
                                        <span className="text-xs font-mono bg-gray-100 px-1.5 py-0.5 rounded-sm text-gray-600">
                                            /{r.shortcut}
                                        </span>
                                        <p className="text-sm text-gray-700 mt-1 line-clamp-1">{r.content}</p>
                                    </button>
                                ))
                            ) : (
                                <div className="px-3 py-4 text-center text-gray-500 text-sm">
                                    {cannedResponses.length === 0 ? (
                                        'No canned responses yet.'
                                    ) : (
                                        'No matches found'
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Body - Rich Text Editor with Canned Response trigger */}
                    <div className="border border-gray-300 rounded-lg overflow-hidden">
                        <div className="p-3">
                            <InboxRichTextEditor
                                value={body}
                                onChange={handleBodyChange}
                                placeholder="Type your message... (/ for canned responses)"
                                cannedPickerOpen={showCanned}
                            />
                        </div>
                        {/* Toolbar with Canned Response button */}
                        <div className="flex items-center gap-1 px-3 py-2 border-t border-gray-100 bg-gray-50">
                            <button
                                type="button"
                                onClick={() => setBody('/')}
                                className="p-2 rounded-sm hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition-colors"
                                title="Canned Responses"
                                aria-label="Insert canned response"
                            >
                                <Zap size={18} />
                            </button>
                            <div className="w-px h-4 bg-gray-300 mx-1" />
                            <button
                                type="button"
                                onClick={() => fileInputRef.current?.click()}
                                className="p-2 rounded-sm hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition-colors"
                                title="Attach File"
                                aria-label="Attach File"
                            >
                                <Paperclip size={18} />
                            </button>
                            <input
                                type="file"
                                ref={fileInputRef}
                                onChange={handleFileSelect}
                                className="hidden"
                                multiple
                                accept=".jpg,.jpeg,.png,.gif,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,.zip"
                            />
                        </div>
                    </div>

                    {/* Attachments List */}
                    {attachments.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                            {attachments.map((file, index) => (
                                <div key={index} className="flex items-center gap-2 px-3 py-1.5 bg-gray-100 rounded-full text-sm text-gray-700 border border-gray-200">
                                    <span className="truncate max-w-[200px]">{file.name}</span>
                                    <span className="text-xs text-gray-500 whitespace-nowrap">({formatFileSize(file.size)})</span>
                                    <button
                                        onClick={() => removeAttachment(index)}
                                        disabled={isSending}
                                        className="text-gray-400 hover:text-red-500 transition-colors disabled:opacity-50"
                                    >
                                        <X size={14} />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Upload Progress Bar */}
                    {isSending && attachments.length > 0 && (
                        <div className="space-y-1">
                            <div className="flex items-center justify-between text-xs text-gray-600">
                                <span>Uploading attachments...</span>
                                <span className="font-medium">{uploadProgress}%</span>
                            </div>
                            <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-gradient-to-r from-blue-500 to-blue-600 rounded-full transition-all duration-200"
                                    style={{ width: `${uploadProgress}%` }}
                                />
                            </div>
                        </div>
                    )}


                    {/* Signature Preview */}
                    {signature && (
                        <div className="text-xs text-gray-400 border-t border-gray-100 pt-2">
                            <span className="font-medium">Signature will be appended:</span>
                            <div
                                className="mt-1 text-gray-500 line-clamp-2"
                                dangerouslySetInnerHTML={{
                                    __html: DOMPurify.sanitize(signature, {
                                        ALLOWED_TAGS: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'a', 'div', 'span'],
                                        ALLOWED_ATTR: ['href', 'target', 'style']
                                    })
                                }}
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
