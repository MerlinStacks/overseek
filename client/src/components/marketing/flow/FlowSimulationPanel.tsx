import { useEffect, useRef, useState } from 'react';
import type { Node, Edge } from '@xyflow/react';
import { useAuth } from '../../../context/AuthContext';
import { useAccount } from '../../../context/AccountContext';

interface Result { steps: Array<{ id: string; label: string; type: string; explanation: string; to?: string; subject?: string }>; stopped: string; note: string }
export function FlowSimulationPanel({ flowId, nodes, edges }: { flowId: string; nodes: Node[]; edges: Edge[] }) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const accountId = currentAccount?.id;
    const [email, setEmail] = useState('');
    const [result, setResult] = useState<Result | null>(null);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const request = useRef<AbortController | null>(null);
    useEffect(() => { request.current?.abort(); setResult(null); setEmail(''); setError(''); setBusy(false); return () => request.current?.abort(); }, [accountId, token, flowId]);
    const run = async () => {
        if (!accountId || !token) return;
        request.current?.abort();
        const next = new AbortController(); request.current = next;
        setBusy(true); setResult(null); setError('');
        try {
            const response = await fetch(`/api/marketing/automations/${flowId}/simulate`, {
                method: 'POST', signal: next.signal,
                headers: { Authorization: `Bearer ${token}`, 'x-account-id': accountId, 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...(email.trim() ? { email: email.trim() } : {}), flowDefinition: { nodes, edges } }),
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Simulation failed');
            if (!next.signal.aborted) setResult(data);
        } catch (err) { if (!next.signal.aborted) setError((err as Error).message); }
        finally { if (!next.signal.aborted) setBusy(false); }
    };
    return <section aria-label="Read-only flow simulation" className="space-y-3 rounded-lg border border-indigo-200 bg-indigo-50 p-3">
        <p className="text-sm font-semibold text-indigo-950">Simulate with current customer data</p>
        <p className="text-xs text-indigo-800">Leave blank for sample data, or enter an existing customer email. No messages, coupons, tags or jobs are created.</p>
        <form className="flex flex-wrap gap-2" onSubmit={event => { event.preventDefault(); void run(); }}><input aria-label="Simulation customer email" type="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="Customer email (optional)" className="min-w-0 flex-1 rounded border p-2 text-sm" /><button disabled={busy} type="submit" className="rounded bg-indigo-600 px-3 py-2 text-sm text-white disabled:opacity-50">{busy ? 'Simulating…' : 'Run dry-run'}</button></form>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        {result && <><ol className="space-y-2">{result.steps.map((step, index) => <li key={step.id} className="rounded border border-indigo-100 bg-white p-3 text-sm"><strong>{index + 1}. {step.label}</strong><p className="mt-1 text-xs text-gray-600">{step.explanation}</p>{step.to !== undefined && <p className="mt-1 text-xs">To: {step.to || 'Missing recipient'} · Subject: {step.subject || 'Missing subject'}</p>}</li>)}</ol><p className="text-xs font-medium">{result.stopped}</p><p className="text-xs text-indigo-800">{result.note}</p></>}
    </section>;
}
