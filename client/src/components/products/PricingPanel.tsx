import { useId } from 'react';
import { MiscCostsEditor, type MiscCost } from './MiscCostsEditor';
import { usePermissions } from '../../hooks/usePermissions';
import { useAccount } from '../../context/AccountContext';
import { nonnegativeNumber } from '../../utils/responseValidation';
import { reportMoney } from '../analytics/useReportRequest';

interface Props {
    formData: { price: string; salePrice: string; cogs: string; miscCosts?: MiscCost[] };
    onChange?: (updates: Partial<Props['formData']>) => void;
}

export function PricingPanel({ formData, onChange }: Props) {
    const { hasPermission } = usePermissions(); const { currentAccount } = useAccount(); const id = useId();
    const canViewCogs = hasPermission('view_cogs');
    const currency = currentAccount?.currency;
    const money = (amount: number) => reportMoney(amount, currency);
    const saleSelected = formData.salePrice.trim() !== '';
    const price = nonnegativeNumber(saleSelected ? formData.salePrice : formData.price);
    const misc = formData.miscCosts ?? [];
    const validMisc = misc.every(item => typeof item.amount === 'number' && Number.isFinite(item.amount));
    const baseCost = formData.cogs.trim() === '' && misc.length ? 0 : nonnegativeNumber(formData.cogs);
    const cost = baseCost !== null && validMisc ? baseCost + misc.reduce((total, item) => total + item.amount, 0) : null;
    const profit = price !== null && cost !== null && Number.isFinite(cost) && Number.isFinite(price - cost) ? price - cost : null;
    const margin = profit !== null && price !== null && price > 0 ? profit / price * 100 : null;
    return <section aria-label="Product pricing" className="p-6 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 space-y-4">
        <h2 className="font-semibold">Pricing {currency ? `(${currency})` : '(currency unavailable)'}</h2>
        <fieldset disabled={!onChange} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">{([
                ['price', 'Regular Price'], ['salePrice', 'Sale Price'], ...(canViewCogs ? [['cogs', 'Cost of Goods (COGS)']] : [])
            ] as Array<['price' | 'salePrice' | 'cogs', string]>).map(([key, label]) => <div key={key}><label htmlFor={`${id}-${key}`} className="block text-sm mb-1">{label}</label><input id={`${id}-${key}`} type="number" min="0" step="0.01" value={formData[key]} onChange={event => onChange?.({ [key]: event.target.value })} className="w-full p-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900" /></div>)}</div>
            {canViewCogs && <MiscCostsEditor value={misc} currency={currency ?? ''} onChange={miscCosts => onChange?.({ miscCosts })} />}
        </fieldset>
        {canViewCogs && <div className="border-t border-slate-200 dark:border-slate-700 pt-4 space-y-2">
            <h3 className="font-medium">Profit Margin</h3>
            {profit === null ? <p role="status">Enter valid prices and COGS to calculate profit. Missing costs are not assumed to be zero.</p> : <>
                <dl className="space-y-2"><div className="flex justify-between"><dt>Total COGS</dt><dd>{money(cost!)}</dd></div><div className="flex justify-between"><dt>Gross Profit</dt><dd>{money(profit)}</dd></div><div className="flex justify-between"><dt>Margin</dt><dd>{margin !== null && Number.isFinite(margin) ? `${margin.toFixed(1)}%` : 'Unavailable for a zero selling price'}</dd></div></dl>
                <p className="text-xs text-slate-500 dark:text-slate-400">Based on {saleSelected ? 'sale' : 'regular'} price of {money(price!)}.</p>
            </>}
        </div>}
    </section>;
}
