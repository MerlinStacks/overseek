/**
 * useLoadingTimeout Hook
 * 
 * EDGE CASE FIX: Handle skeleton infinite loading in offline mode.
 * Returns whether the loading timeout has been exceeded, suggesting
 * the user may be offline or experiencing connectivity issues.
 */

import { useState, useEffect } from 'react';

interface UseLoadingTimeoutOptions {
    /** Timeout in milliseconds before showing offline message (default: 10000ms) */
    timeoutMs?: number;
    /** Whether loading is currently active */
    isLoading: boolean;
}

interface UseLoadingTimeoutResult {
    /** Whether the timeout has been exceeded */
    hasTimedOut: boolean;
    /** Whether the browser reports being offline */
    isOffline: boolean;
    /** Human-readable message for the current state */
    message: string;
}

export function useLoadingTimeout({
    timeoutMs = 10000,
    isLoading
}: UseLoadingTimeoutOptions): UseLoadingTimeoutResult {
    const [hasTimedOut, setHasTimedOut] = useState(false);
    const [isOffline, setIsOffline] = useState(!navigator.onLine);

    // Track online/offline status
    useEffect(() => {
        const handleOnline = () => setIsOffline(false);
        const handleOffline = () => setIsOffline(true);

        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);

        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
        };
    }, []);

    // Start timeout when loading begins
    useEffect(() => {
        if (!isLoading) {
            setHasTimedOut(false);
            return;
        }

        const timer = setTimeout(() => {
            setHasTimedOut(true);
        }, timeoutMs);

        return () => clearTimeout(timer);
    }, [isLoading, timeoutMs]);

    // Determine message
    let message = '';
    if (hasTimedOut) {
        if (isOffline) {
            message = 'You appear to be offline. Please check your internet connection.';
        } else {
            message = 'Loading is taking longer than expected. The server may be experiencing issues.';
        }
    }

    return {
        hasTimedOut,
        isOffline,
        message
    };
}
