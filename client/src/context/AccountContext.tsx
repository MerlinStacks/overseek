import { createContext, useContext, useState, useEffect, ReactNode, useCallback, useRef, useMemo } from 'react';
import { Logger } from '../utils/logger';
import { useAuth } from './AuthContext';
import { api } from '../services/api';
/* eslint-disable react-refresh/only-export-components */

interface Account {
    id: string;
    name: string;
    domain: string | null;
    sitemapUrl?: string | null;
    currency: string;
    wooUrl: string;
    wooCredentialsConfigured?: boolean;
    webhookSecretConfigured?: boolean;
    openRouterApiKeyConfigured?: boolean;
    aiModel?: string;
    embeddingModel?: string;
    appearance?: {
        logoUrl?: string;
        primaryColor?: string;
        appName?: string;
        socialLinks?: Array<{ label: string; href: string }>;
        emailFooterHtml?: string;
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
    timezone?: string;
    autoSendInvoiceOnNewOrder?: boolean;
    invoiceRecipientEmail?: string | null;
    subscribeNewCustomersByDefault?: boolean;
}

interface AccountContextType {
    accounts: Account[];
    currentAccount: Account | null;
    isLoading: boolean;
    loadError: string | null;
    hasLoaded: boolean;
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
    emailSignature?: string | null;
    fullName: string | null;
    avatarUrl?: string | null;
    isSuperAdmin?: boolean;
    permissions?: Record<string, boolean>;
    [key: string]: unknown;
}

export function AccountProvider({ children }: { children: ReactNode }) {
    const { token, user, isLoading: authLoading, updateUser } = useAuth();
    const [accounts, setAccounts] = useState<Account[]>([]);
    const [currentAccount, setCurrentAccount] = useState<Account | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [meData, setMeData] = useState<AccountMeData | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [hasLoaded, setHasLoaded] = useState(false);
    const loadVersionRef = useRef(0);
    const ownerRef = useRef(user?.id);
    ownerRef.current = user?.id;
    const [loadedOwner, setLoadedOwner] = useState(user?.id);

    const userRef = useRef(user);
    userRef.current = user;
    const accountsRef = useRef(accounts);
    accountsRef.current = accounts;
    const currentAccountRef = useRef(currentAccount);
    currentAccountRef.current = currentAccount;

    const permissionsCacheRef = useRef<Map<string, { data: AccountMeData; updatedAt: number }>>(new Map());

    useEffect(() => {
        setLoadedOwner(user?.id);
        setAccounts([]);
        setCurrentAccount(null);
        setMeData(null);
        setHasLoaded(false);
        setLoadError(null);
        setIsLoading(true);
        accountsRef.current = [];
        currentAccountRef.current = null;
        permissionsCacheRef.current.clear();
    }, [user?.id]);

    const refreshAccounts = useCallback(async () => {
        const version = ++loadVersionRef.current;
        const owner = ownerRef.current;
        const isCurrent = () => version === loadVersionRef.current && owner === ownerRef.current;
        setLoadError(null);
        if (!token) {
            setAccounts([]);
            setCurrentAccount(null);
            setIsLoading(false);
            setHasLoaded(false);
            setMeData(null);
            permissionsCacheRef.current.clear();
            return;
        }

        // Only raise the loading gate during initial hydration.
        // On background refreshes (for example after silent auth refresh),
        // flipping this to true unmounts guarded pages and can collapse
        // in-progress editors.
        if (accountsRef.current.length === 0 && !currentAccountRef.current) {
            setIsLoading(true);
        }

        try {
            const data = await api.get<Account[]>('/api/accounts', token);
            if (!isCurrent()) return;
            if (!Array.isArray(data)) throw new Error('Invalid accounts response');
            setHasLoaded(true);
            // Preserve identities so silent token refresh does not reset in-progress editors.
            setAccounts(prev => JSON.stringify(prev) === JSON.stringify(data) ? prev : data);
            setCurrentAccount(prev => {
                const savedId = localStorage.getItem('selectedAccountId');
                const targetId = prev?.id || savedId;
                const accountToSelect = data.find(a => a.id === targetId) || data[0] || null;
                if (prev && accountToSelect && prev.id === accountToSelect.id &&
                    JSON.stringify(prev) === JSON.stringify(accountToSelect)) {
                    return prev;
                }
                return accountToSelect;
            });
        } catch (error) {
            if (!isCurrent()) return;
            setLoadError('Unable to load your accounts. Please try again.');
            Logger.error('Failed to fetch accounts', { error: error });
        } finally {
            if (isCurrent()) setIsLoading(false);
        }
    }, [token]);

    // Persist selection to localStorage whenever it changes
    useEffect(() => {
        if (currentAccount?.id) {
            localStorage.setItem('selectedAccountId', currentAccount.id);
        }
    }, [currentAccount?.id]);

    useEffect(() => {
        const accountId = currentAccount?.id;
        if (!accountId || !token || loadedOwner !== user?.id) {
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
                const userData = await api.request<AccountMeData>('/api/auth/me', {
                    token,
                    accountId,
                    signal: controller.signal,
                });
                if (controller.signal.aborted) return;
                permissionsCacheRef.current.set(accountId, { data: userData, updatedAt: Date.now() });
                setMeData(userData);

                const currentUser = userRef.current;
                const changed = !currentUser ||
                    currentUser.isSuperAdmin !== userData.isSuperAdmin ||
                    currentUser.fullName !== userData.fullName ||
                    currentUser.avatarUrl !== userData.avatarUrl ||
                    currentUser.email !== userData.email ||
                    currentUser.emailSignature !== userData.emailSignature;
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
    }, [currentAccount?.id, token, loadedOwner, user?.id, updateUser]);

    useEffect(() => {
        // Don't fetch accounts until auth has finished loading
        // This prevents the race condition where we see no token during initial hydration
        if (authLoading) {
            return;
        }
        refreshAccounts();
        return () => { loadVersionRef.current++; };
    }, [token, user?.id, authLoading, refreshAccounts]);

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
    const effectiveLoading = authLoading || isLoading || loadedOwner !== user?.id;

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
        loadError,
        hasLoaded,
        refreshAccounts,
        setCurrentAccount,
        activePermissions,
    }), [accounts, currentAccount, effectiveLoading, loadError, hasLoaded, refreshAccounts, activePermissions]);

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
