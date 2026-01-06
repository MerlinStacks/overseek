import { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { EmailAccountForm, type EmailAccount } from './EmailAccountForm';
import { EmailAccountList } from './EmailAccountList';

export function EmailSettings() {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [accounts, setAccounts] = useState<EmailAccount[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [isTesting, setIsTesting] = useState(false);
    const [testResult, setTestResult] = useState<{ success: boolean; message?: string } | null>(null);

    const [editingAccount, setEditingAccount] = useState<Partial<EmailAccount> | null>(null);

    useEffect(() => {
        if (currentAccount && token) {
            fetchAccounts();
        }
    }, [currentAccount, token]);

    const fetchAccounts = async () => {
        if (!currentAccount) return;
        try {
            const res = await fetch('/api/email/accounts', {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount.id
                }
            });
            if (res.ok) {
                const data = await res.json();
                setAccounts(data);
            }
        } catch (error) {
            console.error(error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleSave = async (accountData: Partial<EmailAccount>) => {
        if (!currentAccount || !token) return;
        setIsSaving(true);
        setTestResult(null);

        try {
            const method = accountData.id ? 'PUT' : 'POST';
            const url = accountData.id
                ? `/api/email/accounts/${accountData.id}`
                : '/api/email/accounts';

            const res = await fetch(url, {
                method,
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount.id
                },
                body: JSON.stringify(accountData)
            });

            if (!res.ok) throw new Error('Failed to save account');

            await fetchAccounts();
            setEditingAccount(null);
        } catch (error) {
            console.error(error);
            alert('Failed to save account');
        } finally {
            setIsSaving(false);
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Are you sure you want to delete this account?')) return;
        if (!currentAccount) return;

        try {
            await fetch(`/api/email/accounts/${id}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount.id
                }
            });
            setAccounts(accounts.filter(a => a.id !== id));
        } catch (error) {
            console.error(error);
            alert('Failed to delete account');
        }
    };

    const handleTestConnection = async (accountData: Partial<EmailAccount>) => {
        setIsTesting(true);
        setTestResult(null);

        try {
            const res = await fetch('/api/email/test', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount.id
                },
                body: JSON.stringify(accountData)
            });

            const data = await res.json();
            const result = { success: data.success, message: data.error };
            setTestResult(result);
            return result;
        } catch (error) {
            const result = { success: false, message: 'Network error' };
            setTestResult(result);
            return result;
        } finally {
            setIsTesting(false);
        }
    };

    if (isLoading) return <div>Loading...</div>;

    return (
        <div className="space-y-6">
            {!editingAccount && (
                <EmailAccountList
                    accounts={accounts}
                    onEdit={setEditingAccount}
                    onDelete={handleDelete}
                    onAdd={() => setEditingAccount({ type: 'SMTP', port: 587, isSecure: true })}
                />
            )}

            {editingAccount && (
                <EmailAccountForm
                    initialData={editingAccount}
                    onSave={handleSave}
                    onCancel={() => setEditingAccount(null)}
                    onTest={handleTestConnection}
                    isSaving={isSaving}
                    isTesting={isTesting}
                    testResult={testResult}
                />
            )}
        </div>
    );
}
