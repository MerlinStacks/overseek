import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { useAccountFeature } from '../../hooks/useAccountFeature';
import { useScopedRequest } from '../../hooks/useScopedRequest';
import { useScopedMutation } from '../../hooks/useScopedMutation';
import { isRecord } from '../../utils/responseValidation';
import { navigateToSafeUrl } from '../../utils/url';
import { AdAccountCard, type AdAccount, type AdInsights } from './AdAccountCard';
import { EditAdAccountModal, PendingSetupModal } from './AdAccountModals';
import { AdConnectForm } from './AdConnectForm';
import { validAdAccountId } from './adAccountValues';

function decodeAccounts(value: unknown): AdAccount[] {
    if (!Array.isArray(value) || !value.every(item => isRecord(item) && ['id', 'name', 'externalId'].every(key => typeof item[key] === 'string') && ['GOOGLE', 'META'].includes(String(item.platform)))) throw new Error('Invalid ad accounts');
    return value as AdAccount[];
}
function decodeInsights(value: unknown): { data?: AdInsights; error?: { message: string; code?: string; isRecoverable?: boolean } } {
    if (!isRecord(value)) throw new Error('Invalid insights');
    if (typeof value.error === 'string') return { error: { message: value.error, code: typeof value.code === 'string' ? value.code : undefined, isRecoverable: value.isRecoverable === true } };
    if (!['spend', 'impressions', 'clicks', 'roas'].every(key => typeof value[key] === 'number' && Number.isFinite(value[key])) || typeof value.currency !== 'string' || !/^[A-Z]{3}$/i.test(value.currency)) throw new Error('Invalid insights');
    return { data: value as unknown as AdInsights };
}
export function AdAccountSettings() {
    const { token } = useAuth(); const { currentAccount } = useAccount();
    if (!token || !currentAccount) return <p role="status">Select an account to manage ad connections.</p>;
    return <ScopedAccounts key={JSON.stringify([token, currentAccount.id])} token={token} accountId={currentAccount.id} />;
}
function ScopedAccounts({ token, accountId }: { token: string; accountId: string }) {
    const request = useScopedRequest('/api/ads', accountId, token, decodeAccounts);
    const mutation = useScopedMutation(); const { isActive } = mutation;
    const isMetaEnabled = useAccountFeature('META_ADS'); const isGoogleEnabled = useAccountFeature('GOOGLE_ADS');
    const [showConnect, setShowConnect] = useState(false); const [platform, setPlatform] = useState('META');
    const [editing, setEditing] = useState<AdAccount | null>(null);
    const [form, setForm] = useState({ name: '', externalId: '', accessToken: '', refreshToken: '' });
    const [pending, setPending] = useState(''); const [customerId, setCustomerId] = useState(''); const [notice, setNotice] = useState('');
    const [insightsVersion, setInsightsVersion] = useState(0);
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const status = params.get('success'); const error = params.get('error');
        if (!status && !error) return;
        let disposed = false;
        queueMicrotask(() => {
            if (disposed || !isActive()) return;
            if (status === 'google_pending' && params.get('pendingId')) { setPending(params.get('pendingId')!); setCustomerId(''); }
            setNotice(error ? 'OAuth authorization did not complete. Check the connection and retry.' : 'Authorization returned. Verify the connection in the account list.');
            params.delete('success'); params.delete('pendingId'); params.delete('error'); params.delete('message');
            window.history.replaceState({}, '', `${window.location.pathname}${params.size ? `?${params}` : ''}${window.location.hash}`);
        });
        return () => { disposed = true; };
    }, [isActive]);
    const headers = { Authorization: `Bearer ${token}`, 'X-Account-ID': accountId, 'Content-Type': 'application/json' };
    const refresh = () => { request.retry(); setInsightsVersion(value => value + 1); };
    const oauth = async (kind: string, reconnectId?: string) => {
        if (mutation.isPending()) return;
        const result = await mutation.run(async signal => {
            const params = new URLSearchParams({ redirect: '/settings?tab=ads', ...(reconnectId ? { reconnectId } : {}) });
            const response = await fetch(`/api/oauth/${kind === 'GOOGLE' ? 'google' : 'meta/ads'}/authorize?${params}`, { headers, signal });
            const data: unknown = await response.json();
            if (!response.ok || !isRecord(data) || typeof data.authUrl !== 'string') throw new Error('Authorization unavailable');
            return data.authUrl;
        }, 'Could not start authorization. Check the connection before retrying.');
        if (result.ok && !navigateToSafeUrl(result.value)) setNotice('Invalid OAuth redirect URL.');
    };
    const disconnect = async (id: string) => {
        if (mutation.isPending() || !request.data?.some(account => account.id === id) || !confirm('Disconnect this ad account? This removes its saved connection.')) return;
        const result = await mutation.run(async signal => { const response = await fetch(`/api/ads/${encodeURIComponent(id)}`, { method: 'DELETE', headers, signal }); if (!response.ok) throw new Error('Disconnect rejected'); }, 'Could not confirm disconnect. Check the connection before retrying.');
        if (result.ok) { if (pending === id) setPending(''); setNotice('Account disconnected.'); refresh(); }
    };
    const save = async () => {
        if (mutation.isPending() || !editing || !form.name.trim() || !validAdAccountId(editing.platform, form.externalId)) return;
        const result = await mutation.run(async signal => {
            const response = await fetch(`/api/ads/${encodeURIComponent(editing.id)}`, { method: 'PATCH', headers, signal, body: JSON.stringify({ name: form.name.trim(), externalId: form.externalId.trim(), ...(form.accessToken ? { accessToken: form.accessToken } : {}), ...(form.refreshToken && editing.platform === 'GOOGLE' ? { refreshToken: form.refreshToken } : {}) }) });
            const data: unknown = await response.json();
            if (!response.ok || !isRecord(data) || data.id !== editing.id) throw new Error('Unconfirmed edit');
        }, 'Could not confirm saving the connection. Input retained; check the account before retrying.');
        if (result.ok) { setEditing(null); setForm({ name: '', externalId: '', accessToken: '', refreshToken: '' }); setNotice('Account updated.'); refresh(); }
    };
    const complete = async () => {
        if (mutation.isPending() || !validAdAccountId('GOOGLE', customerId) || !request.data?.some(account => account.id === pending && account.platform === 'GOOGLE' && account.externalId === 'PENDING_SETUP')) return;
        const result = await mutation.run(async signal => {
            const response = await fetch(`/api/ads/${encodeURIComponent(pending)}/complete-setup`, { method: 'PATCH', headers, signal, body: JSON.stringify({ customerId: customerId.trim() }) });
            const data: unknown = await response.json();
            if (!response.ok || !isRecord(data) || data.success !== true) throw new Error('Setup unconfirmed');
        }, 'Could not confirm setup. Check the connection before retrying.');
        if (result.ok) { setPending(''); setCustomerId(''); setNotice('Google Ads setup confirmed.'); refresh(); }
    };
    const pendingExists = request.data?.some(account => account.id === pending && account.platform === 'GOOGLE' && account.externalId === 'PENDING_SETUP');
    return <section className="space-y-5 text-slate-900 dark:text-slate-100"><h2>Connected Ad Accounts</h2>
        <EditAdAccountModal account={editing} form={form} onFormChange={setForm} onClose={() => { if (!mutation.isPending()) { setEditing(null); setForm({ name: '', externalId: '', accessToken: '', refreshToken: '' }); } }} onSave={() => void save()} isSaving={mutation.busy} error={mutation.error} />
        <PendingSetupModal isOpen={!!pending} pendingId={pendingExists ? pending : ''} customerId={customerId} onCustomerIdChange={setCustomerId} isSubmitting={mutation.busy} onClose={() => { if (!mutation.isPending()) setPending(''); }} onCancel={() => void disconnect(pending)} onComplete={() => void complete()} error={mutation.error || (!request.loading && !pendingExists ? 'Pending connection unavailable for this account. Close this dialog and refresh the account list.' : null)} />
        {notice && <p role="status">{notice}</p>}{mutation.error && !pending && !editing && <p role="alert">{mutation.error}</p>}{mutation.busy && <p role="status">Working...</p>}
        <fieldset disabled={mutation.busy || !!editing || !!pending} inert={mutation.busy || !!editing || !!pending} className="space-y-4">
            <button type="button" aria-expanded={showConnect} onClick={() => setShowConnect(value => !value)}>Connect Account</button>
            {showConnect && <AdConnectForm platform={platform} onPlatformChange={setPlatform} isMetaEnabled={isMetaEnabled} isGoogleEnabled={isGoogleEnabled} onGoogleOAuth={() => void oauth('GOOGLE')} onMetaOAuth={() => void oauth('META')} />}
            {request.loading ? <p role="status">Loading ad accounts...</p> : request.error ? <p role="alert">Ad accounts unavailable. <button type="button" onClick={request.retry}>Retry accounts</button></p> : !request.data?.length ? <p>No ad accounts connected.</p> : request.data.map(account => <AccountInsights key={`${account.id}:${insightsVersion}`} account={account} token={token} accountId={accountId} onEdit={() => { setEditing(account); setForm({ name: account.name, externalId: account.externalId, accessToken: '', refreshToken: '' }); }} onDisconnect={() => void disconnect(account.id)} onCompleteSetup={() => { setPending(account.id); setCustomerId(''); }} onReconnect={() => void oauth(account.platform, account.id)} />)}
        </fieldset>
    </section>;
}
function AccountInsights(props: { account: AdAccount; token: string; accountId: string; onEdit: () => void; onDisconnect: () => void; onCompleteSetup: () => void; onReconnect: () => void }) {
    const request = useScopedRequest(props.account.externalId === 'PENDING_SETUP' ? null : `/api/ads/${encodeURIComponent(props.account.id)}/insights`, props.accountId, props.token, decodeInsights);
    return <AdAccountCard {...props} insights={!request.loading && !request.error ? request.data?.data : undefined} isLoadingInsights={request.loading} error={request.error ? { message: 'Insights unavailable. Retry or reauthorize the connection.' } : request.data?.error} onRefresh={request.retry} />;
}
