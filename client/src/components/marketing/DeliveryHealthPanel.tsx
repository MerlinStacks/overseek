import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useScopedRequest } from '../../hooks/useScopedRequest';
import { isRecord } from '../../utils/responseValidation';

interface Health { start: string; end: string; statuses: Array<{ status: string; count: number }>; suppressions: number; sender: { name: string; email: string } | null; pressureCap: { maxPerWindow: number; windowHours: number }; note: string }
function decode(value: unknown): Health {
    if (!isRecord(value) || !Array.isArray(value.statuses) || value.statuses.some(row => !isRecord(row) || typeof row.status !== 'string' || !Number.isSafeInteger(row.count) || Number(row.count) < 0) || typeof value.note !== 'string' || typeof value.start !== 'string' || !Number.isFinite(Date.parse(value.start)) || typeof value.end !== 'string' || !Number.isFinite(Date.parse(value.end)) || !Number.isSafeInteger(value.suppressions) || Number(value.suppressions) < 0 || !isRecord(value.pressureCap) || !Number.isSafeInteger(value.pressureCap.maxPerWindow) || Number(value.pressureCap.maxPerWindow) < 1 || !Number.isSafeInteger(value.pressureCap.windowHours) || Number(value.pressureCap.windowHours) < 1 || value.sender !== null && (!isRecord(value.sender) || typeof value.sender.email !== 'string' || typeof value.sender.name !== 'string')) throw new Error('Invalid delivery observations');
    return value as unknown as Health;
}
export function DeliveryHealthPanel({ token, accountId }: { token: string; accountId: string }) {
    const [open, setOpen] = useState(false);
    return <details onToggle={event => setOpen(event.currentTarget.open)} className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900"><summary className="cursor-pointer font-semibold">Delivery health & frequency caps</summary>{open && <HealthRead token={token} accountId={accountId} />}</details>;
}
function HealthRead({ token, accountId }: { token: string; accountId: string }) {
    const { data, loading, error, retry } = useScopedRequest('/api/marketing/delivery-health', accountId, token, decode);
    if (loading) return <p role="status" className="mt-3">Loading delivery observations…</p>;
    if (error || !data) return <p role="alert" className="mt-3">Delivery observations unavailable. <button type="button" onClick={retry} className="underline">Retry</button></p>;
    return <div className="mt-4 space-y-3 text-sm">
        <p><strong>Default sender:</strong> {data.sender ? `${data.sender.name} <${data.sender.email}>` : 'Not configured. Add a sending account before sending.'}</p>
        <div className="rounded-lg bg-indigo-50 p-3 text-indigo-900"><strong>Shared marketing cap:</strong> {data.pressureCap.maxPerWindow} emails per contact per {data.pressureCap.windowHours} hours across flows and broadcasts. Transactional emails and explicit test sends are excluded. Managed through the deployment’s MARKETING_PRESSURE settings.</div>
        <p className="text-xs text-slate-500">{new Date(data.start).toLocaleString()} – {new Date(data.end).toLocaleString()}</p>
        <div className="flex flex-wrap gap-2">{data.statuses.length ? data.statuses.map(row => <span key={row.status} className="rounded-lg border px-3 py-2">{row.status.replace(/_/g, ' ')}: <strong>{row.count}</strong></span>) : <p>No flow/broadcast email logs in this window.</p>}</div>
        <p>Suppression records: {data.suppressions}</p>
        <p className="text-xs text-slate-500">{data.note}</p>
        <Link to="/emails/logs?status=FAILED" className="inline-block text-indigo-600 underline">Investigate failures in Message Logs</Link>
    </div>;
}
