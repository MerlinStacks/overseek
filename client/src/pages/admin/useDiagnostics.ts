import { useCallback, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useScopedMutation } from '../../hooks/useScopedMutation';
import { useAdminRead } from './useAdminRead';
import { decodeAccounts, decodeHealth, decodeSubscriptions, decodeTest, isCount } from './adminValidation';
import { api } from '../../services/api';
import { isRecord } from '../../utils/responseValidation';

export interface SystemHealthData {
    status: 'healthy' | 'degraded' | 'unhealthy'; timestamp: string;
    version: { app: string; node: string; uptime: number; uptimeFormatted: string };
    services: Record<string, { status: 'healthy' | 'degraded' | 'unhealthy'; latencyMs?: number; details?: string }>;
    queues: Record<string, { waiting: number; active: number; completed: number; failed: number }>;
    sync: { totalAccounts: number; entityTypes: Array<{ type: string; accountsTracked: number; accountsSynced: number; oldestSync: string | null; newestSync: string | null }> };
    webhooks: { failed24h: number; processed24h: number; received24h: number };
}
export interface PushSubscriptionEntry { id: string; userId: string; userEmail: string; userName: string | null; accountId: string; accountName: string; notifyOrders: boolean; notifyMessages: boolean; endpointShort: string; updatedAt: string }
export interface PushSubscriptionData { totalSubscriptions: number; uniqueAccounts: number; byAccount: Record<string, PushSubscriptionEntry[]> }
export interface TestPushResult { success: boolean; accountId: string; accountName: string; sent: number; failed: number; eligibleSubscriptions: number; subscriptionIds: Array<{ id: string; userId: string; endpointShort: string }> }
export interface Account { id: string; name: string }

/** AdminDiagnosticsPage mounts this hook under a user/token key. */
export function useDiagnostics() {
    const { token } = useAuth();
    const health = useAdminRead('/api/admin/system-health', token, decodeHealth, true);
    const subscriptions = useAdminRead('/api/admin/diagnostics/push-subscriptions', token, decodeSubscriptions);
    const accounts = useAdminRead('/api/admin/accounts', token, decodeAccounts);
    const mutation = useScopedMutation();
    const { refresh: refreshSubscriptions } = subscriptions;
    const { isPending: mutationPending } = mutation;
    const [selectedAccountId, selectAccount] = useState(''); const [testType, selectType] = useState<'order' | 'message'>('order');
    const [testResult, setTestResult] = useState<TestPushResult | null>(null);
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    const [expandedAccounts, setExpandedAccounts] = useState<Set<string>>(new Set());
    const fetchSubscriptions = useCallback(async () => {
        if (mutationPending()) return;
        const data = await refreshSubscriptions();
        if (data) setExpandedAccounts(new Set(Object.keys(data.byAccount)));
    }, [refreshSubscriptions, mutationPending]);
    const setSelectedAccountId = (id: string) => {
        if (mutation.isPending()) return;
        selectAccount(id); setTestResult(null); setMessage(null);
    };
    const setTestType = (type: 'order' | 'message') => {
        if (mutation.isPending() || !['order', 'message'].includes(type)) return;
        selectType(type); setTestResult(null); setMessage(null);
    };
    const canMutate = () => !!token && !mutation.isPending() && !subscriptions.isPending() && !accounts.isPending();
    const sendTestPush = async () => {
        if (!canMutate() || !accounts.data?.some(account => account.id === selectedAccountId)) return;
        setMessage(null); setTestResult(null);
        const result = await mutation.run(async signal => {
            const data = decodeTest(await api.request(`/api/admin/diagnostics/test-push/${encodeURIComponent(selectedAccountId)}`, { method: 'POST', token: token!, signal, body: JSON.stringify({ type: testType }) }));
            if (data.accountId !== selectedAccountId) throw new Error('Mismatched test target');
            return data;
        }, 'Could not confirm test delivery. It may have been sent; check before retrying.');
        if (result.ok) { setTestResult(result.value); setMessage({ type: result.value.sent > 0 ? 'success' : 'error', text: `Account delivery: ${result.value.sent} sent, ${result.value.failed} failed, ${result.value.eligibleSubscriptions} eligible.` }); }
    };
    const remove = async (id?: string) => {
        if (!canMutate()) return;
        if (id && !Object.values(subscriptions.data?.byAccount ?? {}).flat().some(subscription => subscription.id === id)) return;
        if (!confirm(id ? 'Delete this push subscription?' : 'Delete ALL push subscriptions across ALL accounts?')) return;
        if (!id && !confirm('This cannot be undone. All devices will need to subscribe again. Continue?')) return;
        setMessage(null);
        const result = await mutation.run(async signal => {
            const data: unknown = await api.request(`/api/admin/diagnostics/push-subscriptions${id ? `/${encodeURIComponent(id)}` : ''}`, { method: 'DELETE', token: token!, signal });
            if (!isRecord(data) || data.success !== true || (!id && !isCount(data.deleted))) throw new Error('Invalid delete confirmation');
            return id ? 'Subscription deleted.' : `Deleted ${data.deleted} subscriptions.`;
        }, 'Could not confirm subscription deletion. Refresh and check status before retrying.');
        if (result.ok) { setMessage({ type: 'success', text: result.value }); void fetchSubscriptions(); }
    };
    return {
        loading: mutation.busy || subscriptions.busy || accounts.busy,
        subscriptions: subscriptions.data, accounts: accounts.data ?? [], selectedAccountId, setSelectedAccountId,
        testType, setTestType, testResult,
        message: mutation.error ? { type: 'error' as const, text: mutation.error } : message,
        healthError: health.error, subscriptionsError: subscriptions.error, accountsError: accounts.error,
        expandedAccounts, systemHealth: health.data, healthLoading: health.busy,
        fetchSystemHealth: health.refresh, fetchSubscriptions, fetchAccounts: accounts.refresh,
        sendTestPush, deleteSubscription: (id: string) => remove(id), deleteAllSubscriptions: () => remove(),
        toggleAccount: (key: string) => setExpandedAccounts(previous => { const next = new Set(previous); if (next.has(key)) next.delete(key); else next.add(key); return next; }),
    };
}
