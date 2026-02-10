/**
 * AdAccountSettings
 * 
 * Settings panel for managing ad account connections.
 * Includes edit functionality to fix broken connections without removing/re-adding.
 */
import { useEffect, useState, useCallback } from 'react';
import { Logger } from '../../utils/logger';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { useAccountFeature } from '../../hooks/useAccountFeature';
import { Plus, Loader2 } from 'lucide-react';
import { AdAccountCard, AdAccount, AdInsights } from './AdAccountCard';
import { EditAdAccountModal, PendingSetupModal } from './AdAccountModals';
import { AdConnectForm } from './AdConnectForm';
import { Toast, ToastType } from '../ui/Toast';

export function AdAccountSettings() {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const isMetaEnabled = useAccountFeature('META_ADS');
    const isGoogleEnabled = useAccountFeature('GOOGLE_ADS');

    const [accounts, setAccounts] = useState<AdAccount[]>([]);
    const [insights, setInsights] = useState<Record<string, AdInsights>>({});
    const [loadingInsights, setLoadingInsights] = useState<Record<string, boolean>>({});
    const [insightErrors, setInsightErrors] = useState<Record<string, string>>({});
    const [isLoading, setIsLoading] = useState(true);
    const [showConnect, setShowConnect] = useState(false);
    const [formPlatform, setFormPlatform] = useState('META');

    const [editingAccount, setEditingAccount] = useState<AdAccount | null>(null);
    const [editForm, setEditForm] = useState({ name: '', externalId: '', accessToken: '', refreshToken: '' });
    const [isSavingEdit, setIsSavingEdit] = useState(false);

    const [pendingSetup, setPendingSetup] = useState({ show: false, pendingId: '', customerId: '', isSubmitting: false });

    const [toastMessage, setToastMessage] = useState('');
    const [toastVisible, setToastVisible] = useState(false);
    const [toastType, setToastType] = useState<ToastType>('error');
    const showToast = useCallback((message: string, type: ToastType = 'error') => {
        setToastMessage(message); setToastType(type); setToastVisible(true);
    }, []);

    useEffect(() => { fetchAccounts(); }, [currentAccount, token]);

    async function fetchAccounts() {
        if (!currentAccount) return;
        try {
            const res = await fetch('/api/ads', { headers: { 'Authorization': `Bearer ${token}`, 'X-Account-ID': currentAccount.id } });
            const data = await res.json();
            setAccounts(data);
            if (Array.isArray(data)) {
                data.forEach((acc: AdAccount) => { if (acc.externalId !== 'PENDING_SETUP') fetchInsights(acc.id); });
            }
        } catch (err) {
            Logger.error('An error occurred', { error: err });
        } finally {
            setIsLoading(false);
        }
    }

    async function fetchInsights(adAccountId: string) {
        setLoadingInsights(prev => ({ ...prev, [adAccountId]: true }));
        setInsightErrors(prev => ({ ...prev, [adAccountId]: '' }));
        try {
            const res = await fetch(`/api/ads/${adAccountId}/insights`, {
                headers: { 'Authorization': `Bearer ${token}`, 'X-Account-ID': currentAccount?.id || '' }
            });
            if (!res.ok) throw new Error(`Failed to load insights (${res.status})`);
            const data = await res.json();
            if (!data.error) setInsights(prev => ({ ...prev, [adAccountId]: data }));
            else setInsightErrors(prev => ({ ...prev, [adAccountId]: data.error }));
        } catch (err: any) {
            setInsightErrors(prev => ({ ...prev, [adAccountId]: err.message || 'Connection error' }));
            setInsights(prev => { const n = { ...prev }; delete n[adAccountId]; return n; });
        } finally {
            setLoadingInsights(prev => ({ ...prev, [adAccountId]: false }));
        }
    }

    async function handleGoogleOAuth(existingAccountId?: string) {
        if (!currentAccount) return;
        try {
            const params = new URLSearchParams({ redirect: '/settings?tab=ads', ...(existingAccountId && { reconnectId: existingAccountId }) });
            const res = await fetch(`/api/oauth/google/authorize?${params.toString()}`, {
                headers: { 'Authorization': `Bearer ${token}`, 'X-Account-ID': currentAccount.id }
            });
            const data = await res.json();
            if (data.authUrl) window.location.href = data.authUrl;
            else showToast('Failed to initiate Google OAuth');
        } catch { showToast('Error initiating Google OAuth'); }
    }

    async function handleMetaOAuth(existingAccountId?: string) {
        if (!currentAccount) return;
        try {
            const params = new URLSearchParams({ redirect: '/settings?tab=ads', ...(existingAccountId && { reconnectId: existingAccountId }) });
            const res = await fetch(`/api/oauth/meta/ads/authorize?${params.toString()}`, {
                headers: { 'Authorization': `Bearer ${token}`, 'X-Account-ID': currentAccount.id }
            });
            const data = await res.json();
            if (data.authUrl) window.location.href = data.authUrl;
            else showToast('Failed to initiate Meta OAuth');
        } catch { showToast('Error initiating Meta OAuth'); }
    }

    async function handleDisconnect(adAccountId: string) {
        if (!confirm('Are you sure you want to disconnect this ad account?')) return;
        try {
            const res = await fetch(`/api/ads/${adAccountId}`, {
                method: 'DELETE', headers: { 'Authorization': `Bearer ${token}`, 'X-Account-ID': currentAccount?.id || '' }
            });
            if (res.ok) { fetchAccounts(); showToast('Account disconnected', 'success'); } else showToast('Failed to disconnect');
        } catch { showToast('Error disconnecting account'); }
    }

    function openEditModal(account: AdAccount) {
        setEditingAccount(account);
        setEditForm({ name: account.name || '', externalId: account.externalId || '', accessToken: '', refreshToken: '' });
    }

    async function handleSaveEdit() {
        if (!editingAccount || !currentAccount) return;
        setIsSavingEdit(true);
        try {
            const payload: Record<string, string> = {};
            if (editForm.name && editForm.name !== editingAccount.name) payload.name = editForm.name;
            if (editForm.externalId && editForm.externalId !== editingAccount.externalId) payload.externalId = editForm.externalId;
            if (editForm.accessToken) payload.accessToken = editForm.accessToken;
            if (editForm.refreshToken) payload.refreshToken = editForm.refreshToken;
            if (Object.keys(payload).length === 0) { setEditingAccount(null); return; }

            const res = await fetch(`/api/ads/${editingAccount.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`, 'X-Account-ID': currentAccount.id },
                body: JSON.stringify(payload)
            });
            if (res.ok) { setEditingAccount(null); fetchAccounts(); showToast('Account updated', 'success'); }
            else { const err = await res.json(); showToast(err.error || 'Failed to update'); }
        } catch { showToast('Error updating account'); }
        finally { setIsSavingEdit(false); }
    }

    async function handleCompletePendingSetup() {
        if (!currentAccount || !pendingSetup.customerId.trim()) return;
        setPendingSetup(prev => ({ ...prev, isSubmitting: true }));
        try {
            const res = await fetch(`/api/ads/${pendingSetup.pendingId}/complete-setup`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`, 'X-Account-ID': currentAccount.id },
                body: JSON.stringify({ customerId: pendingSetup.customerId.trim() })
            });
            if (res.ok) {
                showToast('Google Ads account configured successfully!', 'success');
                setPendingSetup({ show: false, pendingId: '', customerId: '', isSubmitting: false });
                fetchAccounts();
            } else { const err = await res.json(); showToast(err.error || 'Failed to complete setup'); }
        } catch { showToast('Error completing setup'); }
        finally { setPendingSetup(prev => ({ ...prev, isSubmitting: false })); }
    }

    // Handle OAuth callback
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const success = params.get('success');
        if (success === 'google_connected') { showToast('Google Ads account connected successfully!', 'success'); window.history.replaceState({}, '', '/settings?tab=ads'); fetchAccounts(); }
        else if (success === 'google_reconnected') { showToast('Google Ads account reconnected successfully!', 'success'); window.history.replaceState({}, '', '/settings?tab=ads'); fetchAccounts(); }
        else if (success === 'meta_ads_connected') { showToast('Meta Ads account connected successfully!', 'success'); window.history.replaceState({}, '', '/settings?tab=ads'); fetchAccounts(); }
        else if (success === 'meta_ads_reconnected') { showToast('Meta Ads account reconnected successfully!', 'success'); window.history.replaceState({}, '', '/settings?tab=ads'); fetchAccounts(); }
        else if (success === 'google_pending') {
            const pendingId = params.get('pendingId') || '';
            setPendingSetup({ show: true, pendingId, customerId: '', isSubmitting: false });
            window.history.replaceState({}, '', '/settings?tab=ads'); fetchAccounts();
        } else if (params.get('error')) {
            showToast(`OAuth Error: ${params.get('error')}${params.get('message') ? ` - ${params.get('message')}` : ''}`);
            window.history.replaceState({}, '', '/settings?tab=ads');
        }
    }, []);

    return (
        <div className="space-y-6">
            <EditAdAccountModal
                account={editingAccount}
                form={editForm}
                onFormChange={setEditForm}
                onClose={() => setEditingAccount(null)}
                onSave={handleSaveEdit}
                isSaving={isSavingEdit}
            />
            <PendingSetupModal
                isOpen={pendingSetup.show}
                pendingId={pendingSetup.pendingId}
                customerId={pendingSetup.customerId}
                isSubmitting={pendingSetup.isSubmitting}
                onCustomerIdChange={(v) => setPendingSetup(prev => ({ ...prev, customerId: v }))}
                onClose={() => setPendingSetup({ show: false, pendingId: '', customerId: '', isSubmitting: false })}
                onComplete={handleCompletePendingSetup}
                onCancel={() => { handleDisconnect(pendingSetup.pendingId); setPendingSetup({ show: false, pendingId: '', customerId: '', isSubmitting: false }); }}
            />

            <div className="flex justify-between items-center">
                <div>
                    <h2 className="text-lg font-semibold text-gray-900">Connected Ad Accounts</h2>
                    <p className="text-sm text-gray-500">Manage your Meta and Google Ads integrations</p>
                </div>
                <button onClick={() => setShowConnect(!showConnect)} className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 text-sm">
                    <Plus size={16} />Connect Account
                </button>
            </div>

            {showConnect && (
                <AdConnectForm
                    platform={formPlatform}
                    onPlatformChange={setFormPlatform}
                    isMetaEnabled={isMetaEnabled}
                    isGoogleEnabled={isGoogleEnabled}
                    onGoogleOAuth={() => handleGoogleOAuth()}
                    onMetaOAuth={() => handleMetaOAuth()}
                />
            )}

            <div className="space-y-4">
                {isLoading ? (
                    <div className="text-center py-12"><Loader2 className="animate-spin inline text-gray-400" /></div>
                ) : accounts.length === 0 ? (
                    <div className="text-center py-12 text-gray-500 bg-gray-50 rounded-xl border border-dashed border-gray-300">
                        No ad accounts connected. Click "Connect Account" to get started.
                    </div>
                ) : (
                    accounts.map(acc => (
                        <AdAccountCard
                            key={acc.id}
                            account={acc}
                            insights={insights[acc.id]}
                            isLoadingInsights={loadingInsights[acc.id] || false}
                            error={insightErrors[acc.id]}
                            onRefresh={() => fetchInsights(acc.id)}
                            onEdit={() => openEditModal(acc)}
                            onDisconnect={() => handleDisconnect(acc.id)}
                            onCompleteSetup={() => setPendingSetup({ show: true, pendingId: acc.id, customerId: '', isSubmitting: false })}
                            onReconnect={() => acc.platform === 'GOOGLE' ? handleGoogleOAuth(acc.id) : handleMetaOAuth(acc.id)}
                        />
                    ))
                )}
            </div>

            <Toast message={toastMessage} isVisible={toastVisible} onClose={() => setToastVisible(false)} type={toastType} />
        </div>
    );
}
