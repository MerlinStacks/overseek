import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Key, Save, Trash2, Loader2, Check, AlertCircle, Zap, Mail, Globe, Facebook, Bell } from 'lucide-react';

interface PlatformCredential {
    id: string;
    platform: string;
    credentials: Record<string, string>;
    notes?: string;
    updatedAt: string;
}

interface PlatformConfig {
    id: string;
    name: string;
    description: string;
    icon: React.ElementType;
    fields: { key: string; label: string; placeholder: string }[];
    testable?: boolean;
}

const PLATFORMS: PlatformConfig[] = [
    {
        id: 'PLATFORM_SMTP',
        name: 'Platform SMTP',
        description: 'SMTP settings for system emails (password resets, MFA codes, notifications)',
        icon: Mail,
        fields: [
            { key: 'host', label: 'SMTP Host', placeholder: 'smtp.example.com' },
            { key: 'port', label: 'Port', placeholder: '587' },
            { key: 'username', label: 'Username', placeholder: 'your-email@example.com' },
            { key: 'password', label: 'Password', placeholder: '••••••••' },
            { key: 'fromEmail', label: 'From Email', placeholder: 'noreply@example.com' },
            { key: 'fromName', label: 'From Name', placeholder: 'OverSeek' },
            { key: 'secure', label: 'Use TLS/SSL', placeholder: 'true (for port 465)' }
        ],
        testable: true
    },
    {
        id: 'GOOGLE_ADS',
        name: 'Google Ads',
        description: 'API credentials for Google Ads integration and reporting',
        icon: Globe,
        fields: [
            { key: 'clientId', label: 'Client ID', placeholder: 'xxx.apps.googleusercontent.com' },
            { key: 'clientSecret', label: 'Client Secret', placeholder: 'GOCSPX-xxx' },
            { key: 'developerToken', label: 'Developer Token', placeholder: '22-character token' },
            { key: 'loginCustomerId', label: 'Manager Account ID (MCC)', placeholder: '123-456-7890 (optional, for MCC access)' }
        ]
    },
    {
        id: 'META_ADS',
        name: 'Meta Ads',
        description: 'API credentials for Facebook/Instagram Ads integration',
        icon: Facebook,
        fields: [
            { key: 'appId', label: 'App ID', placeholder: '123456789' },
            { key: 'appSecret', label: 'App Secret', placeholder: 'abc123...' }
        ]
    },
    {
        id: 'WEB_PUSH_VAPID',
        name: 'Push Notifications',
        description: 'VAPID keys for Web Push notifications. Generate with: npx web-push generate-vapid-keys',
        icon: Bell,
        fields: [
            { key: 'publicKey', label: 'Public Key', placeholder: 'Base64-encoded public key' },
            { key: 'privateKey', label: 'Private Key', placeholder: 'Base64-encoded private key' }
        ]
    }
];

type PlatformId = 'PLATFORM_SMTP' | 'GOOGLE_ADS' | 'META_ADS' | 'WEB_PUSH_VAPID';

/**
 * Super Admin page for managing platform API credentials.
 * Credentials are stored securely in the database.
 */
export function AdminCredentialsPage() {
    const { token } = useAuth();
    const [credentials, setCredentials] = useState<PlatformCredential[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState<string | null>(null);
    const [testing, setTesting] = useState<string | null>(null);
    const [formData, setFormData] = useState<Record<string, Record<string, string>>>({});
    const [notes, setNotes] = useState<Record<string, string>>({});
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    const [activeTab, setActiveTab] = useState<PlatformId>('PLATFORM_SMTP');
    const [generating, setGenerating] = useState(false);

    useEffect(() => {
        fetchCredentials();
    }, [token]);

    async function fetchCredentials() {
        try {
            const res = await fetch('/api/admin/platform-credentials', {
                headers: { Authorization: `Bearer ${token}` }
            });
            const data = await res.json();
            setCredentials(data);

            // Initialize form data with existing values from saved credentials
            const initialForm: Record<string, Record<string, string>> = {};
            const initialNotes: Record<string, string> = {};

            PLATFORMS.forEach(platform => {
                initialForm[platform.id] = {};
                // Initialize all fields with empty values first
                platform.fields.forEach(field => {
                    initialForm[platform.id][field.key] = '';
                });
                initialNotes[platform.id] = '';
            });

            // Populate with existing credentials and notes
            data.forEach((cred: PlatformCredential) => {
                if (cred.credentials) {
                    // Populate form with saved credential values
                    Object.entries(cred.credentials).forEach(([key, value]) => {
                        if (initialForm[cred.platform]) {
                            initialForm[cred.platform][key] = value;
                        }
                    });
                }
                if (cred.notes) {
                    initialNotes[cred.platform] = cred.notes;
                }
            });

            setFormData(initialForm);
            setNotes(initialNotes);
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    }

    async function handleSave(platformId: string) {
        setSaving(platformId);
        setMessage(null);

        try {
            // Filter out empty values
            const creds: Record<string, string> = {};
            Object.entries(formData[platformId] || {}).forEach(([key, value]) => {
                if (value.trim()) {
                    creds[key] = value.trim();
                }
            });

            if (Object.keys(creds).length === 0) {
                setMessage({ type: 'error', text: 'Please fill in at least one credential field' });
                return;
            }

            const res = await fetch(`/api/admin/platform-credentials/${platformId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({ credentials: creds, notes: notes[platformId] })
            });

            if (res.ok) {
                setMessage({ type: 'success', text: `${platformId} credentials saved successfully` });
                // Refresh to get latest saved values (don't clear form)
                fetchCredentials();
            } else {
                const err = await res.json();
                setMessage({ type: 'error', text: err.error || 'Failed to save' });
            }
        } catch (err) {
            setMessage({ type: 'error', text: 'Network error' });
        } finally {
            setSaving(null);
        }
    }

    async function handleDelete(platformId: string) {
        if (!confirm(`Delete all ${platformId} credentials? This cannot be undone.`)) return;

        try {
            const res = await fetch(`/api/admin/platform-credentials/${platformId}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${token}` }
            });

            if (res.ok) {
                setMessage({ type: 'success', text: 'Credentials deleted' });
                fetchCredentials();
            }
        } catch (err) {
            setMessage({ type: 'error', text: 'Failed to delete' });
        }
    }

    /**
     * Tests SMTP connection with the provided credentials.
     */
    async function handleTestSmtp() {
        setTesting('PLATFORM_SMTP');
        setMessage(null);

        try {
            const smtpData = formData['PLATFORM_SMTP'] || {};

            // Require at least host/port/username/password for test
            if (!smtpData.host || !smtpData.port || !smtpData.username || !smtpData.password) {
                setMessage({ type: 'error', text: 'Please fill in host, port, username, and password to test' });
                return;
            }

            const res = await fetch('/api/admin/platform-smtp/test', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({
                    host: smtpData.host,
                    port: parseInt(smtpData.port),
                    username: smtpData.username,
                    password: smtpData.password,
                    secure: smtpData.secure === 'true'
                })
            });

            const result = await res.json();

            if (res.ok && result.success) {
                setMessage({ type: 'success', text: 'SMTP connection successful!' });
            } else {
                setMessage({ type: 'error', text: result.error || 'SMTP connection failed' });
            }
        } catch (err) {
            setMessage({ type: 'error', text: 'Network error during SMTP test' });
        } finally {
            setTesting(null);
        }
    }

    const isConfigured = (platformId: string) =>
        credentials.some(c => c.platform === platformId);

    const getLastUpdated = (platformId: string) => {
        const cred = credentials.find(c => c.platform === platformId);
        return cred?.updatedAt ? new Date(cred.updatedAt).toLocaleDateString() : null;
    };

    /**
     * Generates VAPID keys and populates the form.
     */
    async function handleGenerateVapidKeys() {
        setGenerating(true);
        setMessage(null);

        try {
            const res = await fetch('/api/admin/generate-vapid-keys', {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` }
            });

            if (!res.ok) {
                const err = await res.json();
                setMessage({ type: 'error', text: err.error || 'Failed to generate keys' });
                return;
            }

            const keys = await res.json();
            setFormData(prev => ({
                ...prev,
                'WEB_PUSH_VAPID': {
                    publicKey: keys.publicKey,
                    privateKey: keys.privateKey
                }
            }));
            setMessage({ type: 'success', text: 'VAPID keys generated! Click Save to store them.' });
        } catch (err) {
            setMessage({ type: 'error', text: 'Network error generating keys' });
        } finally {
            setGenerating(false);
        }
    }

    if (loading) {
        return <div className="flex items-center justify-center py-12"><Loader2 className="animate-spin text-gray-400" /></div>;
    }

    const currentPlatform = PLATFORMS.find(p => p.id === activeTab)!;

    return (
        <div className="max-w-4xl">
            {/* Header */}
            <div className="flex items-center gap-3 mb-6">
                <Key className="text-slate-600" size={28} />
                <h1 className="text-2xl font-bold text-slate-800">Platform Credentials</h1>
            </div>

            <p className="text-slate-600 mb-6">
                Configure API credentials for ad platform integrations. These credentials are stored securely and used for OAuth flows and API access.
            </p>

            {/* Global Message */}
            {message && (
                <div className={`mb-6 p-4 rounded-lg flex items-center gap-2 ${message.type === 'success' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'
                    }`}>
                    {message.type === 'success' ? <Check size={18} /> : <AlertCircle size={18} />}
                    {message.text}
                </div>
            )}

            {/* Tabs Navigation */}
            <div className="flex overflow-x-auto border-b border-gray-200 no-scrollbar mb-6">
                {PLATFORMS.map((platform) => {
                    const Icon = platform.icon;
                    const isActive = activeTab === platform.id;
                    const configured = isConfigured(platform.id);

                    return (
                        <button
                            key={platform.id}
                            onClick={() => setActiveTab(platform.id as PlatformId)}
                            className={`
                                flex items-center gap-2 px-6 py-3 border-b-2 font-medium text-sm whitespace-nowrap transition-colors relative
                                ${isActive
                                    ? 'border-blue-600 text-blue-600'
                                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                                }
                            `}
                        >
                            <Icon size={18} />
                            {platform.name}
                            {configured && (
                                <span className="w-2 h-2 bg-green-500 rounded-full" title="Configured" />
                            )}
                        </button>
                    );
                })}
            </div>

            {/* Active Tab Content */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
                {/* Tab Header */}
                <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-linear-to-r from-slate-50 to-white">
                    <div>
                        <div className="flex items-center gap-3">
                            <currentPlatform.icon className="text-slate-600" size={24} />
                            <h2 className="text-lg font-semibold text-slate-900">{currentPlatform.name}</h2>
                            {isConfigured(currentPlatform.id) && (
                                <span className="bg-green-100 text-green-800 text-xs px-2 py-1 rounded-full">Configured</span>
                            )}
                        </div>
                        <p className="text-sm text-slate-500 mt-1">{currentPlatform.description}</p>
                        {getLastUpdated(currentPlatform.id) && (
                            <p className="text-xs text-slate-400 mt-1">Last updated: {getLastUpdated(currentPlatform.id)}</p>
                        )}
                    </div>
                </div>

                {/* Credential Fields */}
                <div className="p-6 space-y-4">
                    {currentPlatform.fields.map(field => (
                        <div key={field.key}>
                            <label className="block text-sm font-medium text-slate-700 mb-1">
                                {field.label}
                            </label>
                            <input
                                type="text"
                                className="w-full p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-shadow"
                                placeholder={isConfigured(currentPlatform.id) ? '••••••••' : field.placeholder}
                                value={formData[currentPlatform.id]?.[field.key] || ''}
                                onChange={e => setFormData(prev => ({
                                    ...prev,
                                    [currentPlatform.id]: {
                                        ...prev[currentPlatform.id],
                                        [field.key]: e.target.value
                                    }
                                }))}
                            />
                        </div>
                    ))}

                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Notes (optional)</label>
                        <input
                            type="text"
                            className="w-full p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-shadow"
                            placeholder="e.g., Production credentials from Google Cloud Console"
                            value={notes[currentPlatform.id] || ''}
                            onChange={e => setNotes(prev => ({ ...prev, [currentPlatform.id]: e.target.value }))}
                        />
                    </div>
                </div>

                {/* Actions */}
                <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex justify-end gap-3">
                    {isConfigured(currentPlatform.id) && (
                        <button
                            onClick={() => handleDelete(currentPlatform.id)}
                            className="px-4 py-2 text-red-600 hover:bg-red-50 rounded-lg flex items-center gap-2 transition-colors"
                        >
                            <Trash2 size={16} />
                            Delete
                        </button>
                    )}
                    {currentPlatform.testable && (
                        <button
                            onClick={() => handleTestSmtp()}
                            disabled={testing === currentPlatform.id}
                            className="px-4 py-2 text-amber-600 border border-amber-300 hover:bg-amber-50 rounded-lg flex items-center gap-2 transition-colors"
                        >
                            {testing === currentPlatform.id ? <Loader2 className="animate-spin" size={16} /> : <Zap size={16} />}
                            Test Connection
                        </button>
                    )}
                    {currentPlatform.id === 'WEB_PUSH_VAPID' && (
                        <button
                            onClick={handleGenerateVapidKeys}
                            disabled={generating}
                            className="px-4 py-2 text-purple-600 border border-purple-300 hover:bg-purple-50 rounded-lg flex items-center gap-2 transition-colors"
                        >
                            {generating ? <Loader2 className="animate-spin" size={16} /> : <Zap size={16} />}
                            Generate Keys
                        </button>
                    )}
                    <button
                        onClick={() => handleSave(currentPlatform.id)}
                        disabled={saving === currentPlatform.id}
                        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2 transition-colors"
                    >
                        {saving === currentPlatform.id ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
                        Save Credentials
                    </button>
                </div>
            </div>
        </div>
    );
}
