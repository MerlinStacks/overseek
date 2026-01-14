import { useState } from 'react';
import { Server, CheckCircle, XCircle, Loader2, Save, ChevronDown, ChevronUp, Send, Inbox } from 'lucide-react';

/**
 * Unified Email Account - combines SMTP and IMAP in one record.
 */
export interface EmailAccount {
    id: string;
    accountId: string;
    name: string;
    email: string;
    // SMTP
    smtpEnabled: boolean;
    smtpHost?: string;
    smtpPort?: number;
    smtpUsername?: string;
    smtpPassword?: string;
    smtpSecure?: boolean;
    // IMAP
    imapEnabled: boolean;
    imapHost?: string;
    imapPort?: number;
    imapUsername?: string;
    imapPassword?: string;
    imapSecure?: boolean;
    // Meta
    isDefault?: boolean;
}

interface EmailAccountFormProps {
    initialData: Partial<EmailAccount>;
    onSave: (data: Partial<EmailAccount>) => Promise<void>;
    onCancel: () => void;
    onTest: (data: { protocol: 'SMTP' | 'IMAP'; host: string; port: number; username: string; password: string; isSecure: boolean; id?: string }) => Promise<{ success: boolean; message?: string }>;
    isSaving: boolean;
    isTesting: boolean;
    testResult: { success: boolean; message?: string } | null;
}

export function EmailAccountForm({
    initialData,
    onSave,
    onCancel,
    onTest,
    isSaving,
    isTesting,
    testResult
}: EmailAccountFormProps) {
    const [formData, setFormData] = useState<Partial<EmailAccount>>({
        smtpEnabled: false,
        imapEnabled: false,
        smtpSecure: true,
        imapSecure: true,
        smtpPort: 587,
        imapPort: 993,
        ...initialData
    });
    const [smtpExpanded, setSmtpExpanded] = useState(formData.smtpEnabled);
    const [imapExpanded, setImapExpanded] = useState(formData.imapEnabled);
    const [testingProtocol, setTestingProtocol] = useState<'SMTP' | 'IMAP' | null>(null);

    const handleChange = (field: keyof EmailAccount, value: any) => {
        setFormData(prev => ({ ...prev, [field]: value }));
    };

    const handleTestConnection = async (protocol: 'SMTP' | 'IMAP') => {
        setTestingProtocol(protocol);
        const isSmtp = protocol === 'SMTP';
        await onTest({
            protocol,
            id: formData.id,
            host: (isSmtp ? formData.smtpHost : formData.imapHost) || '',
            port: (isSmtp ? formData.smtpPort : formData.imapPort) || (isSmtp ? 587 : 993),
            username: (isSmtp ? formData.smtpUsername : formData.imapUsername) || formData.email || '',
            password: (isSmtp ? formData.smtpPassword : formData.imapPassword) || '',
            isSecure: (isSmtp ? formData.smtpSecure : formData.imapSecure) ?? true
        });
        setTestingProtocol(null);
    };

    return (
        <div className="bg-white rounded-xl shadow-xs border border-gray-200 overflow-hidden">
            <div className="p-6 border-b border-gray-200 flex justify-between items-center">
                <h2 className="text-lg font-medium text-gray-900">
                    {formData.id ? 'Edit Email Account' : 'New Email Account'}
                </h2>
                <button onClick={onCancel} className="text-gray-400 hover:text-gray-600">
                    <XCircle size={24} />
                </button>
            </div>

            <div className="p-6 space-y-6">
                {/* Basic Info */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Account Name</label>
                        <input
                            type="text"
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-hidden"
                            placeholder="e.g. Support Inbox"
                            value={formData.name || ''}
                            onChange={(e) => handleChange('name', e.target.value)}
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Email Address</label>
                        <input
                            type="email"
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-hidden"
                            placeholder="support@example.com"
                            value={formData.email || ''}
                            onChange={(e) => handleChange('email', e.target.value)}
                        />
                    </div>
                </div>

                {/* SMTP Section */}
                <div className="border border-gray-200 rounded-xl overflow-hidden">
                    <button
                        type="button"
                        onClick={() => setSmtpExpanded(!smtpExpanded)}
                        className="w-full flex items-center justify-between p-4 bg-gray-50 hover:bg-gray-100 transition-colors"
                    >
                        <div className="flex items-center gap-3">
                            <div className={`p-2 rounded-lg ${formData.smtpEnabled ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-400'}`}>
                                <Send size={18} />
                            </div>
                            <div className="text-left">
                                <h3 className="font-medium text-gray-900">Outgoing (SMTP)</h3>
                                <p className="text-sm text-gray-500">For sending emails</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-3">
                            <label className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                                <input
                                    type="checkbox"
                                    checked={formData.smtpEnabled}
                                    onChange={(e) => {
                                        handleChange('smtpEnabled', e.target.checked);
                                        if (e.target.checked) setSmtpExpanded(true);
                                    }}
                                    className="rounded border-gray-300 text-blue-600"
                                />
                                <span className="text-sm text-gray-600">Enable</span>
                            </label>
                            {smtpExpanded ? <ChevronUp size={20} className="text-gray-400" /> : <ChevronDown size={20} className="text-gray-400" />}
                        </div>
                    </button>

                    {smtpExpanded && (
                        <div className="p-4 space-y-4 border-t border-gray-200">
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <div className="md:col-span-2">
                                    <label className="block text-sm font-medium text-gray-700 mb-1">SMTP Host</label>
                                    <input
                                        type="text"
                                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-hidden"
                                        placeholder="smtp.gmail.com"
                                        value={formData.smtpHost || ''}
                                        onChange={(e) => handleChange('smtpHost', e.target.value)}
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Port</label>
                                    <input
                                        type="number"
                                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-hidden"
                                        placeholder="587"
                                        value={formData.smtpPort || ''}
                                        onChange={(e) => handleChange('smtpPort', parseInt(e.target.value))}
                                    />
                                </div>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Username</label>
                                    <input
                                        type="text"
                                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-hidden"
                                        placeholder="Same as email if blank"
                                        value={formData.smtpUsername || ''}
                                        onChange={(e) => handleChange('smtpUsername', e.target.value)}
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                                    <input
                                        type="password"
                                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-hidden"
                                        placeholder="••••••••"
                                        value={formData.smtpPassword || ''}
                                        onChange={(e) => handleChange('smtpPassword', e.target.value)}
                                    />
                                </div>
                            </div>
                            <div className="flex items-center justify-between">
                                <label className="flex items-center gap-2">
                                    <input
                                        type="checkbox"
                                        checked={formData.smtpSecure ?? true}
                                        onChange={(e) => handleChange('smtpSecure', e.target.checked)}
                                        className="rounded border-gray-300 text-blue-600"
                                    />
                                    <span className="text-sm text-gray-700">Use TLS/SSL</span>
                                </label>
                                <button
                                    type="button"
                                    onClick={() => handleTestConnection('SMTP')}
                                    disabled={isTesting || !formData.smtpHost}
                                    className="text-sm text-blue-600 hover:text-blue-700 disabled:opacity-50"
                                >
                                    {testingProtocol === 'SMTP' ? 'Testing...' : 'Test SMTP'}
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                {/* IMAP Section */}
                <div className="border border-gray-200 rounded-xl overflow-hidden">
                    <button
                        type="button"
                        onClick={() => setImapExpanded(!imapExpanded)}
                        className="w-full flex items-center justify-between p-4 bg-gray-50 hover:bg-gray-100 transition-colors"
                    >
                        <div className="flex items-center gap-3">
                            <div className={`p-2 rounded-lg ${formData.imapEnabled ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-400'}`}>
                                <Inbox size={18} />
                            </div>
                            <div className="text-left">
                                <h3 className="font-medium text-gray-900">Incoming (IMAP)</h3>
                                <p className="text-sm text-gray-500">For receiving emails</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-3">
                            <label className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                                <input
                                    type="checkbox"
                                    checked={formData.imapEnabled}
                                    onChange={(e) => {
                                        handleChange('imapEnabled', e.target.checked);
                                        if (e.target.checked) setImapExpanded(true);
                                    }}
                                    className="rounded border-gray-300 text-blue-600"
                                />
                                <span className="text-sm text-gray-600">Enable</span>
                            </label>
                            {imapExpanded ? <ChevronUp size={20} className="text-gray-400" /> : <ChevronDown size={20} className="text-gray-400" />}
                        </div>
                    </button>

                    {imapExpanded && (
                        <div className="p-4 space-y-4 border-t border-gray-200">
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <div className="md:col-span-2">
                                    <label className="block text-sm font-medium text-gray-700 mb-1">IMAP Host</label>
                                    <input
                                        type="text"
                                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-hidden"
                                        placeholder="imap.gmail.com"
                                        value={formData.imapHost || ''}
                                        onChange={(e) => handleChange('imapHost', e.target.value)}
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Port</label>
                                    <input
                                        type="number"
                                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-hidden"
                                        placeholder="993"
                                        value={formData.imapPort || ''}
                                        onChange={(e) => handleChange('imapPort', parseInt(e.target.value))}
                                    />
                                </div>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Username</label>
                                    <input
                                        type="text"
                                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-hidden"
                                        placeholder="Same as email if blank"
                                        value={formData.imapUsername || ''}
                                        onChange={(e) => handleChange('imapUsername', e.target.value)}
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                                    <input
                                        type="password"
                                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-hidden"
                                        placeholder="••••••••"
                                        value={formData.imapPassword || ''}
                                        onChange={(e) => handleChange('imapPassword', e.target.value)}
                                    />
                                </div>
                            </div>
                            <div className="flex items-center justify-between">
                                <label className="flex items-center gap-2">
                                    <input
                                        type="checkbox"
                                        checked={formData.imapSecure ?? true}
                                        onChange={(e) => handleChange('imapSecure', e.target.checked)}
                                        className="rounded border-gray-300 text-blue-600"
                                    />
                                    <span className="text-sm text-gray-700">Use TLS/SSL</span>
                                </label>
                                <button
                                    type="button"
                                    onClick={() => handleTestConnection('IMAP')}
                                    disabled={isTesting || !formData.imapHost}
                                    className="text-sm text-blue-600 hover:text-blue-700 disabled:opacity-50"
                                >
                                    {testingProtocol === 'IMAP' ? 'Testing...' : 'Test IMAP'}
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                {/* Test Results */}
                {testResult && (
                    <div className={`p-4 rounded-lg flex items-center gap-3 ${testResult.success ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                        {testResult.success ? <CheckCircle size={20} /> : <XCircle size={20} />}
                        <span className="text-sm font-medium">{testResult.success ? 'Connection Successful!' : `Connection Failed: ${testResult.message}`}</span>
                    </div>
                )}

                {/* Footer */}
                <div className="bg-gray-50 -mx-6 -mb-6 px-6 py-4 flex justify-between items-center rounded-b-xl border-t border-gray-100 mt-6">
                    <div className="text-sm text-gray-500">
                        {!formData.smtpEnabled && !formData.imapEnabled && 'Enable at least one protocol'}
                    </div>
                    <div className="flex gap-3">
                        <button
                            onClick={onCancel}
                            className="px-4 py-2 text-gray-700 hover:text-gray-900 font-medium"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={() => onSave(formData)}
                            disabled={isSaving || (!formData.smtpEnabled && !formData.imapEnabled)}
                            className="flex items-center gap-2 bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 transition-colors font-medium disabled:opacity-50"
                        >
                            {isSaving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                            {isSaving ? 'Saving...' : 'Save Account'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
