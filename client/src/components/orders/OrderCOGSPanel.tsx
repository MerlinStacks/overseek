import { useId, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { usePermissions } from '../../hooks/usePermissions';
import { useScopedRequest } from '../../hooks/useScopedRequest';
import { finiteFields, isRecord } from '../../utils/responseValidation';
import { reportMoney } from '../analytics/useReportRequest';

interface COGSItem { name: string; sku: string; quantity: number; unitCOGS: number; lineCOGS: number }
interface COGSData { items: COGSItem[]; totalCOGS: number; totalRevenue: number; paymentFees: number; grossProfit: number; margin: number }
interface Props { orderId: string; currency?: string }
function decodeCOGS(value: unknown): COGSData {
    if (!isRecord(value) || !finiteFields(value, ['totalCOGS', 'totalRevenue', 'paymentFees', 'grossProfit', 'margin']) || !Array.isArray(value.items) || !value.items.every(item => isRecord(item) && typeof item.name === 'string' && (item.sku == null || typeof item.sku === 'string') && finiteFields(item, ['quantity', 'unitCOGS', 'lineCOGS']))) throw new Error('Invalid COGS response');
    return value as unknown as COGSData;
}
/** Both permission loss and scope changes unmount all retained financial data. */
export function OrderCOGSPanel(props: Props) {
    const { token } = useAuth(); const { currentAccount } = useAccount(); const { hasPermission } = usePermissions();
    if (!hasPermission('view_cogs') || !token || !currentAccount || !props.orderId) return null;
    return <ScopedCOGS key={JSON.stringify([token, currentAccount.id, props.orderId])} {...props} token={token} accountId={currentAccount.id} currency={props.currency || currentAccount.currency} />;
}
function ScopedCOGS({ orderId, currency, token, accountId }: Props & { token: string; accountId: string }) {
    const { data, loading, error, retry } = useScopedRequest(`/api/orders/${encodeURIComponent(orderId)}/cogs`, accountId, token, decodeCOGS);
    const [expanded, setExpanded] = useState(true); const id = useId();
    const money = (amount: number) => reportMoney(amount, currency);
    return <section aria-label="Order COGS" className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 text-slate-900 dark:text-slate-100">
        <button type="button" aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(!expanded)} className="w-full text-left font-semibold">COGS Breakdown {expanded ? '−' : '+'}</button>
        <div id={id} hidden={!expanded} className="mt-4 space-y-3">
            {loading ? <p role="status">Loading COGS...</p> : error || !data ? <p role="alert">Could not load order COGS. <button type="button" onClick={retry}>Retry COGS</button></p> : <>
                {!data.items.length ? <p>No item-level COGS data available.</p> : <ul className="space-y-2">{data.items.map((item, index) => <li key={index} className="flex justify-between gap-3"><div>{item.name}<p className="text-xs text-slate-500 dark:text-slate-400">{item.sku} · {item.quantity} × {money(item.unitCOGS)}</p></div><span>{money(item.lineCOGS)}</span></li>)}</ul>}
                <dl className="border-t border-slate-200 dark:border-slate-700 pt-3 space-y-2"><div className="flex justify-between"><dt>Total COGS</dt><dd>{money(data.totalCOGS)}</dd></div><div className="flex justify-between"><dt>Payment Fees</dt><dd>{money(data.paymentFees)}</dd></div><div className="flex justify-between font-semibold"><dt>Gross Profit</dt><dd>{money(data.grossProfit)} ({data.margin.toFixed(1)}%)</dd></div></dl>
            </>}
        </div>
    </section>;
}
