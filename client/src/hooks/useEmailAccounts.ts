/**
 * useEmailAccounts - Manages email account selection for outbound messages
 * 
 * Fetches available email accounts and tracks selected account.
 * Extracted from ChatWindow.tsx for improved modularity.
 */

import { useState, useEffect, useMemo } from 'react';
import { Logger } from '../utils/logger';
import { useAuth } from '../context/AuthContext';
import { useAccount } from '../context/AccountContext';

interface EmailAccount {
    id: string;
    name: string;
    email: string;
    isDefault?: boolean;
}

interface UseEmailAccountsResult {
    emailAccounts: EmailAccount[];
    selectedEmailAccountId: string;
    setSelectedEmailAccountId: (id: string) => void;
}

/**
 * Fetches and manages email accounts for outbound message sending.
 */
export function useEmailAccounts(): UseEmailAccountsResult {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const accountId = currentAccount?.id;
    const scope = useMemo(() => ({ accountId, token }), [accountId, token]);
    const [result, setResult] = useState<{ scope: typeof scope; accounts: EmailAccount[]; selected: string } | null>(null);

    useEffect(() => {
        const { accountId, token } = scope;
        if (!accountId || !token) return;
        const controller = new AbortController();

        const fetchEmailAccounts = async () => {
            try {
                const res = await fetch('/api/chat/email-accounts', {
                    signal: controller.signal,
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'x-account-id': accountId
                    }
                });
                if (!res.ok) throw new Error('Failed to load email accounts');
                const data: unknown = await res.json();
                if (!Array.isArray(data) || !data.every(account => account && typeof account.id === 'string' && typeof account.name === 'string' && typeof account.email === 'string')) throw new Error('Invalid email accounts response');
                if (controller.signal.aborted) return;
                const accounts = data as EmailAccount[];
                const selected = accounts.find(account => account.isDefault) || accounts[0];
                setResult({ scope, accounts, selected: selected?.id || '' });
            } catch (err) {
                if (controller.signal.aborted) return;
                setResult({ scope, accounts: [], selected: '' });
                Logger.error('Failed to fetch email accounts', { error: err });
            }
        };

        fetchEmailAccounts();
        return () => controller.abort();
    }, [scope]);

    const visible = result?.scope === scope && scope.accountId && scope.token ? result : null;
    const setSelectedEmailAccountId = (id: string) => {
        setResult(previous => previous?.scope === scope && (id === '' || previous.accounts.some(account => account.id === id))
            ? { ...previous, selected: id }
            : previous);
    };

    return {
        emailAccounts: visible?.accounts || [],
        selectedEmailAccountId: visible?.selected || '',
        setSelectedEmailAccountId
    };
}
