import { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { useAuth } from './AuthContext';

export interface Account {
    id: string;
    name: string;
    domain: string | null;
    currency: string;
    wooUrl: string;
    wooConsumerKey?: string;
    openRouterApiKey?: string;
    aiModel?: string;
    embeddingModel?: string;
    appearance?: {
        logoUrl?: string;
        primaryColor?: string;
        appName?: string;
    };
    goldPrice?: number;
    goldPriceCurrency?: string;
    goldPrice18ct?: number;
    goldPrice9ct?: number;
    goldPrice18ctWhite?: number;
    goldPrice9ctWhite?: number;
    goldPriceMargin?: number;
    features?: { featureKey: string; isEnabled: boolean }[];
    weightUnit?: string;
    dimensionUnit?: string;
}

interface AccountContextType {
    accounts: Account[];
    currentAccount: Account | null;
    isLoading: boolean;
    refreshAccounts: () => Promise<void>;
    setCurrentAccount: (account: Account) => void;
}

const AccountContext = createContext<AccountContextType | undefined>(undefined);

export function AccountProvider({ children }: { children: ReactNode }) {
    const { token, isLoading: authLoading, logout, updateUser } = useAuth();
    const [accounts, setAccounts] = useState<Account[]>([]);
    const [currentAccount, setCurrentAccount] = useState<Account | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    const refreshAccounts = useCallback(async () => {
        if (!token) {
            setAccounts([]);
            setCurrentAccount(null);
            setIsLoading(false);
            return;
        }

        try {
            const response = await fetch('/api/accounts', {
                headers: { Authorization: `Bearer ${token}` }
            });

            // Handle expired token - force logout to redirect to login (not wizard)
            if (response.status === 401) {
                logout();
                return;
            }

            if (response.ok) {
                const data = await response.json();
                setAccounts(data);

                // Try to find the account we should show:
                // 1. The account saved in localStorage (if we just reloaded the page)
                // 2. The first account in the list (fallback)
                // Note: We use functional update to avoid stale closure while preventing infinite loops
                setCurrentAccount(prev => {
                    const savedId = localStorage.getItem('selectedAccountId');
                    const targetId = prev?.id || savedId;
                    const accountToSelect = data.find((a: Account) => a.id === targetId) || (data.length > 0 ? data[0] : null);
                    return accountToSelect;
                });
            }
        } catch (error) {
            console.error('Failed to fetch accounts', error);
        } finally {
            setIsLoading(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token, logout]);

    // Persist selection to localStorage whenever it changes
    useEffect(() => {
        if (currentAccount?.id) {
            localStorage.setItem('selectedAccountId', currentAccount.id);

            // Fetch updated user permissions for this account context
            fetch('/api/auth/me', {
                headers: {
                    Authorization: `Bearer ${token}`,
                    'x-account-id': currentAccount.id
                }
            })
                .then(res => res.ok ? res.json() : null)
                .then(userData => {
                    if (userData) {
                        updateUser(userData);
                    }
                })
                .catch(console.error);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentAccount?.id, token]);

    useEffect(() => {
        // Don't fetch accounts until auth has finished loading
        // This prevents the race condition where we see no token during initial hydration
        if (authLoading) {
            return;
        }
        refreshAccounts();
    }, [token, authLoading, refreshAccounts]);

    // isLoading should be true if either auth is loading or accounts are loading
    const effectiveLoading = authLoading || isLoading;

    return (
        <AccountContext.Provider value={{ accounts, currentAccount, isLoading: effectiveLoading, refreshAccounts, setCurrentAccount }}>
            {children}
        </AccountContext.Provider>
    );
}

export function useAccount() {
    const context = useContext(AccountContext);
    if (context === undefined) {
        throw new Error('useAccount must be used within an AccountProvider');
    }
    return context;
}
