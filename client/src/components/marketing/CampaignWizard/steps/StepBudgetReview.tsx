import { useState } from 'react';
import { type WizardStepProps } from '../types';
import { useAccount } from '../../../../context/AccountContext';
import { useAuth } from '../../../../context/AuthContext';
import { useScopedRequest } from '../../../../hooks/useScopedRequest';
import { isRecord } from '../../../../utils/responseValidation';
import { reportMoney } from '../../../analytics/useReportRequest';

function decodeAccount(value: unknown) {
    if (!Array.isArray(value) || !value.every(isRecord)) throw new Error('Invalid ad accounts');
    const account = value.find(item => item.platform === 'GOOGLE');
    return { name: typeof account?.name === 'string' ? account.name : null, currency: typeof account?.currency === 'string' ? account.currency : undefined };
}
export function StepBudgetReview(props: WizardStepProps) {
    const { token } = useAuth(); const { currentAccount } = useAccount();
    if (!token || !currentAccount) return <p role="alert">Select an account to review the budget.</p>;
    return <BudgetReview key={JSON.stringify([token, currentAccount.id])} {...props} token={token} accountId={currentAccount.id} />;
}
function BudgetReview({ draft, setDraft, token, accountId }: WizardStepProps & { token: string; accountId: string }) {
    const [input, setInput] = useState(String(draft.budget));
    const request = useScopedRequest('/api/ads', accountId, token, decodeAccount);
    return <section className="space-y-5 text-slate-900 dark:text-slate-100">
        <h3 className="text-2xl font-bold">Budget & Review</h3>
        {request.loading && <p role="status">Loading ad-account currency...</p>}
        {request.error && <p role="alert">Ad-account details unavailable. <button type="button" onClick={request.retry}>Retry</button></p>}
        <p>Campaign: {draft.name} · {draft.type === 'SEARCH' ? 'Search' : 'Unsupported campaign type'}</p>
        <p>Launch uses the first connected Google Ads account{request.data?.name ? `: ${request.data.name}` : ''}.</p>
        <label className="block">Daily budget ({request.data?.currency || 'currency unavailable'})
            <input aria-invalid={!Number.isFinite(draft.budget) || draft.budget <= 0} type="number" min="0.01" step="0.01" value={input} className="block p-2 border rounded-lg bg-white dark:bg-slate-900" onChange={event => {
                const value = event.target.value; setInput(value);
                setDraft(current => ({ ...current, budget: value.trim() ? Number(value) : NaN }));
            }} />
        </label>
        {(!Number.isFinite(draft.budget) || draft.budget <= 0) && <p role="alert">Enter a daily budget greater than zero.</p>}
        <p>Estimated monthly budget (daily × 30.4): {reportMoney(draft.budget > 0 ? draft.budget * 30.4 : NaN, request.data?.currency)}</p>
        <p>No location targeting is configured by this wizard. Review targeting and bidding in Google Ads before enabling the campaign.</p>
    </section>;
}
