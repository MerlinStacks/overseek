/**
 * Plugin Step
 * 
 * Second step in onboarding: Download and configure the OverSeek WooCommerce plugin.
 * Includes plugin download, configuration copy, and verification.
 */

import React, { useState } from 'react';
import { Plug, ArrowRight, ArrowLeft, SkipForward, Download, Copy, Check, Store, ExternalLink, AlertCircle, Loader2 } from 'lucide-react';
import { OnboardingStepProps } from '../types';
import { useAuth } from '../../../context/AuthContext';
import { useAccount } from '../../../context/AccountContext';
import { api } from '../../../services/api';
import { Logger } from '../../../utils/logger';
import { getPublicApiUrl } from '../../../utils/url';

interface StoreVerificationResult {
    success: boolean;
    storeUrl?: string;
    storeName?: string;
    storeReachable: boolean;
    pluginInstalled: boolean;
    pluginVersion?: string;
    configured?: boolean;
    accountMatch?: boolean;
    trackingEnabled?: boolean;
    chatEnabled?: boolean;
    error?: string;
}

/**
 * Handles plugin download, configuration copy, and store verification.
 */
export function PluginStep({ draft, setDraft, onNext, onBack, onSkip, isSubmitting }: OnboardingStepProps) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [configCopied, setConfigCopied] = useState(false);
    const [verifyStatus, setVerifyStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
    const [verifyResult, setVerifyResult] = useState<StoreVerificationResult | null>(null);

    // Public API URL for external clients (derived from browser location)
    const publicApiUrl = getPublicApiUrl();

    // Guard: Account must exist before showing plugin config
    // Previously, accountId fallback used store name or 'pending' which broke APIs
    const hasValidAccount = Boolean(currentAccount?.id);

    // Generate the configuration JSON that users paste into the plugin
    // Only valid when account exists (accountId must be a UUID, not store name)
    const connectionConfig = hasValidAccount ? JSON.stringify({
        apiUrl: publicApiUrl,
        accountId: currentAccount!.id
    }, null, 2) : '';

    const handleDownload = () => {
        setDraft(prev => ({
            ...prev,
            plugin: { ...prev.plugin, downloaded: true }
        }));
    };

    const handleCopyConfig = () => {
        navigator.clipboard.writeText(connectionConfig);
        setConfigCopied(true);
        setDraft(prev => ({
            ...prev,
            plugin: { ...prev.plugin, configCopied: true }
        }));
        setTimeout(() => setConfigCopied(false), 2000);
    };

    const verifyStore = async () => {
        setVerifyStatus('loading');
        setVerifyResult(null);

        try {
            const result = await api.get<StoreVerificationResult>(
                '/api/tracking/verify-store',
                token || undefined,
                currentAccount?.id || ''
            );

            setVerifyResult(result);
            setVerifyStatus(result.success ? 'success' : 'error');

            if (result.success) {
                setDraft(prev => ({
                    ...prev,
                    plugin: {
                        ...prev.plugin,
                        verified: true,
                        pluginVersion: result.pluginVersion
                    }
                }));
            }
        } catch (error) {
            Logger.error('Store verification failed', { error });
            setVerifyStatus('error');
            setVerifyResult({
                success: false,
                storeReachable: false,
                pluginInstalled: false,
                error: 'Failed to verify store connection'
            });
        }
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="text-center pb-4 border-b border-gray-100">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-purple-100 text-purple-600 mb-4">
                    <Plug size={32} />
                </div>
                <h2 className="text-2xl font-bold text-gray-900">Install the Plugin</h2>
                <p className="text-gray-500 mt-2">
                    The OverSeek plugin enables live tracking, chat, and order sync
                </p>
            </div>

            {/* Steps */}
            <div className="space-y-6">
                {/* Step 1: Download */}
                <div className="bg-blue-50 rounded-xl p-5 border border-blue-200">
                    <div className="flex items-start gap-4">
                        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center text-sm font-bold">
                            1
                        </div>
                        <div className="flex-1">
                            <h3 className="text-sm font-semibold text-gray-900 mb-1">Download the Plugin</h3>
                            <p className="text-xs text-gray-600 mb-3">
                                Download the OverSeek plugin ZIP file and install it on your WordPress site via Plugins → Add New → Upload Plugin.
                            </p>
                            <a
                                href={`${publicApiUrl}/uploads/plugins/overseek-wc-plugin.zip`}
                                download
                                onClick={handleDownload}
                                className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
                            >
                                <Download size={16} />
                                Download Plugin
                            </a>
                            {draft.plugin.downloaded && (
                                <span className="ml-3 text-sm text-green-600 inline-flex items-center gap-1">
                                    <Check size={14} /> Downloaded
                                </span>
                            )}
                        </div>
                    </div>
                </div>

                {/* Step 2: Configure */}
                <div className="bg-slate-50 rounded-xl p-5 border border-slate-200">
                    <div className="flex items-start gap-4">
                        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-slate-600 text-white flex items-center justify-center text-sm font-bold">
                            2
                        </div>
                        <div className="flex-1">
                            <h3 className="text-sm font-semibold text-gray-900 mb-1">Configure the Plugin</h3>
                            <p className="text-xs text-gray-600 mb-3">
                                After activating the plugin, go to OverSeek settings and paste this configuration:
                            </p>

                            {/* Guard: Only show config when account exists */}
                            {hasValidAccount ? (
                                <div className="relative group">
                                    <button
                                        onClick={handleCopyConfig}
                                        className={`absolute top-2 right-2 flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${configCopied
                                            ? 'bg-green-100 text-green-700 border border-green-200'
                                            : 'bg-white text-gray-700 hover:bg-gray-50 border border-gray-200'
                                            }`}
                                    >
                                        {configCopied ? <Check size={14} /> : <Copy size={14} />}
                                        {configCopied ? 'Copied!' : 'Copy'}
                                    </button>
                                    <pre className="bg-slate-900 text-slate-100 p-4 pr-24 rounded-lg overflow-x-auto font-mono text-sm">
                                        <code>{connectionConfig}</code>
                                    </pre>
                                </div>
                            ) : (
                                <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
                                    <div className="flex items-center gap-2 text-amber-800">
                                        <AlertCircle size={16} />
                                        <span className="text-sm font-medium">Store setup required</span>
                                    </div>
                                    <p className="text-xs text-amber-700 mt-1">
                                        Please complete the Store Setup step first to generate your configuration.
                                    </p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Step 3: Verify */}
                <div className="bg-green-50 rounded-xl p-5 border border-green-200">
                    <div className="flex items-start gap-4">
                        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-green-600 text-white flex items-center justify-center text-sm font-bold">
                            3
                        </div>
                        <div className="flex-1">
                            <h3 className="text-sm font-semibold text-gray-900 mb-1">Verify Installation</h3>
                            <p className="text-xs text-gray-600 mb-3">
                                Click below to check if the plugin is installed and configured correctly.
                            </p>
                            <button
                                onClick={verifyStore}
                                disabled={verifyStatus === 'loading' || !hasValidAccount}
                                className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 transition-colors"
                            >
                                {verifyStatus === 'loading' ? (
                                    <Loader2 size={16} className="animate-spin" />
                                ) : (
                                    <Store size={16} />
                                )}
                                {verifyStatus === 'loading' ? 'Verifying...' : 'Verify Store Plugin'}
                            </button>

                            {/* Verification Result */}
                            {verifyResult && (
                                <div className={`mt-4 p-4 rounded-lg border ${verifyResult.success
                                    ? 'bg-green-100 border-green-300'
                                    : 'bg-amber-100 border-amber-300'
                                    }`}>
                                    <div className="flex items-start gap-3">
                                        {verifyResult.success ? (
                                            <Check className="w-5 h-5 text-green-600 shrink-0" />
                                        ) : (
                                            <AlertCircle className="w-5 h-5 text-amber-600 shrink-0" />
                                        )}
                                        <div className="text-sm">
                                            <p className={`font-semibold ${verifyResult.success ? 'text-green-800' : 'text-amber-800'}`}>
                                                {verifyResult.success ? 'Plugin Verified!' : 'Setup Required'}
                                            </p>
                                            {verifyResult.error && (
                                                <p className="text-amber-700 mt-1">{verifyResult.error}</p>
                                            )}
                                            {verifyResult.success && (
                                                <div className="grid grid-cols-2 gap-2 mt-2 text-xs">
                                                    <div className="flex items-center gap-2">
                                                        <span className="w-2 h-2 rounded-full bg-green-500" />
                                                        Plugin: {verifyResult.pluginVersion || 'Installed'}
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        <span className={`w-2 h-2 rounded-full ${verifyResult.trackingEnabled ? 'bg-green-500' : 'bg-amber-500'}`} />
                                                        Tracking: {verifyResult.trackingEnabled ? 'Enabled' : 'Disabled'}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
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
