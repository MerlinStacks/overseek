import { createContext, useContext, useState, useEffect, ReactNode, useCallback, useRef } from 'react';
import { Logger } from '../utils/logger';
/* eslint-disable react-refresh/only-export-components */

interface User {
    id: string;
    email: string;
    fullName: string | null;
    avatarUrl?: string | null;
    shiftStart?: string | null;
    shiftEnd?: string | null;
    emailSignature?: string | null;
    isSuperAdmin?: boolean;
}

interface AuthContextType {
    user: User | null;
    token: string | null;
    isLoading: boolean;
    login: (token: string, user: User, refreshToken?: string) => void;
    logout: () => void;
    updateUser: (user: User) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);
const REFRESH_RETRY_DELAY_MS = 30_000;
const REFRESH_LOCK_KEY = 'auth:refresh-lock';
const REFRESH_LOCK_TTL_MS = 15_000;
const REFRESH_WAIT_TIMEOUT_MS = 20_000;
const REFRESH_WAIT_POLL_MS = 250;

type SilentRefreshResult = 'success' | 'retryable_failure' | 'expired';

// EDGE CASE FIX: Parse JWT to get expiry time
function getTokenExpiry(token: string): number | null {
    try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        return payload.exp ? payload.exp * 1000 : null; // Convert to milliseconds
    } catch {
        return null;
    }
}

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [token, setToken] = useState<string | null>(localStorage.getItem('token'));
    const [isLoading, setIsLoading] = useState(true);
    const refreshTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const tabIdRef = useRef(
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
            ? crypto.randomUUID()
            : `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );

    const syncSessionFromStorage = useCallback((): boolean => {
        const storedToken = localStorage.getItem('token');
        const storedUser = localStorage.getItem('user');
        setToken(storedToken);
        setUser(storedUser ? JSON.parse(storedUser) : null);
        return Boolean(storedToken && storedUser);
    }, []);

    const clearSession = useCallback(() => {
        localStorage.removeItem('token');
        localStorage.removeItem('refreshToken');
        localStorage.removeItem('user');
        setToken(null);
        setUser(null);
    }, []);

    const acquireRefreshLock = useCallback((): boolean => {
        try {
            const now = Date.now();
            const rawLock = localStorage.getItem(REFRESH_LOCK_KEY);
            if (rawLock) {
                const parsedLock = JSON.parse(rawLock) as { owner: string; expiresAt: number };
                if (parsedLock.expiresAt > now && parsedLock.owner !== tabIdRef.current) {
                    return false;
                }
            }

            const nextLock = JSON.stringify({
                owner: tabIdRef.current,
                expiresAt: now + REFRESH_LOCK_TTL_MS,
            });
            localStorage.setItem(REFRESH_LOCK_KEY, nextLock);

            const confirmedLock = localStorage.getItem(REFRESH_LOCK_KEY);
            if (!confirmedLock) {
                return false;
            }

            const parsedConfirmedLock = JSON.parse(confirmedLock) as { owner: string; expiresAt: number };
            return parsedConfirmedLock.owner === tabIdRef.current;
        } catch (error) {
            Logger.warn('[Auth] Failed to acquire refresh lock, proceeding without coordination', { error });
            return true;
        }
    }, []);

    const releaseRefreshLock = useCallback(() => {
        try {
            const rawLock = localStorage.getItem(REFRESH_LOCK_KEY);
            if (!rawLock) {
                return;
            }

            const parsedLock = JSON.parse(rawLock) as { owner: string; expiresAt: number };
            if (parsedLock.owner === tabIdRef.current) {
                localStorage.removeItem(REFRESH_LOCK_KEY);
            }
        } catch (error) {
            Logger.warn('[Auth] Failed to release refresh lock', { error });
        }
    }, []);

    const waitForRefreshFromAnotherTab = useCallback(async (staleRefreshToken: string): Promise<SilentRefreshResult> => {
        const startedAt = Date.now();

        while (Date.now() - startedAt < REFRESH_WAIT_TIMEOUT_MS) {
            await new Promise(resolve => setTimeout(resolve, REFRESH_WAIT_POLL_MS));

            const latestRefreshToken = localStorage.getItem('refreshToken');
            if (latestRefreshToken && latestRefreshToken !== staleRefreshToken) {
                Logger.info('[Auth] Adopted refreshed session from another tab');
                return syncSessionFromStorage() ? 'success' : 'retryable_failure';
            }
        }

        Logger.warn('[Auth] Timed out waiting for another tab to refresh the session');
        return 'retryable_failure';
    }, [syncSessionFromStorage]);

    // EDGE CASE FIX: Silent refresh function
    const silentRefresh = useCallback(async (): Promise<SilentRefreshResult> => {
        const refreshToken = localStorage.getItem('refreshToken');
        if (!refreshToken) {
            Logger.warn('[Auth] No refresh token available for silent refresh');
            return 'expired';
        }

        if (!acquireRefreshLock()) {
            Logger.info('[Auth] Another tab is already refreshing the session');
            return waitForRefreshFromAnotherTab(refreshToken);
        }

        try {
            const response = await fetch('/api/auth/refresh', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ refreshToken })
            });

            if (!response.ok) {
                if (response.status === 401) {
                    const latestRefreshToken = localStorage.getItem('refreshToken');
                    if (latestRefreshToken && latestRefreshToken !== refreshToken) {
                        Logger.info('[Auth] Refresh token rotated by another tab during refresh');
                        return syncSessionFromStorage() ? 'success' : 'retryable_failure';
                    }

                    Logger.warn('[Auth] Silent refresh rejected, clearing session');
                    // Token is invalid/expired - force logout
                    clearSession();
                    return 'expired';
                }

                Logger.warn('[Auth] Silent refresh hit a transient failure', {
                    status: response.status,
                });
                return 'retryable_failure';
            }

            const data = await response.json();
            localStorage.setItem('token', data.accessToken);
            localStorage.setItem('refreshToken', data.refreshToken);
            setToken(data.accessToken);
            Logger.info('[Auth] Silent refresh successful');
            return 'success';
        } catch (error) {
            Logger.error('[Auth] Silent refresh error', { error });
            return 'retryable_failure';
        } finally {
            releaseRefreshLock();
        }
    }, [acquireRefreshLock, clearSession, releaseRefreshLock, syncSessionFromStorage, waitForRefreshFromAnotherTab]);

    // EDGE CASE FIX: Schedule next refresh before token expires
    const scheduleRefresh = useCallback((accessToken: string, overrideDelayMs?: number) => {
        // Clear any existing timeout
        if (refreshTimeoutRef.current) {
            clearTimeout(refreshTimeoutRef.current);
        }

        const expiry = getTokenExpiry(accessToken);
        if (!expiry) return;

        // Refresh 1 minute before expiry (or immediately if less than 1 min left)
        const refreshIn = overrideDelayMs ?? Math.max(expiry - Date.now() - 60000, 0);

        Logger.info(`[Auth] Token expires in ${Math.round((expiry - Date.now()) / 1000)}s, scheduling refresh in ${Math.round(refreshIn / 1000)}s`);

        refreshTimeoutRef.current = setTimeout(async () => {
            const result = await silentRefresh();
            if (result === 'retryable_failure') {
                const latestToken = localStorage.getItem('token');
                const latestExpiry = latestToken ? getTokenExpiry(latestToken) : null;
                if (latestToken && latestExpiry && latestExpiry > Date.now()) {
                    Logger.info('[Auth] Retrying silent refresh after transient failure');
                    scheduleRefresh(latestToken, Math.min(
                        REFRESH_RETRY_DELAY_MS,
                        Math.max(latestExpiry - Date.now(), 0)
                    ));
                }
            }
            if (result === 'success') {
                // Next schedule is handled by token state update.
            }
        }, refreshIn);
    }, [silentRefresh]);

    useEffect(() => {
        // Basic verification on load
        const storedToken = localStorage.getItem('token');
        const storedUser = localStorage.getItem('user');
        const storedRefreshToken = localStorage.getItem('refreshToken');

        // Defer state updates to avoid cascading renders
        const timeoutId = setTimeout(async () => {
            if (storedToken && storedUser) {
                // Check if token is expired or about to expire
                const expiry = getTokenExpiry(storedToken);
                const isExpired = expiry && expiry < Date.now();
                const isExpiringSoon = expiry && expiry < Date.now() + 60000; // Within 1 minute

                if (isExpired || isExpiringSoon) {
                    // Try to refresh immediately
                    if (storedRefreshToken) {
                        const refreshed = await silentRefresh();
                        if (refreshed === 'success') {
                            const newToken = localStorage.getItem('token');
                            setToken(newToken);
                            setUser(JSON.parse(storedUser));
                            if (newToken) scheduleRefresh(newToken);
                        } else if (refreshed === 'retryable_failure') {
                            setToken(storedToken);
                            setUser(JSON.parse(storedUser));
                            scheduleRefresh(storedToken, REFRESH_RETRY_DELAY_MS);
                        }
                    }
                } else {
                    setToken(storedToken);
                    setUser(JSON.parse(storedUser));
                    scheduleRefresh(storedToken);
                }
            }
            setIsLoading(false);
        }, 0);

        return () => {
            clearTimeout(timeoutId);
            if (refreshTimeoutRef.current) {
                clearTimeout(refreshTimeoutRef.current);
            }
        };
    }, [silentRefresh, scheduleRefresh]);

    useEffect(() => {
        if (!token) {
            if (refreshTimeoutRef.current) {
                clearTimeout(refreshTimeoutRef.current);
            }
            return;
        }
        scheduleRefresh(token);
    }, [token, scheduleRefresh]);

    useEffect(() => {
        const handleStorage = (event: StorageEvent) => {
            if (!['token', 'user', 'refreshToken'].includes(event.key || '')) {
                return;
            }

            const storedToken = localStorage.getItem('token');
            const storedUser = localStorage.getItem('user');
            setToken(storedToken);
            setUser(storedUser ? JSON.parse(storedUser) : null);
        };

        window.addEventListener('storage', handleStorage);
        return () => window.removeEventListener('storage', handleStorage);
    }, []);

    const login = (newToken: string, newUser: User, refreshToken?: string) => {
        localStorage.setItem('token', newToken);
        localStorage.setItem('user', JSON.stringify(newUser));
        if (refreshToken) {
            localStorage.setItem('refreshToken', refreshToken);
        }
        setToken(newToken);
        setUser(newUser);
    };

    const logout = () => {
        // Clear refresh timeout
        if (refreshTimeoutRef.current) {
            clearTimeout(refreshTimeoutRef.current);
        }
        releaseRefreshLock();
        clearSession();
    };

    const updateUser = (updatedUser: User) => {
        // Merge with existing user to keep fields not present in update if any
        const newUser = { ...user, ...updatedUser };
        setUser(newUser);
        localStorage.setItem('user', JSON.stringify(newUser));
    };

    return (
        <AuthContext.Provider value={{ user, token, isLoading, login, logout, updateUser }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
}

