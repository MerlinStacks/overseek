import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';

export function SubjectExperimentPanel({ campaignId, subjectB, editable, onSaved }: { campaignId: string; subjectB?: string | null; editable: boolean; onSaved: (value: string) => void }) {
    const { token } = useAuth(); const { currentAccount } = useAccount();
    const [value, setValue] = useState(subjectB || '');
    const [email, setEmail] = useState('');
    const [error, setError] = useState(''); const [notice, setNotice] = useState('');
    const [busy, setBusy] = useState(false);
    const [result, setResult] = useState<{ variants: Array<{ variant: string; accepted: number; opened: number; clicked: number }>; note: string } | null>(null);
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'x-account-id': currentAccount?.id || '' };
    useEffect(() => {
        const controller = new AbortController();
        setValue(subjectB || ''); setResult(null); setError(''); setNotice('');
        if (token && currentAccount?.id) void fetch(`/api/marketing/campaigns/${campaignId}/experiment`, { signal: controller.signal, headers }).then(async response => {
            const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Experiment results unavailable');
            if (!controller.signal.aborted) setResult(data);
        }).catch(err => { if (!controller.signal.aborted) setError(err.message); });
        return () => controller.abort();
    }, [campaignId, currentAccount?.id, token, subjectB]);
    const request = async (test: boolean) => {
        if (busy) return;
        setBusy(true); setError(''); setNotice('');
        try {
            const response = await fetch(`/api/marketing/campaigns/${campaignId}/${test ? 'test' : 'experiment'}`, { method: test ? 'POST' : 'PUT', headers, body: JSON.stringify(test ? { email: email.trim(), variant: 'B' } : { subjectB: value.trim() || null }) });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Request failed');
            if (!test) onSaved(value.trim());
            setNotice(test ? 'Variant B test accepted for sending.' : 'Subject experiment saved. Blank B disables the split.');
        } catch (err) { setError((err as Error).message); }
        finally { setBusy(false); }
    };
    return <details className="rounded-lg border p-3"><summary className="cursor-pointer text-sm font-medium">Subject-line A/B test</summary><div className="mt-3 space-y-3">
        <p className="text-xs text-gray-500">A uses the broadcast subject. Add B for stable, approximately 50/50 allocation. The email body stays identical; retries keep the same variant.</p>
        <label className="block text-sm">Subject B<input value={value} onChange={event => setValue(event.target.value)} disabled={!editable || busy} maxLength={500} className="mt-1 block w-full rounded border p-2 text-sm" /></label>
        {editable && <button disabled={busy || value.trim() === (subjectB || '')} type="button" onClick={() => void request(false)} className="rounded border px-3 py-2 text-sm disabled:opacity-50">Save experiment</button>}
        {!!subjectB && <form onSubmit={event => { event.preventDefault(); void request(true); }} className="flex flex-wrap gap-2"><input required type="email" aria-label="Variant B test recipient" value={email} onChange={event => setEmail(event.target.value)} placeholder="Test recipient email" className="min-w-0 flex-1 rounded border p-2 text-sm" /><button disabled={busy || !email.trim() || value.trim() !== subjectB} className="rounded border px-3 py-2 text-sm disabled:opacity-50">Send B test</button></form>}
        {result && <><div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr><th>Variant</th><th>Accepted</th><th>Unique opens</th><th>Unique clicks</th></tr></thead><tbody>{result.variants.map(row => <tr key={row.variant}><td className="py-2">{row.variant}</td><td>{row.accepted}</td><td>{row.opened}</td><td>{row.clicked}</td></tr>)}</tbody></table></div><p className="text-xs text-gray-500">{result.note}</p></>}
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}{notice && <p role="status" className="text-sm text-green-700">{notice}</p>}
    </div></details>;
}
