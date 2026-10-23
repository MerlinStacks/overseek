/**
 * Store Step
 * 
 * First step in onboarding: Connect WooCommerce store with API credentials.
 * Includes connection testing functionality.
 */

import { useState, useEffect, useRef } from 'react';
import { Store, ArrowRight, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { OnboardingStepProps } from '../types';
import { useAuth } from '../../../context/AuthContext';
import { useAccount } from '../../../context/AccountContext';
import { Logger } from '../../../utils/logger';

/**
 * Handles store name, domain, and WooCommerce API credentials.
 * Provides a "Test Connection" button to verify credentials before proceeding.
 * Creates the account immediately after successful test to ensure valid accountId
 * is available for subsequent steps (especially plugin configuration).
 */
export function StoreStep({ draft, setDraft, onNext, isSubmitting }: OnboardingStepProps) {
    const { token, logout } = useAuth();
    const { refreshAccounts, currentAccount, setCurrentAccount } = useAccount();
    const [testStatus, setTestStatus] = useState<'idle' | 'loading' | 'success' | 'error'>(() => draft.store.connectionVerified && !!currentAccount?.id && draft.store.accountId === currentAccount.id ? 'success' : 'idle');
    const [testError, setTestError] = useState<string | null>(null);
    const [isCreatingAccount, setIsCreatingAccount] = useState(false);
    // True only when the wizard store/account has been successfully created.
    const [accountCreated, setAccountCreated] = useState(() => Boolean(draft.store.connectionVerified && currentAccount?.id && draft.store.accountId === currentAccount.id));
    const autoAdvanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lifecycle = useRef<AbortController | null>(null);
    const pending = useRef(false);
    useEffect(() => {
        const controller = new AbortController(); lifecycle.current = controller;
        return () => controller.abort();
    }, []);

    // Auto-advance to next step after successful test + account creation
    useEffect(() => {
        if (accountCreated && testStatus === 'success') {
            autoAdvanceTimer.current = setTimeout(() => {
                onNext();
            }, 1500);
        }
        return () => {
            if (autoAdvanceTimer.current) clearTimeout(autoAdvanceTimer.current);
        };
    }, [accountCreated, testStatus, onNext]);

    const handleChange = (field: keyof typeof draft.store, value: string | boolean) => {
        setDraft(prev => ({
            ...prev,
            store: { ...prev.store, [field]: value, ...(['wooUrl', 'wooConsumerKey', 'wooConsumerSecret'].includes(field) ? { connectionVerified: false, accountId: undefined } : {}) }
        }));
        // Reset test status when credentials change
        if (['wooUrl', 'wooConsumerKey', 'wooConsumerSecret'].includes(field as string)) {
            setTestStatus('idle');
            setTestError(null);
            setAccountCreated(false); // Reset account creation if credentials change
        }
    };

    /**
     * Tests the WooCommerce connection. If successful and account doesn't exist yet,
     * creates the account immediately to ensure valid accountId for plugin config.
     */
    const testConnection = async () => {
        const signal = lifecycle.current?.signal;
        if (!signal || signal.aborted || pending.current) return;
        pending.current = true;
        setTestStatus('loading');
        setTestError(null);

        try {
            const res = await fetch('/api/woocommerce/test', {
                method: 'POST',
                signal,
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    wooUrl: draft.store.wooUrl,
                    wooConsumerKey: draft.store.wooConsumerKey,
                    wooConsumerSecret: draft.store.wooConsumerSecret
                })
            });

            const data = await res.json();
            if (signal.aborted) return;

            if (res.ok && data.success) {
                // Ensure this wizard flow has an actual persisted account before continuing.
                if (!accountCreated) {
                    await createAccountEarly();
                } else {
                    setTestStatus('success');
                    setDraft(prev => ({ ...prev, store: { ...prev.store, connectionVerified: true, accountId: currentAccount?.id } }));
                    setAccountCreated(true);
                }
            } else {
                setTestStatus('error');
                setTestError(data.error || 'Could not connect to WooCommerce store');
            }
        } catch (error) {
            if (signal.aborted) return;
            Logger.error('WooCommerce connection test failed', { error });
            setTestStatus('error');
            setTestError('Failed to test connection. Please check the URL and try again.');
        } finally {
            pending.current = false;
        }
    };

    /**
     * Creates the account early in the wizard flow.
     * Why: The plugin config step needs a valid accountId, which only exists after account creation.
     * Previously, accountId was incorrectly set to store name or 'pending' causing API failures.
     */
    const createAccountEarly = async () => {
        const signal = lifecycle.current?.signal;
        if (!signal || signal.aborted) return;
        setIsCreatingAccount(true);
        try {
            const res = await fetch('/api/accounts', {
                method: 'POST',
                signal,
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    name: draft.store.name,
                    domain: draft.store.domain || draft.store.wooUrl,
                    wooUrl: draft.store.wooUrl,
                    wooConsumerKey: draft.store.wooConsumerKey,
                    wooConsumerSecret: draft.store.wooConsumerSecret
                })
            });
            if (signal.aborted) return;

            if (res.status === 401) {
                logout();
                return;
            }

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || 'Failed to create account');
            }

            const createdAccount = await res.json();
            if (signal.aborted) return;
            if (typeof createdAccount?.id !== 'string' || !createdAccount.id) throw new Error('Account creation returned no account ID');

            // Refresh account list and explicitly switch context to the newly created account.
            await refreshAccounts();
            if (signal.aborted) return;
            if (createdAccount?.id) {
                setCurrentAccount(createdAccount);
            }

            setTestStatus('success');
            setDraft(prev => ({ ...prev, store: { ...prev.store, connectionVerified: true, accountId: createdAccount.id } }));
            setAccountCreated(true);
            Logger.info('Account created early in wizard flow');
        } catch (error) {
            if (signal.aborted) return;
            Logger.error('Early account creation failed', { error });
            // Fatal for this step: plugin/config steps need a real account id.
            setTestStatus('error');
            handleChange('connectionVerified', false);
            setTestError('Account setup incomplete. Please try again.');
        } finally {
            if (!signal.aborted) setIsCreatingAccount(false);
        }
    };

    const canProceed = draft.store.name.trim() &&
        draft.store.wooUrl.trim() &&
        draft.store.wooConsumerKey.trim() &&
        draft.store.wooConsumerSecret.trim();

    // Derived state: connection has been verified (prevents editing after success)
    const connectionVerified = testStatus === 'success' && accountCreated;

    // Stricter Continue gate: require account to actually exist before proceeding
    const canContinue = (canProceed || connectionVerified) && accountCreated && !isCreatingAccount;

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="text-center pb-4 border-b border-gray-100">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-lg bg-[var(--brand-subtle)] text-[var(--brand-text)] mb-4">
                    <Store size={32} />
                </div>
                <h2 className="text-2xl font-bold text-gray-900">Connect Your Store</h2>
                <p className="text-gray-500 mt-2">
                    Enter your WooCommerce store details and API credentials
                </p>
            </div>

            {/* Form Fields */}
            <div className="space-y-5">
                {/* Store Name & Domain Row */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1.5">
                            Store Name <span className="text-red-500">*</span>
                        </label>
                        <input
                            type="text"
                            value={draft.store.name}
                            onChange={(e) => handleChange('name', e.target.value)}
                            placeholder="My Awesome Store"
                            disabled={connectionVerified}
                            className={`w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[var(--brand-border)] focus:border-[var(--primary-color)] outline-none transition-colors ${connectionVerified ? 'bg-gray-100 cursor-not-allowed' : ''}`}
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1.5">
                            Domain URL <span className="text-gray-400">(optional)</span>
                        </label>
                        <input
                            type="url"
                            value={draft.store.domain}
                            onChange={(e) => handleChange('domain', e.target.value)}
                            placeholder="https://mystore.com"
                            className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[var(--brand-border)] focus:border-[var(--primary-color)] outline-none transition-colors"
                        />
                    </div>
                </div>

                {/* WooCommerce Credentials */}
                <div className="bg-slate-50 rounded-xl p-5 border border-slate-200">
                    <h3 className="text-sm font-semibold text-gray-900 mb-1">WooCommerce API Credentials</h3>
                    <p className="text-xs text-gray-500 mb-4">
                        Find these in WooCommerce → Settings → Advanced → REST API. Create a key with <strong>Read/Write</strong> permissions.
                    </p>

                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1.5">
                                Store URL <span className="text-red-500">*</span>
                            </label>
                            <input
                                type="url"
                                value={draft.store.wooUrl}
                                onChange={(e) => handleChange('wooUrl', e.target.value)}
                                placeholder="https://mystore.com"
                                disabled={connectionVerified}
                            className={`w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[var(--brand-border)] focus:border-[var(--primary-color)] outline-none transition-colors ${connectionVerified ? 'bg-gray-100 cursor-not-allowed' : ''}`}
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1.5">
                                Consumer Key <span className="text-red-500">*</span>
                            </label>
                            <input
                                type="text"
                                value={draft.store.wooConsumerKey}
                                onChange={(e) => handleChange('wooConsumerKey', e.target.value)}
                                placeholder="ck_xxxxxxxxxxxxxxxxxxxxxxxx"
                                disabled={connectionVerified}
                                className={`w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[var(--brand-border)] focus:border-[var(--primary-color)] outline-none transition-colors font-mono text-sm ${connectionVerified ? 'bg-gray-100 cursor-not-allowed' : ''}`}
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1.5">
                                Consumer Secret <span className="text-red-500">*</span>
                            </label>
                            <input
                                type="password"
                                value={draft.store.wooConsumerSecret}
                                onChange={(e) => handleChange('wooConsumerSecret', e.target.value)}
                                placeholder="cs_xxxxxxxxxxxxxxxxxxxxxxxx"
                                disabled={connectionVerified}
                                className={`w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[var(--brand-border)] focus:border-[var(--primary-color)] outline-none transition-colors font-mono text-sm ${connectionVerified ? 'bg-gray-100 cursor-not-allowed' : ''}`}
                            />
                        </div>
                    </div>

                    {/* Test Connection Button */}
                    <div className="mt-4 pt-4 border-t border-slate-200">
                        <button
                            type="button"
                            onClick={testConnection}
                            disabled={!canProceed || testStatus === 'loading' || isCreatingAccount}
                            className="flex items-center gap-2 px-4 py-2 bg-slate-700 text-white rounded-lg hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-medium"
                        >
                            {(testStatus === 'loading' || isCreatingAccount) ? (
                                <Loader2 size={16} className="animate-spin" />
                            ) : (testStatus === 'success' && accountCreated) ? (
                                <CheckCircle size={16} className="text-green-400" />
                            ) : (
                                <Store size={16} />
                            )}
                            {testStatus === 'loading' ? 'Testing Connection...' :
                                isCreatingAccount ? 'Setting Up Store...' :
                                    (testStatus === 'success' && accountCreated) ? 'Store Ready' :
                                        'Test Connection'}
                        </button>

                        {testStatus === 'success' && accountCreated && (
                            <p className="mt-2 text-sm text-green-600 flex items-center gap-1.5">
                                <CheckCircle size={14} />
                                Connected and ready! Advancing to plugin setup…
                            </p>
                        )}

                        {testStatus === 'error' && testError && (
                            <p className="mt-2 text-sm text-red-600 flex items-center gap-1.5">
                                <AlertCircle size={14} />
                                {testError}
                            </p>
                        )}
                    </div>
                </div>
            </div>

            {/* Navigation */}
            <div className="flex justify-end pt-4 border-t border-gray-100">
                <button
                    type="button"
                    onClick={onNext}
                    disabled={!canContinue || isSubmitting}
                            className="flex items-center gap-2 px-6 py-3 bg-[var(--primary-color)] text-[var(--primary-foreground)] rounded-lg hover:bg-[var(--primary-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-semibold focus-visible:outline-[var(--focus-color)]"
                >
                    Continue
                    <ArrowRight size={18} />
                </button>
            </div>
        </div>
    );
}
