import { createContext, useContext, useState, useEffect, ReactNode, useCallback, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Logger } from '../utils/logger';
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
    revenueTaxInclusive?: boolean;
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
    const { token, user, isLoading: authLoading, logout, updateUser } = useAuth();
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

        // Re-raise the loading gate so guards (e.g. AccountGuard) don't
        // see accounts=[] + isLoading=false while we fetch.
        setIsLoading(true);

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
            Logger.error('Failed to fetch accounts', { error: error });
        } finally {
            setIsLoading(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token, logout]);

    // Persist selection to localStorage whenever it changes
    useEffect(() => {
        if (currentAccount?.id) {
            localStorage.setItem('selectedAccountId', currentAccount.id);
        }
    }, [currentAccount?.id]);

    /** Why React Query: The raw fetch('/api/auth/me') on account switch was
     *  unmanaged — no abort, no dedup, no cache. RQ gives all three for free,
     *  keyed by accountId so switching back to a previous account is instant. */
    const userRef = useRef(user);
    userRef.current = user;

    useQuery({
        queryKey: ['user-permissions', currentAccount?.id],
        queryFn: async () => {
            const res = await fetch('/api/auth/me', {
                headers: {
                    Authorization: `Bearer ${token}`,
                    'x-account-id': currentAccount!.id
                }
            });
            if (!res.ok) return null;
            return res.json();
        },
        enabled: !!currentAccount?.id && !!token,
        staleTime: 5 * 60 * 1000,
        select: (userData) => {
            if (userData) {
                const currentUser = userRef.current;
                const changed = !currentUser ||
                    currentUser.isSuperAdmin !== userData.isSuperAdmin ||
                    currentUser.fullName !== userData.fullName ||
                    currentUser.avatarUrl !== userData.avatarUrl ||
                    currentUser.email !== userData.email;
                if (changed) {
                    updateUser(userData);
                }
            }
            return userData;
        },
    });

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
