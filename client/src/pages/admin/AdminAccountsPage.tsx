import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { useNavigate } from 'react-router-dom';
import { Shield, LogIn, Check, X, Settings } from 'lucide-react';
import { cn } from '../../utils/cn';

interface Account {
    id: string;
    name: string;
    domain: string | null;
    createdAt: string;
    _count: { users: number };
    features: AccountFeature[];
    users?: { userId: string, role: string }[]; // We might need to fetch users separately or include them if needed for impersonation
}

interface AccountFeature {
    id: string;
    featureKey: string;
    isEnabled: boolean;
}

const KNOWN_FEATURES = ['META_ADS', 'GOOGLE_ADS', 'ADVANCED_REPORTS', 'AI_WRITER', 'GOLD_PRICE_CALCULATOR'];

export function AdminAccountsPage() {
    const { token, login } = useAuth();
    const { currentAccount, refreshAccounts } = useAccount();
    const navigate = useNavigate();
    const [accounts, setAccounts] = useState<Account[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedAccount, setSelectedAccount] = useState<Account | null>(null); // For feature modal

    const fetchAccounts = () => {
        fetch('/api/admin/accounts', {
            headers: { Authorization: `Bearer ${token}` }
        })
            .then(res => res.json())
            .then(data => {
                setAccounts(data);
                setLoading(false);
            })
            .catch(err => {
                console.error(err);
                setLoading(false);
            });
    };

    useEffect(() => {
        fetchAccounts();
    }, [token]);

    const handleImpersonate = async (accountId: string) => {
        // First we need to find the OWNER of the account to impersonate
        // The /accounts endpoint includes `_count`, but maybe we should include `users` to find the owner?
        // Let's just fetch users for this account quickly
        try {
            const usersRes = await fetch(`/api/accounts/${accountId}/users`, { // This endpoint allows finding users
                headers: { Authorization: `Bearer ${token}` }
            });
            const users = await usersRes.json();

            // Just pick the first element (likely owner or first staff) for demo
            // In a real app we'd let admin pick WHICH user to impersonate
            if (!users || users.length === 0) {
                alert('No users found in this account');
                return;
            }

            const targetUser = users[0].user; // Assuming structure from account.ts: include: { user: ... }

            if (!confirm(`Impersonate ${targetUser.fullName || targetUser.email}?`)) return;

            const res = await fetch('/api/admin/impersonate', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({ targetUserId: targetUser.id })
            });

            const data = await res.json();
            if (data.token) {
                login(data.token, data.user);
                navigate('/');
            } else {
                alert('Impersonation failed: ' + data.error);
            }
        } catch (e) {
            console.error(e);
            alert('Failed to start impersonation');
        }
    };

    const toggleFeature = async (accountId: string, featureKey: string, currentValue: boolean) => {
        try {
            const res = await fetch(`/api/admin/accounts/${accountId}/toggle-feature`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({ featureKey, isEnabled: !currentValue })
            });

            if (res.ok) {
                // Update local state
                setAccounts(prev => prev.map(acc => {
                    if (acc.id !== accountId) return acc;

                    const existingFeatureIndex = acc.features.findIndex(f => f.featureKey === featureKey);
                    let newFeatures = [...acc.features];

                    if (existingFeatureIndex >= 0) {
                        newFeatures[existingFeatureIndex].isEnabled = !currentValue;
                    } else {
                        newFeatures.push({ id: 'temp', featureKey, isEnabled: !currentValue });
                    }
                    return { ...acc, features: newFeatures };
                }));
                if (currentAccount && currentAccount.id === accountId) {
                    refreshAccounts();
                }
            }
        } catch (e) {
            console.error(e);
        }
    };

    if (loading) return <div>Loading accounts...</div>;

    return (
        <div className="space-y-6">
            <h1 className="text-2xl font-bold text-slate-800">Manage Accounts</h1>

            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 border-b border-slate-100 uppercase text-xs text-slate-500 font-medium">
                        <tr>
                            <th className="p-4">Account Name</th>
                            <th className="p-4">Domain</th>
                            <th className="p-4">Users</th>
                            <th className="p-4">Features</th>
                            <th className="p-4 text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {accounts.map(account => (
                            <tr key={account.id} className="hover:bg-slate-50/50">
                                <td className="p-4 font-medium text-slate-900">{account.name}</td>
                                <td className="p-4 text-slate-500">{account.domain || '-'}</td>
                                <td className="p-4 text-slate-500">{account._count.users}</td>
                                <td className="p-4">
                                    <div className="flex gap-1 flex-wrap">
                                        {KNOWN_FEATURES.map(key => {
                                            const isEnabled = account.features.find(f => f.featureKey === key)?.isEnabled;
                                            return (
                                                <button
                                                    key={key}
                                                    onClick={() => toggleFeature(account.id, key, !!isEnabled)}
                                                    className={cn(
                                                        "px-2 py-1 rounded text-xs transition-colors border",
                                                        isEnabled
                                                            ? "bg-green-50 text-green-700 border-green-200 hover:bg-green-100"
                                                            : "bg-slate-50 text-slate-400 border-slate-200 hover:bg-slate-100 hover:text-slate-600"
                                                    )}
                                                    title={`Toggle ${key}`}
                                                >
                                                    {key.split('_')[0]}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </td>
                                <td className="p-4 text-right">
                                    <button
                                        onClick={() => handleImpersonate(account.id)}
                                        className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors"
                                    >
                                        <LogIn size={14} />
                                        Impersonate
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
