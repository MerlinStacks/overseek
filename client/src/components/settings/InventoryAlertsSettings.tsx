import { useState, useEffect } from 'react';
import { Save, Loader2, Mail, AlertTriangle } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';

export function InventoryAlertsSettings() {
    const { token } = useAuth();
    const { currentAccount } = useAccount();

    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);

    const [isEnabled, setIsEnabled] = useState(false);
    const [threshold, setThreshold] = useState(14);
    const [emailInput, setEmailInput] = useState('');
    const [emails, setEmails] = useState<string[]>([]);

    useEffect(() => {
        if (!currentAccount) return;
        fetchSettings();
    }, [currentAccount, token]);

    const fetchSettings = async () => {
        try {
            // Need a backend endpoint for settings. 
            // Assuming GET /api/inventory/settings
            const res = await fetch('/api/inventory/settings', {
                headers: { 'Authorization': `Bearer ${token}`, 'X-Account-ID': currentAccount!.id }
            });
            if (res.ok) {
                const data = await res.json();
                setIsEnabled(data.isEnabled || false);
                setThreshold(data.lowStockThresholdDays || 14);
                setEmails(data.alertEmails || []);
            }
        } catch (error) {
            console.error(error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleSave = async () => {
        if (!currentAccount) return;
        setIsSaving(true);
        try {
            const res = await fetch('/api/inventory/settings', {
                method: 'POST', // or PUT
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'X-Account-ID': currentAccount.id
                },
                body: JSON.stringify({
                    isEnabled,
                    lowStockThresholdDays: Number(threshold),
                    alertEmails: emails
                })
            });
            if (!res.ok) throw new Error('Failed to save');
            alert('Settings saved successfully');
        } catch (error) {
            console.error(error);
            alert('Failed to save settings');
        } finally {
            setIsSaving(false);
        }
    };

    const addEmail = () => {
        if (emailInput && !emails.includes(emailInput)) {
            setEmails([...emails, emailInput]);
            setEmailInput('');
        }
    };

    const removeEmail = (email: string) => {
        setEmails(emails.filter(e => e !== email));
    };

    if (isLoading) return <div className="p-4 text-center">Loading...</div>;

    return (
        <div className="space-y-6 max-w-2xl">
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="text-lg font-medium text-gray-900">Low Stock Alerts</h3>
                    <p className="text-sm text-gray-500">Get notified when products are running low based on sales velocity.</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" checked={isEnabled} onChange={e => setIsEnabled(e.target.checked)} className="sr-only peer" />
                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                </label>
            </div>

            {isEnabled && (
                <div className="space-y-6 animate-in fade-in slide-in-from-top-2">
                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex gap-3">
                        <AlertTriangle className="text-amber-600 shrink-0" size={20} />
                        <p className="text-sm text-amber-800">
                            We calculate "Days Remaining" by dividing current stock by the average daily sales over the last 30 days.
                        </p>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Alert Threshold (Days)
                        </label>
                        <div className="flex items-center gap-2">
                            <input
                                type="number"
                                value={threshold}
                                onChange={e => setThreshold(Number(e.target.value))}
                                className="w-24 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                            />
                            <span className="text-gray-500">days remaining</span>
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Email Recipients
                        </label>
                        <div className="flex gap-2 mb-2">
                            <input
                                type="email"
                                value={emailInput}
                                onChange={e => setEmailInput(e.target.value)}
                                placeholder="colleague@example.com"
                                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                                onKeyDown={e => e.key === 'Enter' && addEmail()}
                            />
                            <button
                                onClick={addEmail}
                                type="button"
                                className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
                            >
                                Add
                            </button>
                        </div>
                        <div className="space-y-2">
                            {emails.map(email => (
                                <div key={email} className="flex items-center justify-between bg-white border border-gray-200 rounded-lg px-3 py-2">
                                    <div className="flex items-center gap-2 text-sm text-gray-700">
                                        <Mail size={16} className="text-gray-400" />
                                        {email}
                                    </div>
                                    <button onClick={() => removeEmail(email)} className="text-red-500 hover:text-red-700 text-sm">
                                        Remove
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            <div className="pt-4 border-t border-gray-200">
                <button
                    onClick={handleSave}
                    disabled={isSaving}
                    className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 shadow-md shadow-blue-500/20 disabled:opacity-50 transition-all"
                >
                    {isSaving ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}
                    Save Settings
                </button>
            </div>
        </div>
    );
}
