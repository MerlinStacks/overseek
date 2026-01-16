import { useEffect, useState } from 'react';
import { Logger } from '../../utils/logger';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { GoogleAdsCampaigns } from './GoogleAdsCampaigns';
import { Loader2, Megaphone, Plus } from 'lucide-react';

interface AdAccount {
    id: string;
    platform: string;
    name: string;
    externalId: string;
}

/**
 * AdPerformanceView displays campaign performance for connected ad accounts.
 * Each account is shown as a sub-tab, with the campaign breakdown displayed below.
 */
export function AdPerformanceView() {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [accounts, setAccounts] = useState<AdAccount[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);

    useEffect(() => {
        fetchAccounts();
    }, [currentAccount, token]);

    async function fetchAccounts() {
        if (!currentAccount) return;
        try {
            const res = await fetch('/api/ads', {
                headers: { 'Authorization': `Bearer ${token}`, 'X-Account-ID': currentAccount.id }
            });
            const data = await res.json();
            // Filter out accounts with pending setup
            const activeAccounts = Array.isArray(data)
                ? data.filter((acc: AdAccount) => acc.externalId !== 'PENDING_SETUP')
                : [];
            setAccounts(activeAccounts);
            // Auto-select first account if none selected
            if (activeAccounts.length > 0 && !selectedAccountId) {
                setSelectedAccountId(activeAccounts[0].id);
            }
        } catch (err) {
            Logger.error('Failed to fetch ad accounts:', { error: err });
        } finally {
            setIsLoading(false);
        }
    }

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
            </div>
        );
    }

    if (accounts.length === 0) {
        return (
            <div className="text-center py-16 bg-gray-50 rounded-xl border border-dashed border-gray-300">
                <div className="w-16 h-16 mx-auto mb-4 bg-gray-100 rounded-full flex items-center justify-center">
                    <Megaphone className="w-8 h-8 text-gray-400" />
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">No Ad Accounts Connected</h3>
                <p className="text-gray-500 mb-4">Connect your ad accounts to see campaign performance data.</p>
                <a
                    href="/marketing?tab=ads"
                    className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                    <Plus size={18} />
                    Connect Ad Account
                </a>
            </div>
        );
    }

    const selectedAccount = accounts.find(acc => acc.id === selectedAccountId);

    return (
        <div className="space-y-6">
            {/* Sub-tabs for each ad account */}
            <div className="flex gap-2 overflow-x-auto pb-2">
                {accounts.map(acc => {
                    const isActive = selectedAccountId === acc.id;
                    return (
                        <button
                            key={acc.id}
                            onClick={() => setSelectedAccountId(acc.id)}
                            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm whitespace-nowrap transition-all ${isActive
                                ? 'bg-blue-600 text-white shadow-md'
                                : 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50 hover:border-gray-300'
                                }`}
                        >
                            {/* Platform icon */}
                            <span className={`w-5 h-5 flex items-center justify-center rounded ${isActive ? 'bg-white/20' : acc.platform === 'META' ? 'bg-blue-100' : 'bg-red-100'
                                }`}>
                                {acc.platform === 'META' ? (
                                    <svg className={`w-3 h-3 ${isActive ? 'text-white' : 'text-blue-600'}`} fill="currentColor" viewBox="0 0 24 24">
                                        <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
                                    </svg>
                                ) : (
                                    <svg className={`w-3 h-3 ${isActive ? 'text-white' : 'text-red-600'}`} fill="currentColor" viewBox="0 0 24 24">
                                        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                                        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                                        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                                        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                                    </svg>
                                )}
                            </span>
                            {acc.name}
                        </button>
                    );
                })}
            </div>

            {/* Campaign breakdown for selected account */}
            {selectedAccount && (
                <GoogleAdsCampaigns
                    adAccountId={selectedAccount.id}
                    accountName={selectedAccount.name}
                    onBack={() => { }} // No back behavior needed in sub-tab mode
                    hideBackButton
                />
            )}
        </div>
    );
}
