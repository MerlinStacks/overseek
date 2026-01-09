import { Mail, Plus, Trash2 } from 'lucide-react';
import type { EmailAccount } from './EmailAccountForm';

interface EmailAccountListProps {
    accounts: EmailAccount[];
    onEdit: (account: EmailAccount) => void;
    onDelete: (id: string) => void;
    onAdd: () => void;
}

export function EmailAccountList({ accounts, onEdit, onDelete, onAdd }: EmailAccountListProps) {
    return (
        <div className="bg-white rounded-xl shadow-xs border border-gray-200 overflow-hidden">
            <div className="p-6 border-b border-gray-200 flex justify-between items-center">
                <div>
                    <h2 className="text-lg font-medium text-gray-900">Email Accounts</h2>
                    <p className="text-sm text-gray-500 mt-1">Manage SMTP and IMAP connections for sending and receiving emails.</p>
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
                                <div className="w-10 h-10 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center">
                                    <Mail size={20} />
                                </div>
                                <div>
                                    <h3 className="font-medium text-gray-900">{acc.name}</h3>
                                    <p className="text-sm text-gray-500">{acc.email} • {acc.type} • {acc.host}</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
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
