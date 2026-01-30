/**
 * Email Step
 * 
 * Third step in onboarding: Configure default email account for notifications.
 * Simplified SMTP setup with test functionality.
 */

import React, { useState } from 'react';
import { Mail, ArrowRight, ArrowLeft, SkipForward, CheckCircle, AlertCircle, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import { OnboardingStepProps } from '../types';
import { useAuth } from '../../../context/AuthContext';
import { Logger } from '../../../utils/logger';

/**
 * Handles email configuration with SMTP settings and test functionality.
 */
export function EmailStep({ draft, setDraft, onNext, onBack, onSkip, isSubmitting }: OnboardingStepProps) {
    const { token } = useAuth();
    const [testStatus, setTestStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
    const [testError, setTestError] = useState<string | null>(null);
    const [showAdvanced, setShowAdvanced] = useState(false);

    const handleChange = (field: keyof typeof draft.email, value: string | number | boolean) => {
        setDraft(prev => ({
            ...prev,
            email: { ...prev.email, [field]: value }
        }));
        // Reset test status when settings change
        if (field !== 'enabled' && field !== 'verified') {
            setTestStatus('idle');
            setTestError(null);
        }
    };

    const toggleEnabled = () => {
        const newEnabled = !draft.email.enabled;
        handleChange('enabled', newEnabled);
        if (!newEnabled) {
            // Reset verification when disabling
            handleChange('verified', false);
        }
    };

    const testSmtp = async () => {
        setTestStatus('loading');
        setTestError(null);

        try {
            const res = await fetch('/api/email/test-smtp', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    host: draft.email.smtpHost,
                    port: draft.email.smtpPort,
                    username: draft.email.smtpUsername,
                    password: draft.email.smtpPassword,
                    secure: draft.email.smtpSecure
                })
            });

            const data = await res.json();

            if (res.ok && data.success) {
                setTestStatus('success');
                handleChange('verified', true);
            } else {
                setTestStatus('error');
                setTestError(data.error || 'Could not connect to SMTP server');
            }
        } catch (error) {
            Logger.error('SMTP test failed', { error });
            setTestStatus('error');
            setTestError('Failed to test SMTP connection');
        }
    };

    const canTest = draft.email.smtpHost.trim() &&
        draft.email.smtpUsername.trim() &&
        draft.email.smtpPassword.trim();

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="text-center pb-4 border-b border-gray-100">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-amber-100 text-amber-600 mb-4">
                    <Mail size={32} />
                </div>
                <h2 className="text-2xl font-bold text-gray-900">Email Setup</h2>
                <p className="text-gray-500 mt-2">
                    Configure outbound email for notifications and customer communication
                </p>
            </div>

            {/* Enable Toggle */}
            <div className="flex items-center justify-between p-4 bg-gray-50 rounded-xl border border-gray-200">
                <div>
                    <h3 className="text-sm font-semibold text-gray-900">Enable Email Integration</h3>
                    <p className="text-xs text-gray-500 mt-0.5">Set up SMTP to send emails from OverSeek</p>
                </div>
                <button
                    type="button"
                    onClick={toggleEnabled}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${draft.email.enabled ? 'bg-blue-600' : 'bg-gray-300'
                        }`}
                >
                    <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${draft.email.enabled ? 'translate-x-6' : 'translate-x-1'
                            }`}
                    />
                </button>
            </div>

            {/* Email Configuration */}
            {draft.email.enabled && (
                <div className="space-y-5 animate-in fade-in duration-200">
                    {/* Basic Info */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1.5">
                                Display Name
                            </label>
                            <input
                                type="text"
                                value={draft.email.name}
                                onChange={(e) => handleChange('name', e.target.value)}
                                placeholder="My Store Support"
                                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1.5">
                                Email Address
                            </label>
                            <input
                                type="email"
                                value={draft.email.email}
                                onChange={(e) => handleChange('email', e.target.value)}
                                placeholder="support@mystore.com"
                                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors"
                            />
                        </div>
                    </div>

                    {/* SMTP Settings */}
                    <div className="bg-slate-50 rounded-xl p-5 border border-slate-200">
                        <h3 className="text-sm font-semibold text-gray-900 mb-4">SMTP Settings</h3>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                                    SMTP Host <span className="text-red-500">*</span>
                                </label>
                                <input
                                    type="text"
                                    value={draft.email.smtpHost}
                                    onChange={(e) => handleChange('smtpHost', e.target.value)}
                                    placeholder="smtp.gmail.com"
                                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                                    Port
                                </label>
                                <input
                                    type="number"
                                    value={draft.email.smtpPort}
                                    onChange={(e) => handleChange('smtpPort', parseInt(e.target.value) || 587)}
                                    placeholder="587"
                                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                                    Username <span className="text-red-500">*</span>
                                </label>
                                <input
                                    type="text"
                                    value={draft.email.smtpUsername}
                                    onChange={(e) => handleChange('smtpUsername', e.target.value)}
                                    placeholder="your-email@gmail.com"
                                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                                    Password <span className="text-red-500">*</span>
                                </label>
                                <input
                                    type="password"
                                    value={draft.email.smtpPassword}
                                    onChange={(e) => handleChange('smtpPassword', e.target.value)}
                                    placeholder="••••••••"
                                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors"
                                />
                            </div>
                        </div>

                        {/* Secure Toggle */}
                        <div className="flex items-center gap-3 mt-4">
                            <input
                                type="checkbox"
                                id="smtpSecure"
                                checked={draft.email.smtpSecure}
                                onChange={(e) => handleChange('smtpSecure', e.target.checked)}
                                className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                            />
                            <label htmlFor="smtpSecure" className="text-sm text-gray-700">
                                Use TLS/SSL encryption
                            </label>
                        </div>

                        {/* Test Button */}
                        <div className="mt-5 pt-4 border-t border-slate-200">
                            <button
                                type="button"
                                onClick={testSmtp}
                                disabled={!canTest || testStatus === 'loading'}
                                className="flex items-center gap-2 px-4 py-2 bg-slate-700 text-white rounded-lg hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-medium"
                            >
                                {testStatus === 'loading' ? (
                                    <Loader2 size={16} className="animate-spin" />
                                ) : testStatus === 'success' ? (
                                    <CheckCircle size={16} className="text-green-400" />
                                ) : (
                                    <Mail size={16} />
                                )}
                                {testStatus === 'loading' ? 'Testing...' :
                                    testStatus === 'success' ? 'Connection Verified' :
                                        'Test SMTP Connection'}
                            </button>

                            {testStatus === 'success' && (
                                <p className="mt-2 text-sm text-green-600 flex items-center gap-1.5">
                                    <CheckCircle size={14} />
                                    SMTP connection successful!
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
            )}

            {/* Skip Message */}
            {!draft.email.enabled && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800">
                    <p>
                        You can skip email setup for now and configure it later in Settings → Email.
                    </p>
                </div>
            )}

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
