import { useId, useState } from 'react';
import { ShieldAlert, ShieldCheck, ShieldQuestion } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { useScopedRequest } from '../../hooks/useScopedRequest';
import { useClickOutside } from '../../hooks/useClickOutside';
import { finiteFields, isRecord } from '../../utils/responseValidation';
import { cn } from '../../utils/cn';

interface FraudResult { score: number; level: 'low' | 'medium' | 'high'; factors: string[]; warnings: string[] }
interface Props { orderId: string | number; className?: string; compact?: boolean }
function decodeFraud(value: unknown): FraudResult {
    if (!isRecord(value) || !finiteFields(value, ['score']) || Number(value.score) < 0 || Number(value.score) > 100 || !['low', 'medium', 'high'].includes(String(value.level)) || !Array.isArray(value.factors) || !value.factors.every(item => typeof item === 'string') || (value.warnings !== undefined && (!Array.isArray(value.warnings) || !value.warnings.every(item => typeof item === 'string')))) throw new Error('Invalid risk result');
    return { ...value, warnings: value.warnings ?? [] } as unknown as FraudResult;
}
export function FraudRiskIndicator(props: Props) {
    const { token } = useAuth(); const { currentAccount } = useAccount();
    if (!token || !currentAccount || !props.orderId) return null;
    return <ScopedRisk key={JSON.stringify([token, currentAccount.id, props.orderId])} {...props} token={token} accountId={currentAccount.id} />;
}
function ScopedRisk({ orderId, compact, className, token, accountId }: Props & { token: string; accountId: string }) {
    const [requested, setRequested] = useState(!compact); const [open, setOpen] = useState(false);
    const { data, loading, error, retry } = useScopedRequest(requested ? `/api/orders/${encodeURIComponent(orderId)}/fraud-score` : null, accountId, token, decodeFraud);
    const id = useId(); const root = useClickOutside<HTMLDivElement>(() => setOpen(false), open);
    const config = data ? {
        low: { label: 'Low Risk', icon: ShieldCheck, color: 'text-green-700 dark:text-green-400' },
        medium: { label: 'Medium Risk', icon: ShieldQuestion, color: 'text-amber-700 dark:text-amber-400' },
        high: { label: 'High Risk', icon: ShieldAlert, color: 'text-red-700 dark:text-red-400' }
    }[data.level] : { label: error ? 'Risk unavailable' : loading ? 'Loading risk' : 'Check fraud risk', icon: ShieldQuestion, color: 'text-slate-500 dark:text-slate-400' };
    const Icon = config.icon;
    const show = () => { setRequested(true); setOpen(true); };
    return <div ref={root} className={cn('relative inline-block', className)} onMouseEnter={show} onMouseLeave={() => { if (!root.current?.contains(document.activeElement)) setOpen(false); }} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); } }}>
        <button type="button" aria-label={`${config.label}${data ? ` (${data.score})` : ''}`} aria-expanded={open} aria-controls={id} onFocus={show} onClick={show} className={cn('inline-flex items-center gap-1.5 rounded-full p-1.5 border border-current text-xs', config.color)}><Icon size={compact ? 16 : 14} aria-hidden="true" />{!compact && <span>{config.label}{data ? ` (${data.score})` : ''}</span>}</button>
        {open && <div id={id} role="region" aria-label="Fraud risk details" className="absolute z-50 top-full right-0 mt-1 w-64 max-w-[calc(100vw-2rem)] p-3 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg text-sm">
            {loading && <p role="status">Checking fraud risk...</p>}
            {error ? <p role="alert">Risk assessment unavailable. <button type="button" onClick={retry}>Retry risk check</button></p> : data && <><p className="font-semibold">{config.label} ({data.score}/100)</p>{data.factors.length ? <ul className="list-disc pl-4 mt-2">{data.factors.map((factor, index) => <li key={index}>{factor}</li>)}</ul> : <p>No risk factors detected by these heuristics.</p>}{data.warnings.length > 0 && <div className="mt-2 text-amber-800 dark:text-amber-300"><p className="font-medium">Assessment limitations</p><ul>{data.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></div>}</>}
            <button type="button" onClick={() => setOpen(false)} className="mt-2 underline">Close risk details</button>
        </div>}
    </div>;
}
