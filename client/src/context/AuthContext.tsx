import { createContext, useContext, useState, useEffect, ReactNode, useCallback, useRef } from 'react';

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

    // EDGE CASE FIX: Silent refresh function
    const silentRefresh = useCallback(async () => {
        const refreshToken = localStorage.getItem('refreshToken');
        if (!refreshToken) {
            console.warn('[Auth] No refresh token available for silent refresh');
            return false;
        }

        try {
            const response = await fetch('/api/auth/refresh', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ refreshToken })
            });

            if (!response.ok) {
                console.warn('[Auth] Silent refresh failed, logging out');
                // Token is invalid/expired - force logout
                localStorage.removeItem('token');
                localStorage.removeItem('refreshToken');
                localStorage.removeItem('user');
                setToken(null);
                setUser(null);
                return false;
            }

            const data = await response.json();
            localStorage.setItem('token', data.accessToken);
            localStorage.setItem('refreshToken', data.refreshToken);
            setToken(data.accessToken);
            console.info('[Auth] Silent refresh successful');
            return true;
        } catch (error) {
            console.error('[Auth] Silent refresh error:', error);
            return false;
        }
    }, []);

    // EDGE CASE FIX: Schedule next refresh before token expires
    const scheduleRefresh = useCallback((accessToken: string) => {
        // Clear any existing timeout
        if (refreshTimeoutRef.current) {
            clearTimeout(refreshTimeoutRef.current);
        }

        const expiry = getTokenExpiry(accessToken);
        if (!expiry) return;

        // Refresh 1 minute before expiry (or immediately if less than 1 min left)
        const refreshIn = Math.max(expiry - Date.now() - 60000, 0);

        console.info(`[Auth] Token expires in ${Math.round((expiry - Date.now()) / 1000)}s, scheduling refresh in ${Math.round(refreshIn / 1000)}s`);

        refreshTimeoutRef.current = setTimeout(async () => {
            const success = await silentRefresh();
            if (success) {
                // Schedule next refresh with new token
                const newToken = localStorage.getItem('token');
                if (newToken) {
                    scheduleRefresh(newToken);
                }
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
                        if (refreshed) {
                            const newToken = localStorage.getItem('token');
                            setToken(newToken);
                            setUser(JSON.parse(storedUser));
                            if (newToken) scheduleRefresh(newToken);
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

    const login = (newToken: string, newUser: User, refreshToken?: string) => {
        localStorage.setItem('token', newToken);
        localStorage.setItem('user', JSON.stringify(newUser));
        if (refreshToken) {
            localStorage.setItem('refreshToken', refreshToken);
        }
        setToken(newToken);
        setUser(newUser);
        scheduleRefresh(newToken);
    };

    const logout = () => {
        // Clear refresh timeout
        if (refreshTimeoutRef.current) {
            clearTimeout(refreshTimeoutRef.current);
        }
        localStorage.removeItem('token');
        localStorage.removeItem('refreshToken');
        localStorage.removeItem('user');
        setToken(null);
        setUser(null);
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

