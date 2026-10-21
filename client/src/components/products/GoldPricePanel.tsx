import { useId } from 'react';
import { useAccountFeature } from '../../hooks/useAccountFeature';
import { useAccount } from '../../context/AccountContext';
import { usePermissions } from '../../hooks/usePermissions';
import { nonnegativeNumber } from '../../utils/responseValidation';
import { reportMoney } from '../analytics/useReportRequest';

type GoldPriceType = 'none' | 'legacy' | '18ct' | '9ct' | '18ctWhite' | '9ctWhite';
interface Props {
    product: { weight?: string | null; goldPriceType?: Exclude<GoldPriceType, 'none'> | null; isGoldPriceApplied?: boolean };
    onChange: (updates: { isGoldPriceApplied: boolean; goldPriceType: Exclude<GoldPriceType, 'none' | 'legacy'> | null }) => void;
    hasVariants?: boolean;
}
const types: Array<[GoldPriceType, string]> = [['none', 'None'], ['18ct', '18ct Gold'], ['9ct', '9ct Gold'], ['18ctWhite', '18ct White Gold'], ['9ctWhite', '9ct White Gold']];
export function GoldPricePanel({ product, onChange, hasVariants }: Props) {
    const isEnabled = useAccountFeature('GOLD_PRICE_CALCULATOR'); const { currentAccount } = useAccount();
    const { hasPermission } = usePermissions(); const id = useId();
    if (!isEnabled || !hasPermission('view_cogs') || !currentAccount) return null;
    if (hasVariants) return <section className="p-6 rounded-xl bg-amber-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100"><h2 className="font-semibold">Gold Price Calculation</h2><p>Gold price settings are configured per-variant in the Variations tab.</p></section>;
    const currentType = product.goldPriceType || (product.isGoldPriceApplied ? 'legacy' : 'none');
    const knownType = currentType === 'legacy' || types.some(([type]) => type === currentType);
    const weight = nonnegativeNumber(product.weight);
    const rates = { legacy: currentAccount.goldPrice, '18ct': currentAccount.goldPrice18ct, '9ct': currentAccount.goldPrice9ct, '18ctWhite': currentAccount.goldPrice18ctWhite, '9ctWhite': currentAccount.goldPrice9ctWhite };
    const price = currentType !== 'none' && knownType ? nonnegativeNumber(rates[currentType as keyof typeof rates]) : null;
    const calculated = price !== null && weight !== null && weight > 0 && Number.isFinite(price * weight) ? price * weight : null;
    const currency = currentAccount.goldPriceCurrency || currentAccount.currency;
    const money = (amount: number | null) => amount === null ? 'Unavailable' : reportMoney(amount, currency);
    return <section aria-label="Gold pricing" className="p-6 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 space-y-4">
        <div className="flex flex-wrap justify-between gap-3 items-center"><h2 className="font-semibold">Gold Price Calculation</h2><label htmlFor={id}>Gold Type:</label><select id={id} value={currentType} onChange={event => {
            const value = event.target.value;
            if (value === 'none') onChange({ isGoldPriceApplied: false, goldPriceType: null });
            else if (value === 'legacy') onChange({ isGoldPriceApplied: true, goldPriceType: null });
            else if (types.some(([type]) => type === value)) onChange({ isGoldPriceApplied: true, goldPriceType: value as Exclude<GoldPriceType, 'none' | 'legacy'> });
        }} className="p-2 border rounded-lg bg-white dark:bg-slate-900 dark:border-slate-600">{types.map(([value, label]) => <option key={value} value={value}>{label}</option>)}{currentType === 'legacy' && <option value="legacy">Legacy (Base Price)</option>}{!knownType && <option value={currentType}>Unknown gold type</option>}</select></div>
        <dl className="grid grid-cols-1 sm:grid-cols-3 gap-4"><div><dt>Applied Price</dt><dd className="font-semibold">{currentType === 'none' ? 'Not applied' : `${money(price)} /g`}</dd></div><div><dt>Product Weight</dt><dd className="font-semibold">{weight !== null && weight > 0 ? `${weight} g` : 'Unavailable'}</dd></div><div><dt>Calculated COGS</dt><dd className="font-semibold">{currentType === 'none' ? 'Not applied' : money(calculated)}</dd></div></dl>
        {currentType !== 'none' && currency !== currentAccount.currency && <p role="status">Gold rates use {currency}, which differs from the account currency ({currentAccount.currency}). No currency conversion is performed here.</p>}
        {currentType !== 'none' && (calculated === null ? <p role="status" className="text-amber-800 dark:text-amber-300">A valid gold type, configured rate, and positive product weight are required. Cost cannot be calculated.</p> : <p className="text-sm text-amber-800 dark:text-amber-300">Calculated gold cost: {money(calculated)}. Gold pricing takes precedence over manual COGS and BOM costs when applied.</p>)}
    </section>;
}
