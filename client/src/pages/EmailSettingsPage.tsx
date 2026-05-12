import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useAccount } from '../context/AccountContext';
import { useToast } from '../context/ToastContext';
import { Logger } from '../utils/logger';

interface EmailSettings {
    bounceTrackingEnabled: boolean;
    maxSendPerSecond: number;
    maxSendPerDay: number;
}

const DEFAULT_SETTINGS: EmailSettings = {
    bounceTrackingEnabled: false,
    maxSendPerSecond: 1,
    maxSendPerDay: 6000,
};

export function EmailSettingsPage() {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const toast = useToast();

    const [settings, setSettings] = useState<EmailSettings>(DEFAULT_SETTINGS);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        async function loadSettings() {
            if (!currentAccount || !token) return;

            setIsLoading(true);
            try {
                const response = await fetch('/api/email/settings', {
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'x-account-id': currentAccount.id,
                    },
                });

                if (!response.ok) {
                    throw new Error('Failed to load email settings');
                }

                const data = await response.json() as EmailSettings;
                setSettings({
                    bounceTrackingEnabled: Boolean(data.bounceTrackingEnabled),
                    maxSendPerSecond: Number(data.maxSendPerSecond) || 1,
                    maxSendPerDay: Number(data.maxSendPerDay) || 6000,
                });
            } catch (error) {
                Logger.error('Failed to load email settings', { error });
                toast.error('Failed to load email settings.');
            } finally {
                setIsLoading(false);
            }
        }

        loadSettings();
    }, [currentAccount, token, toast]);

    const handleSave = async () => {
        if (!currentAccount || !token) return;

        setIsSaving(true);
        try {
            const response = await fetch('/api/email/settings', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                    'x-account-id': currentAccount.id,
                },
                body: JSON.stringify(settings),
            });

            if (!response.ok) {
                throw new Error('Failed to save email settings');
            }

            toast.success('Email settings saved.');
        } catch (error) {
            Logger.error('Failed to save email settings', { error });
            toast.error('Failed to save email settings.');
        } finally {
            setIsSaving(false);
        }
    };

    if (isLoading) {
        return <div>Loading...</div>;
    }

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-2">
                <h1 className="text-2xl font-bold text-gray-900">Email Settings</h1>
                <p className="text-gray-500">Control email deliverability and sending limits for this account.</p>
            </div>

            <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-xs max-w-3xl">
                <h2 className="text-base font-semibold text-gray-900 mb-6">Email Service Provider</h2>

                <div className="space-y-6">
                    <div className="grid gap-3 sm:grid-cols-[220px_1fr] sm:items-start">
                        <label className="text-sm font-medium text-gray-700 pt-1">Bounce Tracking</label>
                        <label className="inline-flex items-start gap-3">
                            <input
                                type="checkbox"
                                checked={settings.bounceTrackingEnabled}
                                onChange={(e) => setSettings((prev) => ({ ...prev, bounceTrackingEnabled: e.target.checked }))}
                                className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                            />
                            <span className="text-sm text-gray-600">
                                Enable to capture bounced emails from the email service and mark contacts as bounced.
                            </span>
                        </label>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-[220px_1fr] sm:items-start">
                        <label htmlFor="maxSendPerSecond" className="text-sm font-medium text-gray-700 pt-2">Max Sending Limit</label>
                        <div>
                            <div className="flex max-w-sm rounded-lg border border-gray-300 overflow-hidden">
                                <input
                                    id="maxSendPerSecond"
                                    type="number"
                                    min={1}
                                    max={1000}
                                    value={settings.maxSendPerSecond}
                                    onChange={(e) => setSettings((prev) => ({ ...prev, maxSendPerSecond: Math.max(1, Number(e.target.value) || 1) }))}
                                    className="w-full px-3 py-2 text-sm text-gray-900 focus:outline-none"
                                />
                                <span className="bg-gray-50 border-l border-gray-300 px-3 py-2 text-sm text-gray-600">Per Sec</span>
                            </div>
                            <p className="mt-2 text-sm text-gray-500">
                                Enter the maximum email sending rate. This value helps throttle outbound sends from automations.
                            </p>
                        </div>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-[220px_1fr] sm:items-start">
                        <label htmlFor="maxSendPerDay" className="text-sm font-medium text-gray-700 pt-2">Daily Sending Limit</label>
                        <div>
                            <div className="flex max-w-sm rounded-lg border border-gray-300 overflow-hidden">
                                <input
                                    id="maxSendPerDay"
                                    type="number"
                                    min={1}
                                    max={1000000}
                                    value={settings.maxSendPerDay}
                                    onChange={(e) => setSettings((prev) => ({ ...prev, maxSendPerDay: Math.max(1, Number(e.target.value) || 1) }))}
                                    className="w-full px-3 py-2 text-sm text-gray-900 focus:outline-none"
                                />
                                <span className="bg-gray-50 border-l border-gray-300 px-3 py-2 text-sm text-gray-600">Per Day</span>
                            </div>
                            <p className="mt-2 text-sm text-gray-500">
                                Set the maximum emails allowed per 24 hours. Once this limit is reached, sending pauses until quota resets.
                            </p>
                        </div>
                    </div>

                    <div className="pt-2">
                        <button
                            onClick={handleSave}
                            disabled={isSaving}
                            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-60"
                        >
                            {isSaving ? 'Saving...' : 'Save'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
