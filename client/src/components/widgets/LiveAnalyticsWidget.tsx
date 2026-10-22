import { useEffect, useState } from 'react';
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
    if (!token || !currentAccount) return <div className={widgetCardClass}>Sign in and select an account to view live observations.</div>;
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
    return <section className={`${widgetCardClass} p-5 space-y-3 text-slate-900 dark:text-slate-100 ${className ?? ''}`} aria-label="Live analytics">
        <h3 className="font-semibold">Recent Active Sessions</h3>
        {read.error || stale && data ? <p role="alert">{read.error || 'Observations are stale; current activity is unverified.'}</p> : null}
        {!data ? <p role="status">{read.error ? 'Live observations unavailable.' : 'Loading live observations…'}</p> : <>
            <p className="text-3xl font-bold">{data.visitors.length}</p><p className="text-xs">Returned session sample, not unique people. {data.visitors.length >= 50 ? 'The 50-session limit may truncate results.' : ''}</p>
            <p>Observed carts with positive value: {data.visitors.filter(visitor => visitor.cartValue != null && visitor.cartValue > 0).length}</p>
            <h4 className="text-sm font-medium">Observed cart value, not forecast revenue</h4>
            {[...carts].map(([currency, value]) => <p key={currency}>{Number.isFinite(value) ? money(value, currency) : 'Cart total unavailable'}</p>)}
            {!carts.size && <p>No known-currency cart totals available.</p>}
            {unknownCarts > 0 && <p>{unknownCarts} sessions have unavailable cart values or currency and are excluded from totals.</p>}
            <ul>{[...countries].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([country, value]) => <li key={country}>{country}: {value}</li>)}</ul>
        </>}
        <button type="button" disabled={read.busy} onClick={() => void read.refresh()}>Refresh observations</button>
        <button type="button" onClick={() => navigate('/live')}>View Real-time Report</button>
    </section>;
}
