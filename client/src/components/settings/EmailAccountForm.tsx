import { useState } from 'react';
import { Server, CheckCircle, XCircle, Loader2, Save, XCircle as CloseIcon } from 'lucide-react';

export interface EmailAccount {
    id: string;
    accountId: string;
    name: string;
    email: string;
    host: string;
    port: number;
    username: string;
    password?: string;
    type: 'SMTP' | 'IMAP';
    isSecure: boolean;
}

interface EmailAccountFormProps {
    initialData: Partial<EmailAccount>;
    onSave: (data: Partial<EmailAccount>) => Promise<void>;
    onCancel: () => void;
    onTest: (data: Partial<EmailAccount>) => Promise<{ success: boolean; message?: string }>;
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
    const [formData, setFormData] = useState<Partial<EmailAccount>>(initialData);

    const handleChange = (field: keyof EmailAccount, value: any) => {
        setFormData(prev => ({ ...prev, [field]: value }));
    };

    return (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="p-6 border-b border-gray-200 flex justify-between items-center">
                <h2 className="text-lg font-medium text-gray-900">
                    {formData.id ? 'Edit Account' : 'New Email Account'}
                </h2>
                <button onClick={onCancel} className="text-gray-400 hover:text-gray-600">
                    <CloseIcon size={24} />
                </button>
            </div>

            <div className="p-6 space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Account Name</label>
                        <input
                            type="text"
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                            placeholder="e.g. Support Inbox"
                            value={formData.name || ''}
                            onChange={(e) => handleChange('name', e.target.value)}
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Email Address</label>
                        <input
                            type="email"
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                            placeholder="support@example.com"
                            value={formData.email || ''}
                            onChange={(e) => handleChange('email', e.target.value)}
                        />
                    </div>
                </div>

                <div className="border-t border-gray-100 pt-6">
                    <h3 className="text-sm font-medium text-gray-900 mb-4 flex items-center gap-2">
                        <Server size={16} />
                        Server Settings
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Protocol</label>
                            <select
                                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                                value={formData.type}
                                onChange={(e) => handleChange('type', e.target.value)}
                            >
                                <option value="SMTP">SMTP (Sending)</option>
                                <option value="IMAP">IMAP (Receiving)</option>
                            </select>
                        </div>
                        <div className="md:col-span-2">
                            <label className="block text-sm font-medium text-gray-700 mb-1">Host</label>
                            <input
                                type="text"
                                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                                placeholder="smtp.gmail.com"
                                value={formData.host || ''}
                                onChange={(e) => handleChange('host', e.target.value)}
                            />
                        </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Port</label>
                            <input
                                type="number"
                                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                                placeholder="587"
                                value={formData.port || ''}
                                onChange={(e) => handleChange('port', parseInt(e.target.value))}
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Username</label>
                            <input
                                type="text"
                                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                                value={formData.username || ''}
                                onChange={(e) => handleChange('username', e.target.value)}
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                            <input
                                type="password"
                                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                                placeholder="••••••••"
                                value={formData.password || ''}
                                onChange={(e) => handleChange('password', e.target.value)}
                            />
                        </div>
                    </div>
                    <div className="mt-4 flex items-center gap-2">
                        <input
                            type="checkbox"
                            id="secure"
                            checked={formData.isSecure}
                            onChange={(e) => handleChange('isSecure', e.target.checked)}
                            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        <label htmlFor="secure" className="text-sm text-gray-700">Use Secure Connection (TLS/SSL)</label>
                    </div>
                </div>

                {/* Test Results */}
                {testResult && (
                    <div className={`p-4 rounded-lg flex items-center gap-3 ${testResult.success ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                        {testResult.success ? <CheckCircle size={20} /> : <XCircle size={20} />}
                        <span className="text-sm font-medium">{testResult.success ? 'Connection Successful!' : `Connection Failed: ${testResult.message}`}</span>
                    </div>
                )}

                <div className="bg-gray-50 -mx-6 -mb-6 px-6 py-4 flex justify-between items-center rounded-b-xl border-t border-gray-100 mt-6">
                    <button
                        onClick={() => onTest(formData)}
                        disabled={isTesting || !formData.host}
                        className="text-gray-600 hover:text-gray-900 text-sm font-medium px-4 py-2 rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-50"
                    >
                        {isTesting ? 'Testing...' : 'Test Connection'}
                    </button>
                    <div className="flex gap-3">
                        <button
                            onClick={onCancel}
                            className="px-4 py-2 text-gray-700 hover:text-gray-900 font-medium"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={() => onSave(formData)}
                            disabled={isSaving}
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
