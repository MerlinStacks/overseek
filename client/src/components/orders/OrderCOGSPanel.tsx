import { useId, useState } from 'react';
import { ChevronDown, DollarSign, Loader2 } from 'lucide-react';
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
    return <section aria-label="Order COGS" className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white text-slate-900 shadow-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
        <button type="button" aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(!expanded)} className="flex w-full items-center justify-between gap-2 border-b border-slate-100 p-4 text-left font-semibold transition-colors hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-700/50"><span className="flex items-center gap-2"><DollarSign size={18} className="text-emerald-500" />COGS Breakdown</span><ChevronDown size={16} className={`shrink-0 text-slate-400 ${expanded ? 'rotate-180' : ''}`} /></button>
        <div id={id} hidden={!expanded} className="space-y-4 p-4 text-sm">
            {loading ? <p role="status" className="flex items-center justify-center gap-2 py-6 text-slate-500 dark:text-slate-400"><Loader2 size={16} className="animate-spin motion-reduce:animate-none" />Loading COGS...</p> : error || !data ? <p role="alert" className="text-red-700 dark:text-red-300">Could not load order COGS. <button type="button" onClick={retry} className="font-medium underline underline-offset-2">Retry COGS</button></p> : <>
                {!data.items.length ? <p className="py-4 text-center text-slate-500 dark:text-slate-400">No item-level COGS data available.</p> : <ul className="space-y-3">{data.items.map((item, index) => <li key={index} className="flex items-start justify-between gap-3"><div className="min-w-0 flex-1"><div className="truncate font-medium" title={item.name}>{item.name}</div><p className="break-words text-xs text-slate-500 dark:text-slate-400">{item.sku ? `SKU: ${item.sku} · ` : ''}{item.quantity} × {money(item.unitCOGS)}</p></div><span className="shrink-0 font-medium tabular-nums">{money(item.lineCOGS)}</span></li>)}</ul>}
                <dl className="space-y-2 border-t border-slate-100 pt-3 dark:border-slate-700"><div className="flex justify-between gap-2"><dt className="text-slate-500 dark:text-slate-400">Total COGS</dt><dd className="font-medium tabular-nums">{money(data.totalCOGS)}</dd></div><div className="flex justify-between gap-2"><dt className="text-slate-500 dark:text-slate-400">Payment Fees</dt><dd className="font-medium tabular-nums">{money(data.paymentFees)}</dd></div><div className="flex flex-wrap items-center justify-between gap-2 border-t border-dashed border-slate-200 pt-2 dark:border-slate-600"><dt className="font-semibold">Gross Profit</dt><dd className="flex flex-wrap items-center gap-2"><span className={`font-bold tabular-nums ${data.grossProfit >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>{money(data.grossProfit)}</span><span className={`rounded-full border px-1.5 py-0.5 text-xs font-medium ${data.margin >= 0 ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' : 'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300'}`}>{data.margin.toFixed(1)}%</span></dd></div></dl>
            </>}
        </div>
    </section>;
}
