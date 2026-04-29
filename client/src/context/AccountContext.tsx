import { createContext, useContext, useState, useEffect, ReactNode, useCallback, useRef, useMemo } from 'react';
import { Logger } from '../utils/logger';
import { useAuth } from './AuthContext';
/* eslint-disable react-refresh/only-export-components */

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
    /** Resolved permissions for the current user+account, sourced from /me */
    activePermissions: Record<string, boolean>;
}

const AccountContext = createContext<AccountContextType | undefined>(undefined);

const EMPTY_PERMISSIONS: Record<string, boolean> = Object.freeze({});

interface AccountMeData {
    id: string;
    email: string;
    fullName: string | null;
    avatarUrl?: string | null;
    isSuperAdmin?: boolean;
    permissions?: Record<string, boolean>;
    [key: string]: unknown;
}

export function AccountProvider({ children }: { children: ReactNode }) {
    const { token, user, isLoading: authLoading, logout, updateUser } = useAuth();
    const [accounts, setAccounts] = useState<Account[]>([]);
    const [currentAccount, setCurrentAccount] = useState<Account | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [meData, setMeData] = useState<AccountMeData | null>(null);

    const userRef = useRef(user);
    userRef.current = user;

    const permissionsCacheRef = useRef<Map<string, { data: AccountMeData; updatedAt: number }>>(new Map());

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
            let response = await fetch('/api/accounts', {
                headers: { Authorization: `Bearer ${token}` }
            });

            // A refresh may have completed in another tab after this request started.
            // Retry once with the latest token before concluding the session is invalid.
            if (response.status === 401) {
                const latestToken = localStorage.getItem('token');
                if (latestToken && latestToken !== token) {
                    response = await fetch('/api/accounts', {
                        headers: { Authorization: `Bearer ${latestToken}` }
                    });
                }

                if (response.status === 401) {
                    logout();
                    return;
                }
            }

            if (response.ok) {
                const data: Account[] = await response.json();
                // Why: preserve array identity when contents are unchanged so downstream
                // useEffect([accounts]) hooks don't re-fire on silent token refresh.
                setAccounts(prev => JSON.stringify(prev) === JSON.stringify(data) ? prev : data);

                // Try to find the account we should show:
                // 1. The account saved in localStorage (if we just reloaded the page)
                // 2. The first account in the list (fallback)
                // Note: We use functional update to avoid stale closure while preventing infinite loops
                setCurrentAccount(prev => {
                    const savedId = localStorage.getItem('selectedAccountId');
                    const targetId = prev?.id || savedId;
                    const accountToSelect = data.find((a: Account) => a.id === targetId) || (data.length > 0 ? data[0] : null);
                    // Why: preserve object identity when the selected account is structurally
                    // unchanged. Prevents ~40 downstream useEffect([currentAccount]) hooks
                    // from refetching (and clobbering in-progress form edits) on every
                    // silent token refresh.
                    if (prev && accountToSelect && prev.id === accountToSelect.id &&
                        JSON.stringify(prev) === JSON.stringify(accountToSelect)) {
                        return prev;
                    }
                    return accountToSelect;
                });
            }
        } catch (error) {
            Logger.error('Failed to fetch accounts', { error: error });
        } finally {
            setIsLoading(false);
        }
    }, [token, logout]);

    // Persist selection to localStorage whenever it changes
    useEffect(() => {
        if (currentAccount?.id) {
            localStorage.setItem('selectedAccountId', currentAccount.id);
        }
    }, [currentAccount?.id]);

    useEffect(() => {
        const accountId = currentAccount?.id;
        if (!accountId || !token) {
            setMeData(null);
            return;
        }

        const cached = permissionsCacheRef.current.get(accountId);
        const isFresh = cached && (Date.now() - cached.updatedAt) < 5 * 60 * 1000;
        if (isFresh) {
            setMeData(cached.data);
        }

        const controller = new AbortController();

        const loadMe = async () => {
            try {
                const res = await fetch('/api/auth/me', {
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'x-account-id': accountId,
                    },
                    signal: controller.signal,
                });
                if (!res.ok) return;

                const userData = await res.json() as AccountMeData;
                permissionsCacheRef.current.set(accountId, { data: userData, updatedAt: Date.now() });
                setMeData(userData);

                const currentUser = userRef.current;
                const changed = !currentUser ||
                    currentUser.isSuperAdmin !== userData.isSuperAdmin ||
                    currentUser.fullName !== userData.fullName ||
                    currentUser.avatarUrl !== userData.avatarUrl ||
                    currentUser.email !== userData.email;
                if (changed) {
                    updateUser(userData);
                }
            } catch (error) {
                if ((error as Error).name === 'AbortError') return;
                Logger.error('Failed to fetch user permissions', { error });
            }
        };

        loadMe();

        return () => controller.abort();
    }, [currentAccount?.id, token, updateUser]);

    useEffect(() => {
        // Don't fetch accounts until auth has finished loading
        // This prevents the race condition where we see no token during initial hydration
        if (authLoading) {
            return;
        }
        refreshAccounts();
    }, [token, authLoading, refreshAccounts]);

    useEffect(() => {
        const handleStorage = (event: StorageEvent) => {
            if (event.key !== 'selectedAccountId') {
                return;
            }

            const selectedId = event.newValue;
            if (!selectedId) {
                return;
            }

            setCurrentAccount((prev) => {
                if (prev?.id === selectedId) {
                    return prev;
                }

                return accounts.find((account) => account.id === selectedId) || prev;
            });
        };

        window.addEventListener('storage', handleStorage);
        return () => window.removeEventListener('storage', handleStorage);
    }, [accounts]);

    // isLoading should be true if either auth is loading or accounts are loading
    const effectiveLoading = authLoading || isLoading;

    // Why: stable empty-object fallback so the useMemo below isn't invalidated
    // every render when there are no permissions yet.
    const activePermissions: Record<string, boolean> = useMemo(
        () => (meData?.permissions as Record<string, boolean>) ?? EMPTY_PERMISSIONS,
        [meData?.permissions]
    );

    // Why: memoize the context value so consumers don't re-render on every parent
    // render (e.g. when AuthContext silently refreshes the token). Combined with
    // the identity-preserving updates above, this stops the cascade that wipes
    // in-progress form edits.
    const value = useMemo(() => ({
        accounts,
        currentAccount,
        isLoading: effectiveLoading,
        refreshAccounts,
        setCurrentAccount,
        activePermissions,
    }), [accounts, currentAccount, effectiveLoading, refreshAccounts, activePermissions]);

    return (
        <AccountContext.Provider value={value}>
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
