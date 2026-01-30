import { Mail, Plus, Trash2, Star, Send, Inbox, Globe } from 'lucide-react';
import type { EmailAccount } from './EmailAccountForm';

interface EmailAccountListProps {
    accounts: EmailAccount[];
    onEdit: (account: EmailAccount) => void;
    onDelete: (id: string) => void;
    onAdd: () => void;
    onSetDefault?: (id: string) => void;
}

/**
 * Displays list of unified email accounts with sending/receiving badges.
 */
export function EmailAccountList({ accounts, onEdit, onDelete, onAdd, onSetDefault }: EmailAccountListProps) {
    return (
        <div className="bg-white rounded-xl shadow-xs border border-gray-200 overflow-hidden">
            <div className="p-6 border-b border-gray-200 flex justify-between items-center">
                <div>
                    <h2 className="text-lg font-medium text-gray-900">Email Accounts</h2>
                    <p className="text-sm text-gray-500 mt-1">Manage email accounts for sending and receiving.</p>
                </div>
                <button
                    onClick={onAdd}
                    className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
                >
                    <Plus size={16} />
                    Add Account
                </button>
            </div>
            <div className="divide-y divide-gray-100">
                {accounts.length === 0 ? (
                    <div className="p-10 text-center text-gray-500">
                        No email accounts configured.
                    </div>
                ) : (
                    accounts.map(acc => (
                        <div key={acc.id} className="p-6 flex justify-between items-center hover:bg-gray-50 transition-colors">
                            <div className="flex items-center gap-4">
                                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${acc.isDefault ? 'bg-amber-100 text-amber-600' : 'bg-blue-100 text-blue-600'}`}>
                                    {acc.isDefault ? <Star size={20} /> : <Mail size={20} />}
                                </div>
                                <div>
                                    <div className="flex items-center gap-2">
                                        <h3 className="font-medium text-gray-900">{acc.name}</h3>
                                        {acc.isDefault && (
                                            <span className="px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-700 rounded-full">
                                                Default
                                            </span>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-2 mt-1">
                                        <span className="text-sm text-gray-500">{acc.email}</span>
                                        <span className="text-gray-300">•</span>
                                        <div className="flex items-center gap-1.5">
                                            {acc.relayEndpoint && (
                                                <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-purple-100 text-purple-700 rounded-full">
                                                    <Globe size={10} />
                                                    Relay
                                                </span>
                                            )}
                                            {acc.smtpEnabled && !acc.relayEndpoint && (
                                                <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700 rounded-full">
                                                    <Send size={10} />
                                                    SMTP
                                                </span>
                                            )}
                                            {acc.imapEnabled && (
                                                <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-700 rounded-full">
                                                    <Inbox size={10} />
                                                    Receiving
                                                </span>
                                            )}
                                            {!acc.smtpEnabled && !acc.imapEnabled && !acc.relayEndpoint && (
                                                <span className="text-xs text-gray-400">Not configured</span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                {(acc.smtpEnabled || acc.relayEndpoint) && !acc.isDefault && onSetDefault && (
                                    <button
                                        onClick={() => onSetDefault(acc.id)}
                                        className="p-2 text-gray-400 hover:text-amber-600 hover:bg-white rounded-lg transition-colors border border-transparent hover:border-gray-200 text-sm"
                                    >
                                        Set Default
                                    </button>
                                )}
                                <button
                                    onClick={() => onEdit(acc)}
                                    className="p-2 text-gray-400 hover:text-blue-600 hover:bg-white rounded-lg transition-colors border border-transparent hover:border-gray-200"
                                >
                                    Edit
                                </button>
                                <button
                                    onClick={() => onDelete(acc.id)}
                                    className="p-2 text-gray-400 hover:text-red-600 hover:bg-white rounded-lg transition-colors border border-transparent hover:border-gray-200"
                                >
                                    <Trash2 size={18} />
                                </button>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
