import { useEffect, useState } from 'react';
import { Activity, ArrowRight, Globe, RefreshCw, ShoppingCart } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { useWidgetRead } from '../../hooks/useWidgetRead';
import { WidgetProps } from './WidgetRegistry';
import { widgetCardClass } from './widgetStyles';
import { rows, count, label, money } from '../analytics/analyticsRead';
function decode(value: unknown) {
    const visitors = rows(value).map(row => {
        const lastActive = typeof row.lastActiveAt === 'string' ? Date.parse(row.lastActiveAt) : NaN;
        if (!Number.isFinite(lastActive) || lastActive > Date.now() + 60000) throw new Error('Invalid live observation');
        const cartValue = row.cartValue == null ? null : typeof row.cartValue === 'string' && /^\d+(?:\.\d+)?$/.test(row.cartValue) ? Number(row.cartValue) : row.cartValue;
        if (cartValue !== null && (typeof cartValue !== 'number' || !Number.isFinite(cartValue) || cartValue < 0)) throw new Error('Invalid cart value');
        return { country: row.country == null || row.country === '' ? 'Unknown' : label(row.country), lastActive,
            cartValue: cartValue as number | null, currency: typeof row.currency === 'string' && /^[A-Z]{3}$/.test(row.currency) ? row.currency : null };
    });
    count(visitors.length); return { visitors, checkedAt: Date.now() };
}
export function LiveAnalyticsWidget({ className }: WidgetProps) {
    const { token, user } = useAuth(); const { currentAccount } = useAccount();
    if (!token || !currentAccount) return <div className={`${widgetCardClass} p-6 h-full text-sm text-slate-500 dark:text-slate-400 ${className ?? ''}`}>Sign in and select an account to view live observations.</div>;
    return <LiveContent key={JSON.stringify([user?.id, currentAccount.id, token])} accountId={currentAccount.id} token={token} className={className} />;
}
function LiveContent({ accountId, token, className }: { accountId: string; token: string; className?: string }) {
    const navigate = useNavigate(); const read = useWidgetRead('/api/tracking/live', accountId, token, decode, 10000);
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 10000); return () => clearInterval(timer); }, []);
    const data = read.data;
    const stale = !data || now - data.checkedAt > 30000 || data.visitors.some(visitor => now - visitor.lastActive > 3 * 60000);
    const countries = new Map<string, number>(); const carts = new Map<string, number>(); let unknownCarts = 0;
    for (const visitor of data?.visitors ?? []) {
        countries.set(visitor.country, (countries.get(visitor.country) ?? 0) + 1);
        if (visitor.cartValue == null) { unknownCarts++; continue; }
        if (visitor.cartValue > 0) {
            if (visitor.currency) carts.set(visitor.currency, (carts.get(visitor.currency) ?? 0) + visitor.cartValue);
            else unknownCarts++;
        }
    }
    return <section className={`${widgetCardClass} p-6 flex h-full min-h-0 flex-col text-slate-900 dark:text-slate-100 ${className ?? ''}`} aria-label="Live analytics">
        <div className="flex items-start justify-between gap-3 mb-4 shrink-0">
            <div>
                <h3 className="text-sm font-medium text-slate-500 dark:text-slate-400">Recent Active Sessions</h3>
                {data && <p aria-label="Returned session count" className="mt-1 text-xl font-semibold tabular-nums">{data.visitors.length}</p>}
            </div>
            <div className="rounded-lg bg-[var(--brand-subtle)] p-2 text-[var(--brand-text)]">
                <Activity className="h-5 w-5" aria-hidden="true" />
            </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto space-y-3">
            {read.error || stale && data ? <p role="alert" className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">{read.error || 'Observations are stale; current activity is unverified.'}</p> : null}
            {!data ? <p role="status" className="text-sm text-slate-500 dark:text-slate-400">{read.error ? 'Live observations unavailable.' : 'Loading live observations…'}</p> : <>
                <p className="text-xs text-slate-500 dark:text-slate-400">Returned session sample, not unique people. {data.visitors.length >= 50 ? 'The 50-session limit may truncate results.' : ''}</p>
                <div className="metric-strip" role="group" aria-label="Observed cart summary">
                    <div className="metric-strip-item">
                        <h4 className="flex items-center gap-2 text-xs font-medium text-slate-600 dark:text-slate-400"><ShoppingCart className="h-4 w-4 shrink-0 text-orange-500" aria-hidden="true" />Observed carts</h4>
                        <p className="mt-1 text-xl font-semibold tabular-nums">{data.visitors.filter(visitor => visitor.cartValue != null && visitor.cartValue > 0).length}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">With positive value</p>
                    </div>
                    <div className="metric-strip-item">
                        <h4 className="text-xs font-medium text-slate-600 dark:text-slate-400">Observed cart value, not forecast revenue</h4>
                        {[...carts].map(([currency, value]) => <p className="mt-1 break-words text-xl font-semibold tabular-nums" key={currency}>{Number.isFinite(value) ? money(value, currency) : 'Cart total unavailable'}</p>)}
                        {!carts.size && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">No known-currency cart totals available.</p>}
                    </div>
                </div>
                {unknownCarts > 0 && <p className="text-xs text-slate-500 dark:text-slate-400">{unknownCarts} sessions have unavailable cart values or currency and are excluded from totals.</p>}
                {countries.size > 0 && <div>
                    <h4 className="mb-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">Top Locations</h4>
                    <ul className="flex flex-wrap gap-2">{[...countries].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([country, value]) => <li className="inline-flex max-w-full items-center gap-1 rounded-md bg-slate-50 px-2 py-1 text-xs text-slate-600 dark:bg-slate-700/50 dark:text-slate-300" key={country}><Globe className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" /><span className="break-all">{country}: {value}</span></li>)}</ul>
                </div>}
            </>}
        </div>
        <div className="mt-4 flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 dark:border-slate-700/50">
            <button className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-[var(--brand-text)] transition-colors hover:bg-[var(--brand-subtle)] focus-visible:outline-2 focus-visible:outline-[var(--focus-color)] disabled:cursor-wait disabled:opacity-50" type="button" disabled={read.busy} onClick={() => void read.refresh()}><RefreshCw className={`h-3.5 w-3.5 ${read.busy ? 'animate-spin' : ''}`} aria-hidden="true" />Refresh observations</button>
            <button className="inline-flex items-center gap-1 rounded-md py-1 text-sm font-medium text-[var(--brand-text)] hover:underline focus-visible:outline-2 focus-visible:outline-[var(--focus-color)]" type="button" onClick={() => navigate('/live')}>View Real-time Report<ArrowRight className="h-4 w-4" aria-hidden="true" /></button>
        </div>
    </section>;
}
