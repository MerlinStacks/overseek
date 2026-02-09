import { useEffect, useState } from 'react';
import { Logger } from '../../utils/logger';
import { useAuth } from '../../context/AuthContext';
import {
    Key, Save, Trash2, Loader2, Check, AlertCircle, Zap, Mail, Globe,
    Facebook, Bell, Copy, Link, ExternalLink, Shield, Eye, EyeOff, Info,
    CheckCircle
} from 'lucide-react';

interface PlatformCredential {
    id: string;
    platform: string;
    credentials: Record<string, string>;
    notes?: string;
    updatedAt: string;
}

interface FieldConfig {
    key: string;
    label: string;
    placeholder: string;
    /** Brief help text shown below the field */
    helpText?: string;
    /** Whether this field is required for the integration to work */
    required?: boolean;
    /** Whether to treat this as a sensitive field (masked by default) */
    sensitive?: boolean;
}

interface PlatformConfig {
    id: string;
    name: string;
    description: string;
    icon: React.ElementType;
    /** Brand colour class for the icon badge */
    iconColor: string;
    fields: FieldConfig[];
    testable?: boolean;
    /** OAuth callback path for platforms that need it */
    callbackPath?: string;
    /** Webhook URL path for platforms that need it */
    webhookPath?: string;
    /** Link to the provider's developer console */
    docsUrl?: string;
    /** Short label for the docs link */
    docsLabel?: string;
}

const PLATFORMS: PlatformConfig[] = [
    {
        id: 'PLATFORM_SMTP',
        name: 'Email (SMTP)',
        description: 'Send system emails — password resets, MFA codes, and notifications.',
        icon: Mail,
        iconColor: 'bg-sky-500',
        fields: [
            { key: 'host', label: 'SMTP Host', placeholder: 'smtp.example.com', required: true },
            { key: 'port', label: 'Port', placeholder: '587', required: true, helpText: 'Use 587 for STARTTLS or 465 for implicit TLS.' },
            { key: 'username', label: 'Username', placeholder: 'your-email@example.com', required: true },
            { key: 'password', label: 'Password', placeholder: '••••••••', required: true, sensitive: true },
            { key: 'fromEmail', label: 'From Email', placeholder: 'noreply@example.com', helpText: 'The sender address shown to recipients.' },
            { key: 'fromName', label: 'From Name', placeholder: 'OverSeek' },
            { key: 'secure', label: 'Use TLS/SSL', placeholder: 'true', helpText: 'Set to "true" for port 465 (implicit TLS).' }
        ],
        testable: true
    },
    {
        id: 'GOOGLE_ADS',
        name: 'Google Ads',
        description: 'Let users connect their Google Ads accounts via OAuth.',
        icon: Globe,
        iconColor: 'bg-red-500',
        docsUrl: 'https://console.cloud.google.com/apis/credentials',
        docsLabel: 'Google Cloud Console',
        fields: [
            { key: 'clientId', label: 'Client ID', placeholder: 'xxx.apps.googleusercontent.com', required: true, helpText: 'From your Google Cloud OAuth 2.0 credential.' },
            { key: 'clientSecret', label: 'Client Secret', placeholder: 'GOCSPX-xxx', required: true, sensitive: true },
            { key: 'developerToken', label: 'Developer Token', placeholder: '22-character alphanumeric token', required: true, helpText: 'Found in Google Ads → Tools & Settings → API Center. Required for all Ads API calls.' },
            { key: 'loginCustomerId', label: 'Manager Account ID (MCC)', placeholder: '123-456-7890', helpText: 'Only needed if you manage ads through an MCC (Manager) account. Format: 123-456-7890.' }
        ],
        callbackPath: '/api/oauth/google/callback'
    },
    {
        id: 'META_ADS',
        name: 'Meta Ads',
        description: 'Let users connect Facebook & Instagram Ads via OAuth.',
        icon: Facebook,
        iconColor: 'bg-blue-600',
        docsUrl: 'https://developers.facebook.com/apps',
        docsLabel: 'Meta Developer Console',
        fields: [
            { key: 'appId', label: 'App ID', placeholder: '123456789', required: true },
            { key: 'appSecret', label: 'App Secret', placeholder: 'abc123...', required: true, sensitive: true }
        ],
        callbackPath: '/api/oauth/meta/ads/callback'
    },
    {
        id: 'META_MESSAGING',
        name: 'Meta Messaging',
        description: 'Facebook Messenger & Instagram DM integration.',
        icon: Facebook,
        iconColor: 'bg-indigo-500',
        docsUrl: 'https://developers.facebook.com/apps',
        docsLabel: 'Meta Developer Console',
        fields: [
            { key: 'appId', label: 'App ID', placeholder: '123456789', required: true },
            { key: 'appSecret', label: 'App Secret', placeholder: 'abc123...', required: true, sensitive: true },
            { key: 'webhookVerifyToken', label: 'Webhook Verify Token', placeholder: 'your_secret_token', required: true, helpText: "Must match the Verify Token in your Facebook App's webhook settings." }
        ],
        callbackPath: '/api/oauth/meta/messaging/callback',
        webhookPath: '/api/meta-webhook'
    },
    {
        id: 'WEB_PUSH_VAPID',
        name: 'Push Notifications',
        description: 'VAPID keys for browser push notifications.',
        icon: Bell,
        iconColor: 'bg-violet-500',
        fields: [
            { key: 'publicKey', label: 'Public Key', placeholder: 'Base64-encoded public key', required: true },
            { key: 'privateKey', label: 'Private Key', placeholder: 'Base64-encoded private key', required: true, sensitive: true }
        ]
    }
];

type PlatformId = 'PLATFORM_SMTP' | 'GOOGLE_ADS' | 'META_ADS' | 'META_MESSAGING' | 'WEB_PUSH_VAPID';

/**
 * Copyable URL row — displays a URL with a one-click copy button.
 */
function CopyableUrl({ label, url, onCopied }: { label: string; url: string; onCopied: () => void }) {
    return (
        <div className="flex items-center gap-3 group">
            <span className="text-xs font-medium text-slate-500 w-32 shrink-0">{label}</span>
            <div className="flex-1 flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 font-mono text-xs text-slate-700 overflow-x-auto">
                {url}
            </div>
            <button
                onClick={() => { navigator.clipboard.writeText(url); onCopied(); }}
                className="p-2 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                title="Copy to clipboard"
            >
                <Copy size={14} />
            </button>
        </div>
    );
}

/**
 * Super Admin page for managing platform API credentials.
 * Credentials are stored encrypted in the database.
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
    const [revealedFields, setRevealedFields] = useState<Record<string, boolean>>({});

    useEffect(() => {
        fetchCredentials();
    }, [token]);

    /** Auto-dismiss success messages after 4 seconds */
    useEffect(() => {
        if (message?.type === 'success') {
            const timer = setTimeout(() => setMessage(null), 4000);
            return () => clearTimeout(timer);
        }
    }, [message]);

    async function fetchCredentials() {
        try {
            const res = await fetch('/api/admin/platform-credentials', {
                headers: { Authorization: `Bearer ${token}` }
            });
            const data = await res.json();
            setCredentials(data);

            const initialForm: Record<string, Record<string, string>> = {};
            const initialNotes: Record<string, string> = {};

            PLATFORMS.forEach(platform => {
                initialForm[platform.id] = {};
                platform.fields.forEach(field => {
                    initialForm[platform.id][field.key] = '';
                });
                initialNotes[platform.id] = '';
            });

            data.forEach((cred: PlatformCredential) => {
                if (cred.credentials) {
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
            Logger.error('An error occurred', { error: err });
        } finally {
            setLoading(false);
        }
    }

    async function handleSave(platformId: string) {
        setSaving(platformId);
        setMessage(null);

        try {
            const creds: Record<string, string> = {};
            Object.entries(formData[platformId] || {}).forEach(([key, value]) => {
                if (value.trim()) {
                    creds[key] = value.trim();
                }
            });

            if (Object.keys(creds).length === 0) {
                setMessage({ type: 'error', text: 'Please fill in at least one credential field.' });
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
                setMessage({ type: 'success', text: `${PLATFORMS.find(p => p.id === platformId)?.name} credentials saved.` });
                fetchCredentials();
            } else {
                const err = await res.json();
                setMessage({ type: 'error', text: err.error || 'Failed to save.' });
            }
        } catch {
            setMessage({ type: 'error', text: 'Network error.' });
        } finally {
            setSaving(null);
        }
    }

    async function handleDelete(platformId: string) {
        if (!confirm(`Delete all ${PLATFORMS.find(p => p.id === platformId)?.name} credentials? This cannot be undone.`)) return;

        try {
            const res = await fetch(`/api/admin/platform-credentials/${platformId}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${token}` }
            });

            if (res.ok) {
                setMessage({ type: 'success', text: 'Credentials deleted.' });
                fetchCredentials();
            }
        } catch {
            setMessage({ type: 'error', text: 'Failed to delete.' });
        }
    }

    /**
     * Tests SMTP connection with the saved credentials.
     */
    async function handleTestSmtp() {
        setTesting('PLATFORM_SMTP');
        setMessage(null);

        try {
            const smtpData = formData['PLATFORM_SMTP'] || {};

            if (!smtpData.host || !smtpData.port || !smtpData.username || !smtpData.password) {
                setMessage({ type: 'error', text: 'Host, port, username, and password are required to test.' });
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
                setMessage({ type: 'error', text: result.error || 'SMTP connection failed.' });
            }
        } catch {
            setMessage({ type: 'error', text: 'Network error during SMTP test.' });
        } finally {
            setTesting(null);
        }
    }

    const isConfigured = (platformId: string) =>
        credentials.some(c => c.platform === platformId);

    const getLastUpdated = (platformId: string) => {
        const cred = credentials.find(c => c.platform === platformId);
        if (!cred?.updatedAt) return null;
        return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(cred.updatedAt));
    };

    /**
     * Generates VAPID keys via the backend.
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
                const text = await res.text();
                let errorMsg = `Server error (${res.status})`;
                try {
                    const err = JSON.parse(text);
                    errorMsg = err.error || err.message || errorMsg;
                } catch {
                    errorMsg = `${res.statusText || 'Server error'} (${res.status})`;
                }
                setMessage({ type: 'error', text: errorMsg });
                return;
            }

            const result = await res.json();

            if (result.alreadyExists) {
                setFormData(prev => ({
                    ...prev,
                    'WEB_PUSH_VAPID': {
                        publicKey: result.publicKey,
                        privateKey: '••••••••'
                    }
                }));
                setMessage({ type: 'success', text: result.message || 'VAPID keys already configured.' });
            } else {
                setFormData(prev => ({
                    ...prev,
                    'WEB_PUSH_VAPID': {
                        publicKey: result.publicKey,
                        privateKey: '(saved securely)'
                    }
                }));
                setMessage({ type: 'success', text: result.message || 'VAPID keys generated and saved!' });
            }

            fetchCredentials();
        } catch (err: unknown) {
            const errorMessage = err instanceof Error ? err.message : 'Network error generating keys';
            setMessage({ type: 'error', text: `Failed to generate keys: ${errorMessage}` });
        } finally {
            setGenerating(false);
        }
    }

    /** Toggle visibility of a sensitive field */
    function toggleReveal(fieldKey: string) {
        setRevealedFields(prev => ({ ...prev, [fieldKey]: !prev[fieldKey] }));
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <Loader2 className="animate-spin text-slate-400" size={28} />
            </div>
        );
    }

    const currentPlatform = PLATFORMS.find(p => p.id === activeTab)!;
    const configured = isConfigured(currentPlatform.id);
    const lastUpdated = getLastUpdated(currentPlatform.id);
    const configuredCount = PLATFORMS.filter(p => isConfigured(p.id)).length;

    return (
        <div className="max-w-4xl">
            {/* ── Page Header ── */}
            <div className="mb-8">
                <div className="flex items-center gap-3 mb-2">
                    <div className="p-2 bg-slate-100 rounded-lg">
                        <Shield className="text-slate-600" size={22} />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-slate-900">Platform Credentials</h1>
                        <p className="text-sm text-slate-500 mt-0.5">
                            {configuredCount}/{PLATFORMS.length} platforms configured
                        </p>
                    </div>
                </div>
            </div>

            {/* ── Toast Message ── */}
            {message && (
                <div
                    className={`mb-6 px-4 py-3 rounded-lg flex items-center gap-3 text-sm font-medium animate-in fade-in slide-in-from-top-2 duration-200
                        ${message.type === 'success'
                            ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                            : 'bg-red-50 text-red-800 border border-red-200'
                        }`}
                >
                    {message.type === 'success' ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
                    {message.text}
                </div>
            )}

            {/* ── Platform Sidebar + Content Layout ── */}
            <div className="flex gap-6">
                {/* Left Sidebar — Platform List */}
                <div className="w-56 shrink-0 space-y-1">
                    {PLATFORMS.map((platform) => {
                        const Icon = platform.icon;
                        const isActive = activeTab === platform.id;
                        const done = isConfigured(platform.id);

                        return (
                            <button
                                key={platform.id}
                                onClick={() => { setActiveTab(platform.id as PlatformId); setMessage(null); }}
                                className={`
                                    w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left text-sm font-medium transition-all
                                    ${isActive
                                        ? 'bg-blue-50 text-blue-700 shadow-sm ring-1 ring-blue-200'
                                        : 'text-slate-600 hover:bg-slate-50 hover:text-slate-800'
                                    }
                                `}
                            >
                                <div className={`p-1.5 rounded-md ${isActive ? platform.iconColor : 'bg-slate-200'}`}>
                                    <Icon size={14} className="text-white" />
                                </div>
                                <span className="flex-1 truncate">{platform.name}</span>
                                {done && <CheckCircle size={14} className="text-emerald-500 shrink-0" />}
                            </button>
                        );
                    })}
                </div>

                {/* Right Content — Active Platform */}
                <div className="flex-1 min-w-0">
                    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">

                        {/* ── Platform Header ── */}
                        <div className="px-6 py-5 border-b border-slate-100">
                            <div className="flex items-start justify-between">
                                <div className="flex items-center gap-3">
                                    <div className={`p-2.5 rounded-xl ${currentPlatform.iconColor}`}>
                                        <currentPlatform.icon size={20} className="text-white" />
                                    </div>
                                    <div>
                                        <div className="flex items-center gap-2">
                                            <h2 className="text-lg font-semibold text-slate-900">{currentPlatform.name}</h2>
                                            {configured ? (
                                                <span className="inline-flex items-center gap-1 bg-emerald-50 text-emerald-700 text-xs font-medium px-2 py-0.5 rounded-full border border-emerald-200">
                                                    <CheckCircle size={10} /> Active
                                                </span>
                                            ) : (
                                                <span className="inline-flex items-center gap-1 bg-slate-100 text-slate-500 text-xs font-medium px-2 py-0.5 rounded-full">
                                                    Not configured
                                                </span>
                                            )}
                                        </div>
                                        <p className="text-sm text-slate-500 mt-0.5">{currentPlatform.description}</p>
                                        {lastUpdated && (
                                            <p className="text-xs text-slate-400 mt-1">Last updated {lastUpdated}</p>
                                        )}
                                    </div>
                                </div>
                                {currentPlatform.docsUrl && (
                                    <a
                                        href={currentPlatform.docsUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-700 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-lg transition-colors shrink-0"
                                    >
                                        <ExternalLink size={12} />
                                        {currentPlatform.docsLabel || 'Developer Console'}
                                    </a>
                                )}
                            </div>
                        </div>

                        {/* ── URL Configuration Section ── */}
                        {(currentPlatform.callbackPath || currentPlatform.webhookPath) && (
                            <div className="px-6 py-4 bg-slate-50 border-b border-slate-100">
                                <div className="flex items-center gap-2 mb-3">
                                    <Link size={14} className="text-slate-500" />
                                    <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Required URLs</span>
                                </div>
                                <p className="text-xs text-slate-500 mb-3">
                                    Copy these URLs into your{' '}
                                    <span className="font-medium text-slate-700">
                                        {currentPlatform.docsLabel || 'developer console'}
                                    </span>.
                                </p>
                                <div className="space-y-2">
                                    {currentPlatform.callbackPath && (
                                        <CopyableUrl
                                            label={currentPlatform.id === 'META_MESSAGING' ? 'OAuth Redirect' : 'Callback URL'}
                                            url={`${window.location.origin}${currentPlatform.callbackPath}`}
                                            onCopied={() => setMessage({ type: 'success', text: 'Copied to clipboard!' })}
                                        />
                                    )}
                                    {currentPlatform.webhookPath && (
                                        <CopyableUrl
                                            label="Webhook URL"
                                            url={`${window.location.origin}${currentPlatform.webhookPath}`}
                                            onCopied={() => setMessage({ type: 'success', text: 'Copied to clipboard!' })}
                                        />
                                    )}
                                </div>
                            </div>
                        )}

                        {/* ── Credential Fields ── */}
                        <div className="px-6 py-5 space-y-5">
                            {/* Required fields section */}
                            {currentPlatform.fields.some(f => f.required) && (
                                <div>
                                    <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-4 flex items-center gap-2">
                                        <Key size={12} />
                                        Required Credentials
                                    </h3>
                                    <div className="space-y-4">
                                        {currentPlatform.fields.filter(f => f.required).map(field => {
                                            const fieldId = `${currentPlatform.id}.${field.key}`;
                                            const isSensitive = field.sensitive;
                                            const isRevealed = revealedFields[fieldId];

                                            return (
                                                <div key={field.key}>
                                                    <label className="flex items-center gap-1.5 text-sm font-medium text-slate-700 mb-1.5">
                                                        {field.label}
                                                        <span className="text-red-400 text-xs">*</span>
                                                    </label>
                                                    <div className="relative">
                                                        <input
                                                            type={isSensitive && !isRevealed ? 'password' : 'text'}
                                                            className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-shadow placeholder:text-slate-400"
                                                            placeholder={configured ? '••••••••' : field.placeholder}
                                                            value={formData[currentPlatform.id]?.[field.key] || ''}
                                                            onChange={e => setFormData(prev => ({
                                                                ...prev,
                                                                [currentPlatform.id]: {
                                                                    ...prev[currentPlatform.id],
                                                                    [field.key]: e.target.value
                                                                }
                                                            }))}
                                                        />
                                                        {isSensitive && (
                                                            <button
                                                                type="button"
                                                                onClick={() => toggleReveal(fieldId)}
                                                                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 transition-colors"
                                                                title={isRevealed ? 'Hide' : 'Show'}
                                                            >
                                                                {isRevealed ? <EyeOff size={16} /> : <Eye size={16} />}
                                                            </button>
                                                        )}
                                                    </div>
                                                    {field.helpText && (
                                                        <p className="mt-1 text-xs text-slate-400 flex items-start gap-1">
                                                            <Info size={11} className="mt-0.5 shrink-0" />
                                                            {field.helpText}
                                                        </p>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}

                            {/* Optional fields section */}
                            {currentPlatform.fields.some(f => !f.required) && (
                                <div>
                                    <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-4 flex items-center gap-2">
                                        Optional
                                    </h3>
                                    <div className="space-y-4">
                                        {currentPlatform.fields.filter(f => !f.required).map(field => {
                                            const fieldId = `${currentPlatform.id}.${field.key}`;
                                            const isSensitive = field.sensitive;
                                            const isRevealed = revealedFields[fieldId];

                                            return (
                                                <div key={field.key}>
                                                    <label className="text-sm font-medium text-slate-600 mb-1.5 block">
                                                        {field.label}
                                                    </label>
                                                    <div className="relative">
                                                        <input
                                                            type={isSensitive && !isRevealed ? 'password' : 'text'}
                                                            className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-shadow placeholder:text-slate-400 bg-slate-50 focus:bg-white"
                                                            placeholder={configured ? '••••••••' : field.placeholder}
                                                            value={formData[currentPlatform.id]?.[field.key] || ''}
                                                            onChange={e => setFormData(prev => ({
                                                                ...prev,
                                                                [currentPlatform.id]: {
                                                                    ...prev[currentPlatform.id],
                                                                    [field.key]: e.target.value
                                                                }
                                                            }))}
                                                        />
                                                        {isSensitive && (
                                                            <button
                                                                type="button"
                                                                onClick={() => toggleReveal(fieldId)}
                                                                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 transition-colors"
                                                                title={isRevealed ? 'Hide' : 'Show'}
                                                            >
                                                                {isRevealed ? <EyeOff size={16} /> : <Eye size={16} />}
                                                            </button>
                                                        )}
                                                    </div>
                                                    {field.helpText && (
                                                        <p className="mt-1 text-xs text-slate-400 flex items-start gap-1">
                                                            <Info size={11} className="mt-0.5 shrink-0" />
                                                            {field.helpText}
                                                        </p>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}

                            {/* Notes */}
                            <div className="pt-2 border-t border-slate-100">
                                <label className="text-sm font-medium text-slate-500 mb-1.5 block">Notes</label>
                                <input
                                    type="text"
                                    className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-shadow placeholder:text-slate-400 bg-slate-50 focus:bg-white"
                                    placeholder="e.g., Production credentials from Google Cloud Console"
                                    value={notes[currentPlatform.id] || ''}
                                    onChange={e => setNotes(prev => ({ ...prev, [currentPlatform.id]: e.target.value }))}
                                />
                            </div>
                        </div>

                        {/* ── Actions Footer ── */}
                        <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                {configured && (
                                    <button
                                        onClick={() => handleDelete(currentPlatform.id)}
                                        className="px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg flex items-center gap-2 transition-colors"
                                    >
                                        <Trash2 size={14} />
                                        Remove Credentials
                                    </button>
                                )}
                            </div>
                            <div className="flex items-center gap-2">
                                {currentPlatform.testable && (
                                    <button
                                        onClick={() => handleTestSmtp()}
                                        disabled={testing === currentPlatform.id}
                                        className="px-4 py-2 text-sm text-amber-700 border border-amber-300 bg-amber-50 hover:bg-amber-100 rounded-lg flex items-center gap-2 transition-colors disabled:opacity-50"
                                    >
                                        {testing === currentPlatform.id ? <Loader2 className="animate-spin" size={14} /> : <Zap size={14} />}
                                        Test Connection
                                    </button>
                                )}
                                {currentPlatform.id === 'WEB_PUSH_VAPID' && (
                                    <button
                                        onClick={handleGenerateVapidKeys}
                                        disabled={generating}
                                        className="px-4 py-2 text-sm text-violet-700 border border-violet-300 bg-violet-50 hover:bg-violet-100 rounded-lg flex items-center gap-2 transition-colors disabled:opacity-50"
                                    >
                                        {generating ? <Loader2 className="animate-spin" size={14} /> : <Zap size={14} />}
                                        Generate Keys
                                    </button>
                                )}
                                <button
                                    onClick={() => handleSave(currentPlatform.id)}
                                    disabled={saving === currentPlatform.id}
                                    className="px-5 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2 transition-colors font-medium shadow-sm"
                                >
                                    {saving === currentPlatform.id ? <Loader2 className="animate-spin" size={14} /> : <Save size={14} />}
                                    Save Credentials
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
