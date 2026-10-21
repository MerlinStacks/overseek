import { useEffect, useState } from 'react';
import { api } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { useScopedMutation } from '../../hooks/useScopedMutation';
import { isRecord } from '../../utils/responseValidation';
import { formatDateTimeSafe } from '../../utils/format';
import './SessionManager.css';

interface Session { id: string; createdAt: string; expiresAt: string; ipAddress: string | null; userAgent: string | null; isCurrent: boolean }
function decodeSessions(value: unknown): Session[] {
    if (!Array.isArray(value) || !value.every(item => isRecord(item) && typeof item.id === 'string' && typeof item.createdAt === 'string' && typeof item.expiresAt === 'string' && typeof item.isCurrent === 'boolean' && ['ipAddress', 'userAgent'].every(key => item[key] == null || typeof item[key] === 'string'))) throw new Error('Invalid sessions');
    return value;
}
function browserName(agent: string | null) {
    if (!agent) return 'Unknown Device';
    if (/Edg\//.test(agent)) return 'Edge Browser';
    if (/OPR\//.test(agent)) return 'Opera Browser';
    if (agent.includes('Firefox')) return 'Firefox Browser';
    if (agent.includes('Chrome')) return 'Chrome Browser';
    return agent.includes('Safari') ? 'Safari Browser' : 'Unknown Browser';
}
export function SessionManager() {
    const { token, user } = useAuth();
    if (!token || !user) return <p role="status">Sign in to manage sessions.</p>;
    return <UserSessions key={JSON.stringify([user.id, token])} token={token} />;
}
function UserSessions({ token }: { token: string }) {
    const [sessions, setSessions] = useState<Session[]>([]); const [loading, setLoading] = useState(true);
    const [readError, setReadError] = useState(false); const [attempt, setAttempt] = useState(0);
    const mutation = useScopedMutation();
    useEffect(() => {
        const controller = new AbortController(); let disposed = false;
        const timeout = setTimeout(() => controller.abort(), 30000);
        queueMicrotask(() => {
            if (disposed) return;
            setLoading(true); setReadError(false);
            void (async () => {
                try {
                    const data = decodeSessions(await api.request('/api/sessions', { method: 'GET', token, signal: controller.signal }));
                    if (!disposed && !controller.signal.aborted) setSessions(data);
                } catch { if (!disposed) setReadError(true); }
                finally { clearTimeout(timeout); if (!disposed) setLoading(false); }
            })();
        });
        return () => { disposed = true; clearTimeout(timeout); controller.abort(); };
    }, [token, attempt]);
    const revoke = async (id?: string) => {
        if (mutation.isPending() || loading || readError) return;
        if (id && !sessions.some(item => item.id === id && !item.isCurrent)) return;
        if (!confirm(id ? 'Revoke this session?' : 'Sign out all other devices? Your current session will remain active.')) return;
        const result = await mutation.run(signal => api.request(`/api/sessions${id ? `/${encodeURIComponent(id)}` : ''}`, { method: 'DELETE', token, signal }), 'Could not revoke sessions. Check their status before retrying.');
        if (result.ok) { setSessions(previous => previous.filter(item => id ? item.id !== id : item.isCurrent)); setAttempt(value => value + 1); }
    };
    if (loading) return <p role="status">Loading sessions...</p>;
    if (readError) return <p role="alert">Could not load active sessions. <button type="button" onClick={() => setAttempt(value => value + 1)}>Retry sessions</button></p>;
    return <section aria-label="Active sessions" className="session-manager text-slate-900 dark:text-slate-100">
        <h2 className="font-semibold">Active Sessions</h2><p>Revoke devices you do not recognize. Bulk revocation keeps your current session.</p>
        {mutation.error && <p role="alert">{mutation.error}</p>}{mutation.busy && <p role="status">Revoking sessions...</p>}
        <fieldset disabled={mutation.busy} className="space-y-4">
            {sessions.some(item => !item.isCurrent) && <button type="button" onClick={() => void revoke()}>Revoke Other Sessions</button>}
            {!sessions.length ? <p>No active sessions found.</p> : <ul className="session-list">{sessions.map(item => <li key={item.id} className="session-item"><div className="session-info"><p>{browserName(item.userAgent)} {item.isCurrent && <strong>· Current Session</strong>}</p><p>IP: {item.ipAddress || 'Unknown'}</p><p>Signed in: {formatDateTimeSafe(item.createdAt, 'Date unavailable')}</p><p>Expires: {formatDateTimeSafe(item.expiresAt, 'Date unavailable')}</p></div>{!item.isCurrent && <button type="button" aria-label={`Revoke session ${item.ipAddress || item.id}`} onClick={() => void revoke(item.id)}>Revoke</button>}</li>)}</ul>}
        </fieldset>
    </section>;
}
export default SessionManager;
