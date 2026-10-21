import { useState } from 'react';
import { useAccount } from '../../context/AccountContext';
import { useAuth } from '../../context/AuthContext';
import { useAccountFeature } from '../../hooks/useAccountFeature';
import { useScopedMutation } from '../../hooks/useScopedMutation';
import { nonnegativeNumber } from '../../utils/responseValidation';

const fields = [['goldPrice', 'Base gold price'], ['goldPrice18ct', '18ct Gold Price'], ['goldPrice9ct', '9ct Gold Price'], ['goldPrice18ctWhite', '18ct White Gold Price'], ['goldPrice9ctWhite', '9ct White Gold Price'], ['goldPriceMargin', 'Margin (%)']] as const;
type Values = Record<typeof fields[number][0], string>;
export function GoldPriceSettings() {
    const { currentAccount, refreshAccounts } = useAccount(); const { token } = useAuth();
    const enabled = useAccountFeature('GOLD_PRICE_CALCULATOR');
    if (!enabled || !currentAccount || !token) return null;
    const values = Object.fromEntries(fields.map(([key]) => [key, currentAccount[key] == null ? '' : String(currentAccount[key])])) as Values;
    return <GoldSettings key={JSON.stringify([currentAccount.id, token, values])} initial={values} token={token} accountId={currentAccount.id} currency={currentAccount.goldPriceCurrency || currentAccount.currency} refreshAccounts={refreshAccounts} />;
}
function GoldSettings({ initial, token, accountId, currency, refreshAccounts }: { initial: Values; token: string; accountId: string; currency: string; refreshAccounts: () => Promise<void> }) {
    const [values, setValues] = useState(initial); const [message, setMessage] = useState<string | null>(null);
    const [validation, setValidation] = useState<string | null>(null); const mutation = useScopedMutation();
    const save = async (mode: 'all' | 'margin' | 'market') => {
        if (mutation.isPending()) return;
        const keys = mode === 'margin' ? ['goldPriceMargin'] as const : fields.map(([key]) => key);
        const selected = keys.filter(key => mode === 'margin' || values[key] !== initial[key]);
        if (mode !== 'market' && (!selected.length || selected.some(key => nonnegativeNumber(values[key]) === null))) { setValidation('Enter valid, nonnegative values for changed fields. Missing rates must not be replaced with zero automatically.'); return; }
        setValidation(null); setMessage(null);
        // Strings preserve explicit zero through the legacy account endpoint's truthiness checks.
        const body = mode === 'market' ? { refreshGoldPrice: true } : Object.fromEntries(selected.map(key => [key, values[key].trim()]));
        const result = await mutation.run(async signal => {
            const response = await fetch(`/api/accounts/${encodeURIComponent(accountId)}`, { method: 'PUT', signal, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
            if (!response.ok) throw new Error('Update failed');
            if (signal.aborted) throw new Error('Cancelled');
            try { await refreshAccounts(); return true; }
            catch { return false; } // A refresh failure must not turn a saved mutation into a retry.
        }, 'Could not confirm gold price updates. Your inputs are retained; check their status before retrying.');
        if (!result.ok) return;
        setMessage(!result.value ? 'Update accepted, but account data could not be refreshed. Reload settings before editing again.' : mode === 'market' ? 'Market refresh completed. Check the account notification if the provider is unavailable.' : 'Gold price settings saved.');
    };
    return <section aria-label="Gold price settings" className="p-6 space-y-4 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100">
        <h2 className="font-semibold">Gold Price Configuration</h2><p className="text-sm">Rates are per gram in {currency || 'currency unavailable'}. Blank fields mean no configured rate.</p>
        {(validation || mutation.error) && <p role="alert">{validation || mutation.error}</p>}{message && <p role="status">{message}</p>}
        <fieldset disabled={mutation.busy} className="space-y-4"><div className="grid grid-cols-1 sm:grid-cols-2 gap-4">{fields.map(([key, label]) => <label key={key} className="block text-sm">{label}<input type="number" min="0" step={key === 'goldPriceMargin' ? '0.1' : '0.01'} value={values[key]} onChange={event => setValues(previous => ({ ...previous, [key]: event.target.value }))} className="block mt-1 w-full p-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900" /></label>)}</div>
            <div className="flex flex-wrap gap-3"><button type="button" onClick={() => void save('margin')}>Save Margin</button><button type="button" onClick={() => void save('all')}>Save All Prices</button><button type="button" onClick={() => void save('market')}>Refresh from Market</button></div>
        </fieldset>{mutation.busy && <p role="status">Updating gold prices...</p>}
    </section>;
}
