import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Key, Save, Trash2, Loader2, Check, AlertCircle, Zap } from 'lucide-react';

interface PlatformCredential {
    id: string;
    platform: string;
    credentials: Record<string, string>;
    notes?: string;
    updatedAt: string;
}

const PLATFORMS = [
    {
        id: 'PLATFORM_SMTP',
        name: 'Platform SMTP',
        description: 'SMTP settings for system emails (password resets, MFA codes, notifications)',
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
        fields: [
            { key: 'clientId', label: 'Client ID', placeholder: 'xxx.apps.googleusercontent.com' },
            { key: 'clientSecret', label: 'Client Secret', placeholder: 'GOCSPX-xxx' },
            { key: 'developerToken', label: 'Developer Token', placeholder: '22-character token' }
        ]
    },
    {
        id: 'META_ADS',
        name: 'Meta Ads',
        fields: [
            { key: 'appId', label: 'App ID', placeholder: '123456789' },
            { key: 'appSecret', label: 'App Secret', placeholder: 'abc123...' }
        ]
    }
];

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

            // Initialize form data with empty values for all platforms
            const initialForm: Record<string, Record<string, string>> = {};
            const initialNotes: Record<string, string> = {};

            PLATFORMS.forEach(platform => {
                initialForm[platform.id] = {};
                platform.fields.forEach(field => {
                    initialForm[platform.id][field.key] = '';
                });
                initialNotes[platform.id] = '';
            });

            // Populate with existing values (masked)
            data.forEach((cred: PlatformCredential) => {
                if (initialForm[cred.platform]) {
                    Object.keys(cred.credentials).forEach(key => {
                        // Don't overwrite with masked values - leave empty unless user types
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
                // Clear form after save
                setFormData(prev => ({
                    ...prev,
                    [platformId]: Object.fromEntries(
                        Object.keys(prev[platformId] || {}).map(k => [k, ''])
                    )
                }));
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

    if (loading) {
        return <div className="flex items-center justify-center py-12"><Loader2 className="animate-spin text-gray-400" /></div>;
    }

    return (
        <div className="max-w-4xl">
            <div className="flex items-center gap-3 mb-6">
                <Key className="text-slate-600" size={28} />
                <h1 className="text-2xl font-bold text-slate-800">Platform Credentials</h1>
            </div>

            <p className="text-slate-600 mb-8">
                Configure API credentials for ad platform integrations. These credentials are stored securely and used for OAuth flows and API access.
            </p>

            {message && (
                <div className={`mb-6 p-4 rounded-lg flex items-center gap-2 ${message.type === 'success' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'
                    }`}>
                    {message.type === 'success' ? <Check size={18} /> : <AlertCircle size={18} />}
                    {message.text}
                </div>
            )}

            <div className="space-y-8">
                {PLATFORMS.map(platform => (
                    <div key={platform.id} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                        <div className="p-6 border-b border-slate-100 flex justify-between items-center">
                            <div>
                                <h2 className="text-lg font-semibold text-slate-900">{platform.name}</h2>
                                <p className="text-sm text-slate-500">{platform.id}</p>
                            </div>
                            {isConfigured(platform.id) && (
                                <span className="bg-green-100 text-green-800 text-xs px-2 py-1 rounded-full">Configured</span>
                            )}
                        </div>

                        <div className="p-6 space-y-4">
                            {platform.fields.map(field => (
                                <div key={field.key}>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">
                                        {field.label}
                                    </label>
                                    <input
                                        type="password"
                                        className="w-full p-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                        placeholder={isConfigured(platform.id) ? '••••••••' : field.placeholder}
                                        value={formData[platform.id]?.[field.key] || ''}
                                        onChange={e => setFormData(prev => ({
                                            ...prev,
                                            [platform.id]: {
                                                ...prev[platform.id],
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
                                    className="w-full p-2 border border-slate-300 rounded-lg"
                                    placeholder="e.g., Production credentials from Google Cloud Console"
                                    value={notes[platform.id] || ''}
                                    onChange={e => setNotes(prev => ({ ...prev, [platform.id]: e.target.value }))}
                                />
                            </div>

                            <div className="flex justify-end gap-2 pt-4">
                                {isConfigured(platform.id) && (
                                    <button
                                        onClick={() => handleDelete(platform.id)}
                                        className="px-4 py-2 text-red-600 hover:bg-red-50 rounded-lg flex items-center gap-2"
                                    >
                                        <Trash2 size={16} /> Delete
                                    </button>
                                )}
                                {'testable' in platform && platform.testable && (
                                    <button
                                        onClick={() => handleTestSmtp()}
                                        disabled={testing === platform.id}
                                        className="px-4 py-2 text-amber-600 border border-amber-300 hover:bg-amber-50 rounded-lg flex items-center gap-2"
                                    >
                                        {testing === platform.id ? <Loader2 className="animate-spin" size={16} /> : <Zap size={16} />}
                                        Test Connection
                                    </button>
                                )}
                                <button
                                    onClick={() => handleSave(platform.id)}
                                    disabled={saving === platform.id}
                                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
                                >
                                    {saving === platform.id ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
                                    Save
                                </button>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
