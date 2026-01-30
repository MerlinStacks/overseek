/**
 * Ads Step
 * 
 * Fourth step in onboarding: Connect Google Ads and Meta Ads accounts.
 * Supports OAuth for Google and token-based auth for Meta.
 */

import React, { useState } from 'react';
import { TrendingUp, ArrowRight, ArrowLeft, SkipForward, CheckCircle, AlertCircle, Loader2, ExternalLink } from 'lucide-react';
import { OnboardingStepProps } from '../types';
import { useAuth } from '../../../context/AuthContext';
import { useAccount } from '../../../context/AccountContext';
import { Logger } from '../../../utils/logger';

// Google Icon component
function GoogleIcon({ className }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 24 24" fill="currentColor">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
        </svg>
    );
}

// Meta (Facebook) Icon component
function MetaIcon({ className }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2.04c-5.5 0-10 4.49-10 10.02 0 5 3.66 9.15 8.44 9.9v-7H7.9v-2.9h2.54V9.85c0-2.51 1.49-3.89 3.78-3.89 1.09 0 2.23.19 2.23.19v2.47h-1.26c-1.24 0-1.63.77-1.63 1.56v1.88h2.78l-.45 2.9h-2.33v7a10 10 0 0 0 8.44-9.9c0-5.53-4.5-10.02-10-10.02z" />
        </svg>
    );
}

/**
 * Handles Google Ads OAuth and Meta Ads token configuration.
 */
export function AdsStep({ draft, setDraft, onNext, onBack, onSkip, isSubmitting }: OnboardingStepProps) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [googleLoading, setGoogleLoading] = useState(false);
    const [metaLoading, setMetaLoading] = useState(false);
    const [metaToken, setMetaToken] = useState(draft.ads.metaAccessToken || '');
    const [metaAccountId, setMetaAccountId] = useState(draft.ads.metaAdAccountId || '');
    const [metaError, setMetaError] = useState<string | null>(null);
    const [metaSuccess, setMetaSuccess] = useState(false);

    const handleGoogleOAuth = async () => {
        setGoogleLoading(true);
        try {
            // Request OAuth URL from backend
            const res = await fetch('/api/ads/google/auth-url', {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'X-Account-Id': currentAccount?.id || ''
                }
            });

            if (!res.ok) throw new Error('Failed to get auth URL');

            const data = await res.json();

            // Open OAuth window
            if (data.authUrl) {
                const popup = window.open(data.authUrl, 'google-ads-auth', 'width=600,height=700');

                // Poll for completion
                const checkInterval = setInterval(() => {
                    if (popup?.closed) {
                        clearInterval(checkInterval);
                        // Check if connection was successful
                        checkGoogleConnection();
                    }
                }, 500);
            }
        } catch (error) {
            Logger.error('Google OAuth failed', { error });
        } finally {
            setGoogleLoading(false);
        }
    };

    const checkGoogleConnection = async () => {
        try {
            const res = await fetch('/api/ads/accounts', {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'X-Account-Id': currentAccount?.id || ''
                }
            });

            if (res.ok) {
                const accounts = await res.json();
                const googleAccount = accounts.find((a: { platform: string }) => a.platform === 'GOOGLE_ADS');
                if (googleAccount) {
                    setDraft(prev => ({
                        ...prev,
                        ads: {
                            ...prev.ads,
                            googleConnected: true,
                            googleAccountId: googleAccount.externalId,
                            googleAccountName: googleAccount.name
                        }
                    }));
                }
            }
        } catch (error) {
            Logger.error('Failed to check Google connection', { error });
        }
    };

    const handleMetaConnect = async () => {
        if (!metaToken.trim() || !metaAccountId.trim()) {
            setMetaError('Both access token and account ID are required');
            return;
        }

        setMetaLoading(true);
        setMetaError(null);

        try {
            const res = await fetch('/api/ads/accounts', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'X-Account-Id': currentAccount?.id || ''
                },
                body: JSON.stringify({
                    platform: 'META_ADS',
                    accessToken: metaToken,
                    externalId: metaAccountId
                })
            });

            if (res.ok) {
                setMetaSuccess(true);
                setDraft(prev => ({
                    ...prev,
                    ads: {
                        ...prev.ads,
                        metaConnected: true,
                        metaAccessToken: metaToken,
                        metaAdAccountId: metaAccountId
                    }
                }));
            } else {
                const data = await res.json();
                setMetaError(data.error || 'Failed to connect Meta Ads');
            }
        } catch (error) {
            Logger.error('Meta Ads connection failed', { error });
            setMetaError('Failed to connect to Meta Ads');
        } finally {
            setMetaLoading(false);
        }
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="text-center pb-4 border-b border-gray-100">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-green-100 text-green-600 mb-4">
                    <TrendingUp size={32} />
                </div>
                <h2 className="text-2xl font-bold text-gray-900">Connect Ad Accounts</h2>
                <p className="text-gray-500 mt-2">
                    Link Google Ads and Meta Ads for AI-powered campaign management
                </p>
            </div>

            {/* Google Ads */}
            <div className="bg-white rounded-xl p-5 border border-gray-200 shadow-sm">
                <div className="flex items-start gap-4">
                    <div className="flex-shrink-0 w-12 h-12 rounded-xl bg-blue-50 flex items-center justify-center">
                        <GoogleIcon className="w-6 h-6 text-blue-600" />
                    </div>
                    <div className="flex-1">
                        <h3 className="text-base font-semibold text-gray-900">Google Ads</h3>
                        <p className="text-sm text-gray-500 mt-0.5">
                            Connect via OAuth for secure access to your campaigns
                        </p>

                        {draft.ads.googleConnected ? (
                            <div className="mt-3 flex items-center gap-2 text-sm text-green-600">
                                <CheckCircle size={16} />
                                Connected: {draft.ads.googleAccountName || draft.ads.googleAccountId}
                            </div>
                        ) : (
                            <button
                                onClick={handleGoogleOAuth}
                                disabled={googleLoading}
                                className="mt-3 inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
                            >
                                {googleLoading ? (
                                    <Loader2 size={16} className="animate-spin" />
                                ) : (
                                    <GoogleIcon className="w-4 h-4" />
                                )}
                                {googleLoading ? 'Connecting...' : 'Connect Google Ads'}
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* Meta Ads */}
            <div className="bg-white rounded-xl p-5 border border-gray-200 shadow-sm">
                <div className="flex items-start gap-4">
                    <div className="flex-shrink-0 w-12 h-12 rounded-xl bg-blue-50 flex items-center justify-center">
                        <MetaIcon className="w-6 h-6 text-blue-700" />
                    </div>
                    <div className="flex-1">
                        <h3 className="text-base font-semibold text-gray-900">Meta Ads</h3>
                        <p className="text-sm text-gray-500 mt-0.5">
                            Enter your access token and ad account ID
                        </p>

                        {draft.ads.metaConnected ? (
                            <div className="mt-3 flex items-center gap-2 text-sm text-green-600">
                                <CheckCircle size={16} />
                                Connected: {draft.ads.metaAdAccountId}
                            </div>
                        ) : (
                            <div className="mt-3 space-y-3">
                                <div>
                                    <label className="block text-xs font-medium text-gray-600 mb-1">
                                        Access Token
                                    </label>
                                    <input
                                        type="password"
                                        value={metaToken}
                                        onChange={(e) => setMetaToken(e.target.value)}
                                        placeholder="EAAxxxxxxx..."
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-sm font-mono"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-gray-600 mb-1">
                                        Ad Account ID
                                    </label>
                                    <input
                                        type="text"
                                        value={metaAccountId}
                                        onChange={(e) => setMetaAccountId(e.target.value)}
                                        placeholder="act_123456789"
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-sm font-mono"
                                    />
                                </div>

                                <button
                                    onClick={handleMetaConnect}
                                    disabled={metaLoading || !metaToken.trim() || !metaAccountId.trim()}
                                    className="inline-flex items-center gap-2 px-4 py-2 bg-blue-700 text-white rounded-lg text-sm font-medium hover:bg-blue-800 disabled:opacity-50 transition-colors"
                                >
                                    {metaLoading ? (
                                        <Loader2 size={16} className="animate-spin" />
                                    ) : (
                                        <MetaIcon className="w-4 h-4" />
                                    )}
                                    {metaLoading ? 'Connecting...' : 'Connect Meta Ads'}
                                </button>

                                {metaError && (
                                    <p className="text-sm text-red-600 flex items-center gap-1.5">
                                        <AlertCircle size={14} />
                                        {metaError}
                                    </p>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Skip Hint */}
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-sm text-gray-600">
                <p>
                    Ad accounts are optional during setup. You can connect them later in Settings → Ad Accounts.
                </p>
            </div>

            {/* Navigation */}
            <div className="flex items-center justify-between pt-4 border-t border-gray-100">
                <button
                    type="button"
                    onClick={onBack}
                    className="flex items-center gap-2 px-4 py-2 text-gray-600 hover:text-gray-800 transition-colors font-medium"
                >
                    <ArrowLeft size={18} />
                    Back
                </button>

                <div className="flex items-center gap-3">
                    <button
                        type="button"
                        onClick={onSkip}
                        className="flex items-center gap-2 px-4 py-2 text-gray-500 hover:text-gray-700 transition-colors text-sm"
                    >
                        <SkipForward size={16} />
                        Skip for now
                    </button>
                    <button
                        type="button"
                        onClick={onNext}
                        disabled={isSubmitting}
                        className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors font-semibold shadow-lg shadow-blue-500/25"
                    >
                        Continue
                        <ArrowRight size={18} />
                    </button>
                </div>
            </div>
        </div>
    );
}
