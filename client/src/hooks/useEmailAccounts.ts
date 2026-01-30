/**
 * useEmailAccounts - Manages email account selection for outbound messages
 * 
 * Fetches available email accounts and tracks selected account.
 * Extracted from ChatWindow.tsx for improved modularity.
 */

import { useState, useEffect } from 'react';
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
    const [emailAccounts, setEmailAccounts] = useState<EmailAccount[]>([]);
    const [selectedEmailAccountId, setSelectedEmailAccountId] = useState<string>('');

    useEffect(() => {
        if (!currentAccount || !token) return;

        const fetchEmailAccounts = async () => {
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
                    // Set default selection to first account or the default one
                    if (accounts.length > 0) {
                        const defaultAccount = accounts.find((a: EmailAccount) => a.isDefault) || accounts[0];
                        setSelectedEmailAccountId(defaultAccount.id);
                    }
                }
            } catch (err) {
                Logger.error('Failed to fetch email accounts', { error: err });
            }
        };

        fetchEmailAccounts();
    }, [currentAccount, token]);

    return {
        emailAccounts,
        selectedEmailAccountId,
        setSelectedEmailAccountId
    };
}
