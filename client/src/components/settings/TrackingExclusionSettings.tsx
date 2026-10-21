import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { useScopedRequest } from '../../hooks/useScopedRequest';
import { useScopedMutation } from '../../hooks/useScopedMutation';
import { isRecord } from '../../utils/responseValidation';
import { isIpOrCidr } from '../../utils/ipAddress';

function decodeExclusions(value: unknown): string[] {
    // Existing invalid legacy entries must remain visible so the user can remove them.
    if (!isRecord(value) || value.success === false || !Array.isArray(value.excludedIps) || !value.excludedIps.every(item => typeof item === 'string')) throw new Error('Invalid exclusions');
    return [...new Set(value.excludedIps)];
}
export function TrackingExclusionSettings() {
    const { token } = useAuth(); const { currentAccount } = useAccount();
    if (!token || !currentAccount) return <p role="status">Select an account to manage tracking exclusions.</p>;
    return <AccountExclusions key={JSON.stringify([token, currentAccount.id])} token={token} accountId={currentAccount.id} />;
}
function AccountExclusions({ token, accountId }: { token: string; accountId: string }) {
    const endpoint = `/api/accounts/${encodeURIComponent(accountId)}/excluded-ips`;
    const read = useScopedRequest(endpoint, accountId, token, decodeExclusions); const mutation = useScopedMutation();
    const [override, setOverride] = useState<string[] | null>(null); const [ip, setIp] = useState(''); const [validation, setValidation] = useState<string | null>(null);
    const change = async (kind: 'manual' | 'detected' | 'delete', target?: string) => {
        if (mutation.isPending() || read.loading || read.error) return;
        const entered = ip.trim();
        if (kind === 'manual' && !isIpOrCidr(entered)) { setValidation('Enter a valid IPv4, IPv6 or CIDR range.'); return; }
        setValidation(null);
        const result = await mutation.run(async signal => {
            let address = entered;
            if (kind === 'detected') {
                const response = await fetch('https://api.ipify.org?format=json', { signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
                if (!response.ok) throw new Error('IP detection failed');
                const data: unknown = await response.json();
                if (!isRecord(data) || typeof data.ip !== 'string' || data.ip.includes('/') || !isIpOrCidr(data.ip)) throw new Error('Invalid detected IP');
                address = data.ip;
            }
            if (signal.aborted) throw new Error('Cancelled');
            const response = await fetch(kind === 'delete' ? `${endpoint}/${encodeURIComponent(target!)}` : endpoint, {
                method: kind === 'delete' ? 'DELETE' : 'POST', signal,
                headers: { Authorization: `Bearer ${token}`, 'x-account-id': accountId, 'Content-Type': 'application/json' },
                ...(kind === 'delete' ? {} : { body: JSON.stringify({ ip: address }) })
            });
            if (!response.ok) throw new Error('Exclusion update failed');
            return decodeExclusions(await response.json());
        }, 'Could not confirm the exclusion update. The current list and your input are retained; check their status before retrying.');
        if (result.ok) { setOverride(result.value); if (kind === 'manual') setIp(''); }
    };
    if (read.loading) return <p role="status">Loading tracking exclusions...</p>;
    if (read.error || !read.data) return <p role="alert">Could not load tracking exclusions. <button type="button" onClick={read.retry}>Retry exclusions</button></p>;
    const list = override ?? read.data;
    return <section aria-label="Tracking exclusions" className="p-6 rounded-xl space-y-4 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100">
        <h2 className="font-semibold">Tracking Exclusions</h2><p className="text-sm">Exclude your team’s IP addresses or CIDR ranges from analytics tracking.</p>
        {(validation || mutation.error) && <p role="alert">{validation || mutation.error}</p>}{mutation.busy && <p role="status">Updating exclusions...</p>}
        <fieldset disabled={mutation.busy} className="space-y-4"><form onSubmit={event => { event.preventDefault(); void change('manual'); }} className="flex flex-wrap items-end gap-3"><label className="text-sm">IP address or CIDR range<input value={ip} onChange={event => setIp(event.target.value)} className="block p-2 border rounded-lg dark:bg-slate-900 dark:border-slate-600" /></label><button type="submit" disabled={!ip.trim()}>Add IP</button><button type="button" onClick={() => void change('detected')}>Add My IP</button></form>
            <p className="text-xs text-slate-500 dark:text-slate-400">“Add My IP” contacts ipify.org only when selected. No account credentials are sent to that service.</p>
            {!list.length ? <p>No excluded IPs.</p> : <ul className="space-y-2">{list.map(item => <li key={item} className="flex flex-wrap justify-between gap-3"><code>{item}</code><button type="button" aria-label={`Remove IP ${item}`} onClick={() => void change('delete', item)}>Remove IP</button></li>)}</ul>}
        </fieldset>
    </section>;
}
