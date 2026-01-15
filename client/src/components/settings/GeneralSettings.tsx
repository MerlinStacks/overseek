import { useState, useEffect } from 'react';
import { Save, Loader2, RefreshCw } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';

export function GeneralSettings() {
    const { token } = useAuth();
    const { currentAccount, refreshAccounts } = useAccount();
    const [isSaving, setIsSaving] = useState(false);
    const [isSyncing, setIsSyncing] = useState(false);

    const [formData, setFormData] = useState({
        name: '',
        domain: '',
        wooUrl: '',
        wooConsumerKey: '',
        wooConsumerSecret: '',
        revenueTaxInclusive: true
    });

    useEffect(() => {
        if (currentAccount) {
            setFormData({
                name: currentAccount.name || '',
                domain: currentAccount.domain || '',
                wooUrl: currentAccount.wooUrl || '',
                wooConsumerKey: currentAccount.wooConsumerKey || '',
                wooConsumerSecret: '', // Don't show existing secret for security, only if updating
                revenueTaxInclusive: currentAccount.revenueTaxInclusive ?? true
            });
        }
    }, [currentAccount]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
        setFormData({ ...formData, [e.target.name]: value });
    };

    const validateForm = () => {
        if (!formData.name.trim()) {
            alert("Store Name is required");
            return false;
        }
        if (formData.wooUrl && !isValidUrl(formData.wooUrl)) {
            alert("Please enter a valid Store URL (must start with http:// or https://)");
            return false;
        }
        return true;
    };

    const isValidUrl = (string: string) => {
        try {
            new URL(string);
            return true;
        } catch (_) {
            return false;
        }
    };

    const handleSave = async () => {
        if (!currentAccount || !token) return;
        if (!validateForm()) return;

        setIsSaving(true);
        try {
            const res = await fetch(`/api/accounts/${currentAccount.id}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(formData)
            });

            if (!res.ok) throw new Error('Failed to update settings');

            await refreshAccounts(); // Refresh context to reflect changes
            alert('Settings saved successfully');
        } catch (error) {
            console.error(error);
            alert('Failed to save settings: ' + (error instanceof Error ? error.message : 'Unknown error'));
        } finally {
            setIsSaving(false);
        }
    };

    const handleSyncSettings = async () => {
        if (!currentAccount || !token) return;

        setIsSyncing(true);
        try {
            const res = await fetch(`/api/accounts/${currentAccount.id}/sync-settings`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            if (!res.ok) throw new Error('Failed to sync settings');

            const data = await res.json();
            await refreshAccounts();
            alert(`Synced from WooCommerce:\n• Weight Unit: ${data.weightUnit}\n• Dimension Unit: ${data.dimensionUnit}\n• Currency: ${data.currency}`);
        } catch (error) {
            console.error(error);
            alert('Failed to sync settings: ' + (error instanceof Error ? error.message : 'Unknown error'));
        } finally {
            setIsSyncing(false);
        }
    };

    if (!currentAccount) return <div>Loading...</div>;

    return (
        <div className="bg-white rounded-xl shadow-xs border border-gray-200 overflow-hidden">
            <div className="p-6 border-b border-gray-200">
                <h2 className="text-lg font-medium text-gray-900">Store Configuration</h2>
                <p className="text-sm text-gray-500 mt-1">Manage your store details and connection credentials.</p>
            </div>

            <div className="p-6 space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Store Name</label>
                        <input
                            type="text"
                            name="name"
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-hidden"
                            value={formData.name}
                            onChange={handleChange}
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Domain</label>
                        <input
                            type="url"
                            name="domain"
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-hidden"
                            value={formData.domain}
                            onChange={handleChange}
                        />
                    </div>
                </div>

                <div className="border-t border-gray-100 pt-6">
                    <h3 className="text-sm font-medium text-gray-900 mb-4">WooCommerce Credentials</h3>
                    <div className="grid grid-cols-1 gap-6 max-w-2xl">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Store URL</label>
                            <input
                                type="url"
                                name="wooUrl"
                                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-hidden"
                                placeholder="https://mystore.com"
                                value={formData.wooUrl}
                                onChange={handleChange}
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Consumer Key</label>
                            <input
                                type="text"
                                name="wooConsumerKey"
                                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-hidden font-mono"
                                placeholder="ck_..."
                                value={formData.wooConsumerKey}
                                onChange={handleChange}
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Consumer Secret</label>
                            <input
                                type="password"
                                name="wooConsumerSecret"
                                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-hidden font-mono"
                                placeholder="Leave blank to keep unchanged"
                                value={formData.wooConsumerSecret}
                                onChange={handleChange}
                            />
                        </div>
                    </div>
                </div>

                <div className="border-t border-gray-100 pt-6">
                    <h3 className="text-sm font-medium text-gray-900 mb-4">Financial Settings</h3>
                    <div className="flex items-start gap-3">
                        <div className="flex items-center h-5">
                            <input
                                type="checkbox"
                                id="revenueTaxInclusive"
                                name="revenueTaxInclusive"
                                checked={formData.revenueTaxInclusive}
                                onChange={handleChange}
                                className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                            />
                        </div>
                        <div>
                            <label htmlFor="revenueTaxInclusive" className="text-sm font-medium text-gray-700">
                                Revenue includes tax
                            </label>
                            <p className="text-xs text-gray-500 mt-1">
                                If enabled, revenue metrics in dashboards and reports will include tax. If disabled, tax will be deducted.
                            </p>
                        </div>
                    </div>
                </div>

                <div className="border-t border-gray-100 pt-6">
                    <div className="flex items-center justify-between mb-4">
                        <div>
                            <h3 className="text-sm font-medium text-gray-900">Store Units & Currency</h3>
                            <p className="text-xs text-gray-500 mt-0.5">Synced from your WooCommerce store settings</p>
                        </div>
                        <button
                            onClick={handleSyncSettings}
                            disabled={isSyncing}
                            className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-700 font-medium disabled:opacity-50"
                        >
                            <RefreshCw size={16} className={isSyncing ? 'animate-spin' : ''} />
                            {isSyncing ? 'Syncing...' : 'Sync from WooCommerce'}
                        </button>
                    </div>
                    <div className="grid grid-cols-3 gap-4 max-w-md">
                        <div className="bg-gray-50 rounded-lg p-3 text-center">
                            <p className="text-xs text-gray-500 mb-1">Weight</p>
                            <p className="font-mono font-medium text-gray-900">{currentAccount.weightUnit || 'kg'}</p>
                        </div>
                        <div className="bg-gray-50 rounded-lg p-3 text-center">
                            <p className="text-xs text-gray-500 mb-1">Dimension</p>
                            <p className="font-mono font-medium text-gray-900">{currentAccount.dimensionUnit || 'cm'}</p>
                        </div>
                        <div className="bg-gray-50 rounded-lg p-3 text-center">
                            <p className="text-xs text-gray-500 mb-1">Currency</p>
                            <p className="font-mono font-medium text-gray-900">{currentAccount.currency || 'USD'}</p>
                        </div>
                    </div>
                </div>
            </div>

            <div className="bg-gray-50 px-6 py-4 flex justify-end">
                <button
                    onClick={handleSave}
                    disabled={isSaving}
                    className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors font-medium disabled:opacity-50"
                >
                    {isSaving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                    {isSaving ? 'Saving...' : 'Save Changes'}
                </button>
            </div>
        </div>
    );
}
