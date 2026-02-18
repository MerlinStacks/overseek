/**
 * useDiagnostics — encapsulates all state and data-fetching logic
 * for the AdminDiagnosticsPage.
 *
 * Why: The page component was a 524-line god-component with 6 inline
 * fetch calls all repeating `Authorization: Bearer ${token}`. This hook
 * extracts that logic so the page component is purely presentational.
 */

import { useState, useEffect, useCallback } from 'react';
import { Logger } from '../../utils/logger';
import { useAuth } from '../../context/AuthContext';

// -------------------------------------------------------
// Types
// -------------------------------------------------------

export interface SystemHealthData {
    status: 'healthy' | 'degraded' | 'unhealthy';
    timestamp: string;
    version: {
        app: string;
        node: string;
        uptime: number;
        uptimeFormatted: string;
    };
    services: Record<string, { status: 'healthy' | 'degraded' | 'unhealthy'; latencyMs?: number; details?: string }>;
    queues: Record<string, { waiting: number; active: number; completed: number; failed: number }>;
    sync: {
        totalAccounts: number;
        entityTypes: Array<{
            type: string;
            accountsTracked: number;
            accountsSynced: number;
            oldestSync: string | null;
            newestSync: string | null;
        }>;
    };
    webhooks: {
        failed24h: number;
        processed24h: number;
        received24h: number;
    };
}

export interface PushSubscriptionEntry {
    id: string;
    userId: string;
    userEmail: string;
    userName: string | null;
    accountId: string;
    accountName: string;
    notifyOrders: boolean;
    notifyMessages: boolean;
    endpointShort: string;
    updatedAt: string;
}

export interface PushSubscriptionData {
    totalSubscriptions: number;
    uniqueAccounts: number;
    byAccount: Record<string, PushSubscriptionEntry[]>;
}

export interface TestPushResult {
    success: boolean;
    accountId: string;
    accountName: string;
    sent: number;
    failed: number;
    eligibleSubscriptions: number;
    subscriptionIds: Array<{ id: string; userId: string; endpointShort: string }>;
}

export interface Account {
    id: string;
    name: string;
}

/** Shared auth headers — eliminates per-fetch boilerplate */
function authHeaders(token: string, json = false) {
    const h: Record<string, string> = { Authorization: `Bearer ${token}` };
    if (json) h['Content-Type'] = 'application/json';
    return h;
}

// -------------------------------------------------------
// Hook
// -------------------------------------------------------

export function useDiagnostics() {
    const { token } = useAuth();

    const [loading, setLoading] = useState(false);
    const [subscriptions, setSubscriptions] = useState<PushSubscriptionData | null>(null);
    const [accounts, setAccounts] = useState<Account[]>([]);
    const [selectedAccountId, setSelectedAccountId] = useState('');
    const [testType, setTestType] = useState<'order' | 'message'>('order');
    const [testResult, setTestResult] = useState<TestPushResult | null>(null);
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    const [expandedAccounts, setExpandedAccounts] = useState<Set<string>>(new Set());

    // System Health
    const [systemHealth, setSystemHealth] = useState<SystemHealthData | null>(null);
    const [healthLoading, setHealthLoading] = useState(false);

    // -------------------------------------------------------
    // Fetch helpers
    // -------------------------------------------------------

    const fetchSystemHealth = useCallback(async () => {
        if (!token) return;
        setHealthLoading(true);
        try {
            const res = await fetch('/api/admin/system-health', {
                headers: authHeaders(token),
            });
            if (res.ok) setSystemHealth(await res.json());
        } catch (e) {
            Logger.error('Failed to fetch system health', { error: e });
        } finally {
            setHealthLoading(false);
        }
    }, [token]);

    const fetchSubscriptions = useCallback(async () => {
        if (!token) return;
        setLoading(true);
        setMessage(null);
        try {
            const res = await fetch('/api/admin/diagnostics/push-subscriptions', {
                headers: authHeaders(token),
            });
            if (!res.ok) throw new Error('Failed to fetch subscriptions');
            const data: PushSubscriptionData = await res.json();
            setSubscriptions(data);
            setExpandedAccounts(new Set(Object.keys(data.byAccount)));
        } catch (e: any) {
            setMessage({ type: 'error', text: e.message });
        } finally {
            setLoading(false);
        }
    }, [token]);

    const fetchAccounts = useCallback(async () => {
        if (!token) return;
        try {
            const res = await fetch('/api/admin/accounts', {
                headers: authHeaders(token),
            });
            if (res.ok) {
                const data = await res.json();
                setAccounts(data.map((a: any) => ({ id: a.id, name: a.name })));
            }
        } catch (e) {
            Logger.error('Failed to fetch accounts', { error: e });
        }
    }, [token]);

    const sendTestPush = useCallback(async () => {
        if (!selectedAccountId || !token) return;
        setLoading(true);
        setMessage(null);
        setTestResult(null);
        try {
            const res = await fetch(`/api/admin/diagnostics/test-push/${selectedAccountId}`, {
                method: 'POST',
                headers: authHeaders(token, true),
                body: JSON.stringify({ type: testType }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Test failed');
            setTestResult(data);
            setMessage({
                type: data.sent > 0 ? 'success' : 'error',
                text: data.sent > 0
                    ? `Sent ${data.sent} notifications to ${data.accountName}`
                    : `No notifications sent. ${data.eligibleSubscriptions} eligible subscriptions found.`,
            });
        } catch (e: any) {
            setMessage({ type: 'error', text: e.message });
        } finally {
            setLoading(false);
        }
    }, [selectedAccountId, token, testType]);

    const deleteSubscription = useCallback(async (subscriptionId: string) => {
        if (!token) return;
        if (!confirm('Delete this push subscription?')) return;
        try {
            const res = await fetch(`/api/admin/diagnostics/push-subscriptions/${subscriptionId}`, {
                method: 'DELETE',
                headers: authHeaders(token),
            });
            if (res.ok) {
                setMessage({ type: 'success', text: 'Subscription deleted' });
                fetchSubscriptions();
            }
        } catch (e: any) {
            setMessage({ type: 'error', text: e.message });
        }
    }, [token, fetchSubscriptions]);

    const deleteAllSubscriptions = useCallback(async () => {
        if (!token) return;
        if (!confirm('⚠️ DELETE ALL push subscriptions? This cannot be undone!')) return;
        if (!confirm('Are you ABSOLUTELY sure? All users will need to re-enable notifications.')) return;

        setLoading(true);
        try {
            const res = await fetch('/api/admin/diagnostics/push-subscriptions', {
                method: 'DELETE',
                headers: authHeaders(token),
            });
            const data = await res.json();
            if (res.ok) {
                setMessage({ type: 'success', text: `Deleted ${data.deleted} subscriptions` });
                setSubscriptions(null);
            }
        } catch (e: any) {
            setMessage({ type: 'error', text: e.message });
        } finally {
            setLoading(false);
        }
    }, [token]);

    // -------------------------------------------------------
    // UI helpers
    // -------------------------------------------------------

    const toggleAccount = useCallback((accountKey: string) => {
        setExpandedAccounts(prev => {
            const next = new Set(prev);
            if (next.has(accountKey)) next.delete(accountKey);
            else next.add(accountKey);
            return next;
        });
    }, []);

    // -------------------------------------------------------
    // Effects
    // -------------------------------------------------------

    useEffect(() => {
        fetchSystemHealth();
    }, [fetchSystemHealth]);

    // -------------------------------------------------------
    // Public API
    // -------------------------------------------------------

    return {
        // State
        loading,
        subscriptions,
        accounts,
        selectedAccountId,
        setSelectedAccountId,
        testType,
        setTestType,
        testResult,
        message,
        expandedAccounts,
        systemHealth,
        healthLoading,

        // Actions
        fetchSystemHealth,
        fetchSubscriptions,
        fetchAccounts,
        sendTestPush,
        deleteSubscription,
        deleteAllSubscriptions,
        toggleAccount,
    };
}
