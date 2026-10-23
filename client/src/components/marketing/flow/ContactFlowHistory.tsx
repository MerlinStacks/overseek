import { useEffect, useRef, useState } from 'react';
import { useAccount } from '../../../context/AccountContext';
import { useAuth } from '../../../context/AuthContext';

interface Enrollment {
    id: string; email: string; status: string; statusReason?: string; nextRunAt?: string; createdAt: string; eventsTruncated: boolean;
    runEvents: Array<{ id: string; nodeId?: string; eventType: string; outcome?: string; metadata?: unknown; createdAt: string }>;
}
export function ContactFlowHistory({ flowId }: { flowId: string }) {
    const { currentAccount } = useAccount();
    const { token } = useAuth();
    const [email, setEmail] = useState('');
    const [result, setResult] = useState<{ enrollments: Enrollment[]; hasMore: boolean } | null>(null);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const request = useRef<AbortController | null>(null);
    useEffect(() => { request.current?.abort(); setResult(null); setError(''); setEmail(''); return () => request.current?.abort(); }, [flowId, currentAccount?.id]);
    const search = async () => {
        if (!currentAccount || !token) return;
        request.current?.abort(); const controller = new AbortController(); request.current = controller;
        setResult(null); setError(''); setBusy(true);
        try {
            const response = await fetch(`/api/marketing/automations/${flowId}/contact-history?${new URLSearchParams({ email: email.trim() })}`, { signal: controller.signal, headers: { Authorization: `Bearer ${token}`, 'x-account-id': currentAccount.id } });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'History unavailable');
            if (!controller.signal.aborted) setResult(data);
        } catch (err) { if (!controller.signal.aborted) setError((err as Error).message); }
        finally { if (!controller.signal.aborted) setBusy(false); }
    };
    return <section aria-label="Customer execution history" className="space-y-3 rounded-xl border border-gray-200 p-4">
        <h3 className="text-sm font-semibold text-gray-900">Trace a customer</h3>
        <form onSubmit={event => { event.preventDefault(); void search(); }} className="flex flex-wrap gap-2"><input required type="email" aria-label="History customer email" placeholder="Customer email" value={email} onChange={event => setEmail(event.target.value)} className="min-w-0 flex-1 rounded-lg border p-2 text-sm" /><button disabled={busy} className="rounded-lg bg-[var(--primary-color)] px-3 py-2 text-sm text-[var(--primary-foreground)] disabled:opacity-50">{busy ? 'Loading…' : 'View execution history'}</button></form>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        {result && <>{!result.enrollments.length && <p className="text-sm text-gray-500">No recorded enrollments for this email in this flow.</p>}{result.enrollments.map(enrollment => <details key={enrollment.id} className="rounded-lg border p-3"><summary className="cursor-pointer text-sm font-medium">{new Date(enrollment.createdAt).toLocaleString()} · {enrollment.status} · {enrollment.email}</summary><p className="mt-2 text-xs text-gray-600">{enrollment.statusReason || 'No status reason recorded'}{enrollment.nextRunAt && ` · Next scheduled step: ${new Date(enrollment.nextRunAt).toLocaleString()}`}</p><ol className="mt-3 space-y-2">{enrollment.runEvents.map(event => <li key={event.id} className="rounded bg-gray-50 p-2 text-xs"><time>{new Date(event.createdAt).toLocaleString()}</time><p className="font-medium">{event.outcome || event.eventType} · {event.nodeId || 'Enrollment'}</p>{event.metadata != null && <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-words text-gray-600">{JSON.stringify(event.metadata, null, 2)}</pre>}</li>)}</ol>{enrollment.eventsTruncated && <p className="mt-2 text-xs text-amber-800">Showing the first 100 events for this enrollment.</p>}</details>)}{result.hasMore && <p className="text-xs text-amber-800">Showing the 10 most recent enrollments.</p>}</>}
    </section>;
}
