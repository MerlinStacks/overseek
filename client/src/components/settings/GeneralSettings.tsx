import { useState, useEffect } from 'react';
import { Save, Loader2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';

export function GeneralSettings() {
    const { token } = useAuth();
    const { currentAccount, refreshAccounts } = useAccount();
    const [isSaving, setIsSaving] = useState(false);
    const [isConfiguring, setIsConfiguring] = useState(false);

    const [formData, setFormData] = useState({
        name: '',
        domain: '',
        wooUrl: '',
        wooConsumerKey: '',
        wooConsumerSecret: ''
    });

    useEffect(() => {
        if (currentAccount) {
            setFormData({
                name: currentAccount.name || '',
                domain: currentAccount.domain || '',
                wooUrl: currentAccount.wooUrl || '',
                wooConsumerKey: currentAccount.wooConsumerKey || '',
                wooConsumerSecret: '' // Don't show existing secret for security, only if updating
            });
        }
    }, [currentAccount]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
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

    const handleConfigurePlugin = async () => {
        if (!currentAccount || !token) {
            alert("No active account selected. Please select an account first.");
            return;
        }

        if (!formData.wooUrl || !formData.wooConsumerKey) {
            alert("Please save your WooCommerce URL and Consumer Key before configuring the plugin.");
            return;
        }

        setIsConfiguring(true);
        try {
            const res = await fetch('/api/woo/configure', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount.id
                },
                body: JSON.stringify({
                    origin: window.location.origin
                })
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to configure plugin');

            alert('Plugin configured successfully! The settings have been pushed to your WooCommerce site.');
        } catch (error: any) {
            console.error(error);
            alert(error.message || 'Failed to configure plugin. Please check your credentials and try again.');
        } finally {
            setIsConfiguring(false);
        }
    };

    if (!currentAccount) return <div>Loading...</div>;

    return (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
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
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                            value={formData.name}
                            onChange={handleChange}
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Domain</label>
                        <input
                            type="url"
                            name="domain"
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
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
                                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
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
                                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none font-mono"
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
                                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none font-mono"
                                placeholder="Leave blank to keep unchanged"
                                value={formData.wooConsumerSecret}
                                onChange={handleChange}
                            />
                        </div>
                    </div>
                </div>
            </div>

            <div className="bg-gray-50 px-6 py-4 flex justify-between items-center">
                <button
                    onClick={handleConfigurePlugin}
                    disabled={isConfiguring || isSaving}
                    className="text-gray-600 hover:text-gray-900 text-sm font-medium flex items-center gap-2"
                >
                    {isConfiguring ? <Loader2 size={16} className="animate-spin" /> : null}
                    {isConfiguring ? 'Configuring...' : 'Auto-Configure Plugin'}
                </button>

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
