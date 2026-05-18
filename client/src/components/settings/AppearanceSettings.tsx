import { useState, useEffect } from 'react';
import { Logger } from '../../utils/logger';
import { Check, RefreshCw } from 'lucide-react';
import { useAccount } from '../../context/AccountContext';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { RichTextEditor } from '../common/RichTextEditor';

const buildDefaultEmailFooterHtml = (accountName: string) => `<p>You are receiving this email from ${accountName}.<br /><a href="{{unsubscribe_url}}">Unsubscribe</a></p>`;

export function AppearanceSettings() {
    const { currentAccount, refreshAccounts } = useAccount();
    const { token } = useAuth();
    const toast = useToast();
    const [isSaving, setIsSaving] = useState(false);

    // Default appearance settings
    const [settings, setSettings] = useState({
        appName: 'OverSeek',
        primaryColor: '#2563eb', // Default blue-600
        logoUrl: '',
        socialLinks: [
            { label: 'Facebook', href: '' },
            { label: 'Instagram', href: '' },
            { label: 'TikTok', href: '' },
        ],
        emailFooterHtml: buildDefaultEmailFooterHtml('Your Store'),
    });

    useEffect(() => {
        if (currentAccount?.appearance) {
            const app = currentAccount.appearance;
            setSettings({
                appName: app.appName || 'OverSeek',
                primaryColor: app.primaryColor || '#2563eb',
                logoUrl: app.logoUrl || '',
                socialLinks: app.socialLinks?.length ? app.socialLinks : [
                    { label: 'Facebook', href: '' },
                    { label: 'Instagram', href: '' },
                    { label: 'TikTok', href: '' },
                ],
                emailFooterHtml: typeof app.emailFooterHtml === 'string' && app.emailFooterHtml.trim()
                    ? app.emailFooterHtml
                    : buildDefaultEmailFooterHtml(app.appName || currentAccount.name || 'Your Store'),
            });
        }
    }, [currentAccount]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setSettings({ ...settings, [e.target.name]: e.target.value });
    };

    const handleSave = async () => {
        if (!currentAccount || !token) return;
        setIsSaving(true);
        try {
            const res = await fetch(`/api/accounts/${currentAccount.id}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    appearance: settings
                })
            });

            if (!res.ok) throw new Error('Failed to update appearance');

            await refreshAccounts();
            toast.success('Appearance settings saved.');
        } catch (error) {
            Logger.error('An error occurred', { error: error });
            toast.error('Failed to save appearance settings.');
        } finally {
            setIsSaving(false);
        }
    };

    const handleReset = () => {
        setSettings({
            appName: 'OverSeek',
            primaryColor: '#2563eb',
            logoUrl: '',
            socialLinks: [
                { label: 'Facebook', href: '' },
                { label: 'Instagram', href: '' },
                { label: 'TikTok', href: '' },
            ],
            emailFooterHtml: buildDefaultEmailFooterHtml(settings.appName || currentAccount?.name || 'Your Store'),
        });
    };

    const updateSocialLink = (index: number, key: 'label' | 'href', value: string) => {
        setSettings((current) => ({
            ...current,
            socialLinks: current.socialLinks.map((link, itemIndex) => itemIndex === index ? { ...link, [key]: value } : link),
        }));
    };

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Application Name</label>
                    <input
                        type="text"
                        name="appName"
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-hidden"
                        value={settings.appName}
                        onChange={handleChange}
                        placeholder="OverSeek"
                    />
                    <p className="text-xs text-gray-500 mt-1">Replaces "OverSeek" in the sidebar and browser title.</p>
                </div>

                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Primary Color</label>
                    <div className="flex items-center gap-3">
                        <input
                            type="color"
                            name="primaryColor"
                            value={settings.primaryColor}
                            onChange={handleChange}
                            className="h-10 w-20 p-1 border border-gray-300 rounded-sm cursor-pointer"
                        />
                        <input
                            type="text"
                            name="primaryColor"
                            value={settings.primaryColor}
                            onChange={handleChange}
                            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-hidden font-mono uppercase"
                        />
                    </div>
                    <p className="text-xs text-gray-500 mt-1">Main brand color used for buttons and highlights.</p>
                </div>

                <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Custom Logo URL</label>
                    <input
                        type="url"
                        name="logoUrl"
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-hidden"
                        value={settings.logoUrl}
                        onChange={handleChange}
                        placeholder="https://example.com/logo.png"
                    />
                    <p className="text-xs text-gray-500 mt-1">Enter a direct URL to your logo image (PNG/SVG recommended). Leave empty to use default.</p>
                </div>

                <div className="md:col-span-2 space-y-3">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Social Profile Links</label>
                        <p className="text-xs text-gray-500">Used by the email designer social block so you do not need to re-enter profile links.</p>
                    </div>
                    {settings.socialLinks.map((link, index) => (
                        <div key={index} className="grid grid-cols-1 md:grid-cols-[180px_1fr] gap-3">
                            <input value={link.label} onChange={(event) => updateSocialLink(index, 'label', event.target.value)} className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-hidden" placeholder="Platform" />
                            <input value={link.href} onChange={(event) => updateSocialLink(index, 'href', event.target.value)} className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-hidden" placeholder="https://..." />
                        </div>
                    ))}
                    <button type="button" onClick={() => setSettings((current) => ({ ...current, socialLinks: [...current.socialLinks, { label: 'New Profile', href: '' }] }))} className="text-sm font-medium text-blue-600 hover:text-blue-700">Add social profile</button>
                </div>

                <div className="md:col-span-2 space-y-2">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Email Footer (Rich Text)</label>
                        <p className="text-xs text-gray-500">Used as a locked footer block in Email Designer v2 for this account. Include <code>{'{{unsubscribe_url}}'}</code> in your markup.</p>
                    </div>
                    <RichTextEditor
                        value={settings.emailFooterHtml}
                        onChange={(value) => setSettings((current) => ({ ...current, emailFooterHtml: value }))}
                        placeholder="<p>You are receiving this email from Your Store...</p>"
                        variant="standard"
                        features={['bold', 'italic', 'underline', 'link', 'list']}
                    />
                </div>
            </div>

            <div className="flex justify-between items-center pt-4 border-t border-gray-100">
                <button
                    onClick={handleReset}
                    className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1"
                >
                    <RefreshCw size={14} /> Reset to Default
                </button>

                <button
                    onClick={handleSave}
                    disabled={isSaving}
                    className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors font-medium disabled:opacity-50"
                    style={{ backgroundColor: settings.primaryColor }} // Instant preview
                >
                    {isSaving ? <RefreshCw size={18} className="animate-spin" /> : <Check size={18} />}
                    {isSaving ? 'Saving...' : 'Save Appearance'}
                </button>
            </div>
        </div>
    );
}
