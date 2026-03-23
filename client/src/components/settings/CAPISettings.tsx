/**
 * Tracking Pixels & CAPI Settings — unified ad platform tracking config.
 *
 * Why unified: Users previously needed FunnelKit + separate plugins for each
 * platform's pixel. This component manages both client-side pixel injection
 * and server-side CAPI in one place. Pixel IDs are served to the WC plugin
 * via a public API endpoint; access tokens stay server-side only.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useApi } from '../../hooks/useApi';
import {
    Save, Loader2, CheckCircle2, XCircle, Eye, EyeOff, Zap, ChevronDown, ChevronUp,
    Clock, AlertCircle, RefreshCw, Shield
} from 'lucide-react';

interface PlatformConfig {
    enabled: boolean;
    config: Record<string, any>;
    updatedAt: string | null;
}

interface PlatformDef {
    key: string;
    label: string;
    description: string;
    color: string;
    fields: FieldDef[];
}

interface FieldDef {
    name: string;
    label: string;
    type: 'text' | 'password' | 'toggle' | 'select';
    placeholder?: string;
    help?: string;
    options?: { value: string; label: string }[];
    section?: 'pixel' | 'capi' | 'advanced';
}

/** Standard event toggles shown for each platform */
const EVENT_TOGGLES = [
    { key: 'pageView', label: 'PageView', help: 'Fire on every page load' },
    { key: 'viewContent', label: 'ViewContent', help: 'Product page views' },
    { key: 'addToCart', label: 'AddToCart', help: 'When item added to cart' },
    { key: 'initiateCheckout', label: 'InitiateCheckout', help: 'Checkout page' },
    { key: 'purchase', label: 'Purchase', help: 'Order confirmation page' },
    { key: 'search', label: 'Search', help: 'Search results page' },
];

/** Platform definitions — drives the dynamic form rendering */
const PLATFORMS: PlatformDef[] = [
    {
        key: 'meta',
        label: 'Meta (Facebook / Instagram)',
        description: 'Pixel tracking + server-side Conversions API.',
        color: 'bg-blue-500',
        fields: [
            { name: 'pixelId', label: 'Pixel ID', type: 'text', placeholder: '123456789012345', section: 'pixel' },
            { name: 'accessToken', label: 'CAPI Access Token', type: 'password', placeholder: 'EAA...', section: 'capi' },
            { name: 'testEventCode', label: 'Test Event Code', type: 'text', placeholder: 'TEST12345', help: 'Optional. Use this in Meta Events Manager to verify events.', section: 'capi' },
            { name: 'advancedMatching', label: 'Advanced Matching', type: 'toggle', help: 'Send hashed customer PII for better match rates.', section: 'advanced' },
            { name: 'contentIdFormat', label: 'Content ID Format', type: 'select', options: [{ value: 'sku', label: 'Product SKU' }, { value: 'id', label: 'Product ID' }], section: 'advanced' },
            { name: 'contentIdPrefix', label: 'Content ID Prefix', type: 'text', placeholder: 'Optional prefix', section: 'advanced' },
            { name: 'contentIdSuffix', label: 'Content ID Suffix', type: 'text', placeholder: 'Optional suffix', section: 'advanced' },
            { name: 'excludeShipping', label: 'Exclude Shipping from Total', type: 'toggle', section: 'advanced' },
            { name: 'excludeTax', label: 'Exclude Tax from Total', type: 'toggle', section: 'advanced' },
        ],
    },
    {
        key: 'tiktok',
        label: 'TikTok',
        description: 'Pixel tracking + server-side Events API.',
        color: 'bg-gray-900',
        fields: [
            { name: 'pixelCode', label: 'Pixel Code', type: 'text', placeholder: 'CXXXXXXXXXXXXXXXXX', section: 'pixel' },
            { name: 'accessToken', label: 'CAPI Access Token', type: 'password', placeholder: 'Server-side access token', section: 'capi' },
            { name: 'advancedMatching', label: 'Advanced Matching', type: 'toggle', help: 'Send hashed customer PII for better match rates.', section: 'advanced' },
        ],
    },
    {
        key: 'google',
        label: 'Google Ads',
        description: 'Conversion tracking pixel + Enhanced Conversions API (purchase only).',
        color: 'bg-green-500',
        fields: [
            { name: 'conversionId', label: 'Conversion ID (AW-)', type: 'text', placeholder: 'AW-123456789', section: 'pixel' },
            { name: 'conversionLabel', label: 'Conversion Label', type: 'text', placeholder: 'AbCdEf...', section: 'pixel' },
            { name: 'customerId', label: 'Customer ID (for CAPI)', type: 'text', placeholder: '123-456-7890', section: 'capi' },
            { name: 'conversionActionId', label: 'Conversion Action ID', type: 'text', placeholder: '123456789', help: 'Found in Google Ads under Conversions.', section: 'capi' },
        ],
    },
    {
        key: 'pinterest',
        label: 'Pinterest',
        description: 'Tag tracking + server-side Conversions API.',
        color: 'bg-red-500',
        fields: [
            { name: 'tagId', label: 'Tag ID', type: 'text', placeholder: '123456789012', section: 'pixel' },
            { name: 'adAccountId', label: 'Ad Account ID (for CAPI)', type: 'text', placeholder: '549755885175', section: 'capi' },
            { name: 'accessToken', label: 'CAPI Access Token', type: 'password', placeholder: 'pina_...', section: 'capi' },
        ],
    },
    {
        key: 'ga4',
        label: 'Google Analytics 4',
        description: 'GA4 tracking tag + Measurement Protocol (server-side).',
        color: 'bg-amber-500',
        fields: [
            { name: 'measurementId', label: 'Measurement ID', type: 'text', placeholder: 'G-XXXXXXXXXX', section: 'pixel' },
            { name: 'apiSecret', label: 'MP API Secret (for CAPI)', type: 'password', placeholder: 'From GA4 Admin → Data Streams', section: 'capi' },
            { name: 'useDebugEndpoint', label: 'Debug Mode', type: 'toggle', help: 'Send server-side events to GA4 debug endpoint.', section: 'capi' },
        ],
    },
    {
        key: 'snapchat',
        label: 'Snapchat',
        description: 'Snap Pixel tracking + server-side Conversions API.',
        color: 'bg-yellow-400',
        fields: [
            { name: 'pixelId', label: 'Snap Pixel ID', type: 'text', placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx', section: 'pixel' },
            { name: 'accessToken', label: 'CAPI Access Token', type: 'password', placeholder: 'Bearer token', section: 'capi' },
        ],
    },
    {
        key: 'microsoft',
        label: 'Microsoft / Bing Ads',
        description: 'UET tag tracking + server-side Conversions API.',
        color: 'bg-cyan-600',
        fields: [
            { name: 'tagId', label: 'UET Tag ID', type: 'text', placeholder: '12345678', section: 'pixel' },
            { name: 'accessToken', label: 'CAPI Access Token', type: 'password', placeholder: 'SharedAccessSignature...', section: 'capi' },
        ],
    },
    {
        key: 'twitter',
        label: 'Twitter / X',
        description: 'X Pixel tracking + server-side Conversions API.',
        color: 'bg-slate-800',
        fields: [
            { name: 'pixelId', label: 'X Pixel ID', type: 'text', placeholder: 'xxxxxxx', section: 'pixel' },
            { name: 'accessToken', label: 'CAPI Access Token', type: 'password', placeholder: 'Bearer token', section: 'capi' },
        ],
    },
];

interface DeliveryLog {
    id: string;
    platform: string;
    eventName: string;
    eventId: string;
    status: string;
    httpStatus: number | null;
    attempts: number;
    lastError: string | null;
    sentAt: string | null;
    createdAt: string;
}

export function CAPISettings() {
    const { get, put, post, accountId, isReady } = useApi();
    const [configs, setConfigs] = useState<Record<string, PlatformConfig>>({});
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState<string | null>(null);
    const [testing, setTesting] = useState<string | null>(null);
    const [testResult, setTestResult] = useState<{ platform: string; success: boolean; message: string } | null>(null);
    const [expanded, setExpanded] = useState<string | null>(null);
    const [showPasswords, setShowPasswords] = useState<Record<string, boolean>>({});

    // Delivery logs state
    const [showLogs, setShowLogs] = useState(false);
    const [logs, setLogs] = useState<DeliveryLog[]>([]);
    const [logsLoading, setLogsLoading] = useState(false);

    // Consent mode state
    const [consentAutoAccept, setConsentAutoAccept] = useState(false);
    const [savingConsent, setSavingConsent] = useState(false);

    /** Ref guard prevents re-fetch from overwriting local edits */
    const hasFetched = useRef(false);

    /** Fetch all platform configs on mount (once) */
    const fetchConfigs = useCallback(async () => {
        if (!isReady) return;
        try {
            const data = await get<{ platforms: Record<string, PlatformConfig>; consent?: { autoAccept?: boolean } }>(`/api/capi/config?accountId=${accountId}`);
            setConfigs(data.platforms);
            if (data.consent) setConsentAutoAccept(!!data.consent.autoAccept);
        } catch { /* silently fail on initial load */ }
        finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [accountId, isReady]);

    useEffect(() => {
        if (hasFetched.current) return;
        if (!isReady) return;
        hasFetched.current = true;
        fetchConfigs();
    }, [isReady, fetchConfigs]);

    /** Save a single platform's config */
    const handleSave = async (platformKey: string) => {
        const platformConfig = configs[platformKey];
        if (!platformConfig) return;

        setSaving(platformKey);
        try {
            await put(`/api/capi/config/${platformKey}`, {
                accountId,
                enabled: platformConfig.enabled,
                config: platformConfig.config,
            });
        } catch { /* error handled by api layer */ }
        finally { setSaving(null); }
    };

    /** Send a test event */
    const handleTest = async (platformKey: string) => {
        setTesting(platformKey);
        setTestResult(null);
        try {
            const result = await post<{ success: boolean; message: string }>(`/api/capi/test/${platformKey}`, { accountId });
            setTestResult({ platform: platformKey, success: result.success, message: result.message });
        } catch (e: any) {
            setTestResult({ platform: platformKey, success: false, message: e.message || 'Test failed' });
        }
        finally { setTesting(null); }
    };

    /** Update a field in local state */
    const updateField = (platformKey: string, fieldName: string, value: any) => {
        setConfigs(prev => ({
            ...prev,
            [platformKey]: {
                ...prev[platformKey],
                config: { ...prev[platformKey]?.config, [fieldName]: value },
            },
        }));
    };

    /** Toggle enabled state */
    const toggleEnabled = (platformKey: string) => {
        setConfigs(prev => ({
            ...prev,
            [platformKey]: {
                ...prev[platformKey],
                enabled: !prev[platformKey]?.enabled,
            },
        }));
    };

    /** Fetch delivery logs */
    const fetchLogs = async () => {
        setLogsLoading(true);
        try {
            const data = await get<{ deliveries: DeliveryLog[] }>(`/api/capi/deliveries?accountId=${accountId}&limit=25`);
            setLogs(data.deliveries);
        } catch { /* handled */ }
        finally { setLogsLoading(false); }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {/* Google Consent Mode v2 */}
            <div id="consent-mode" className="rounded-xl border border-indigo-200 dark:border-indigo-800 bg-gradient-to-r from-indigo-50 to-purple-50 dark:from-indigo-950/30 dark:to-purple-950/30 p-5">
                <div className="flex items-start gap-3">
                    <Shield className="w-5 h-5 text-indigo-500 shrink-0 mt-0.5" />
                    <div className="flex-1">
                        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Google Consent Mode v2</h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                            Controls how Google tags behave based on user consent. Required for EEA/UK visitors.
                            Enable auto-accept for regions without cookie consent requirements (e.g. Australia).
                        </p>
                        <div className="mt-3 flex items-center gap-4">
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={consentAutoAccept}
                                    onChange={(e) => setConsentAutoAccept(e.target.checked)}
                                    className="w-4 h-4 text-indigo-600 rounded focus:ring-indigo-500"
                                />
                                <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                                    Auto-accept all consent (no banner needed)
                                </span>
                            </label>
                            <button
                                onClick={async () => {
                                    setSavingConsent(true);
                                    try {
                                        await put(`/api/capi/config/_consent`, { accountId, enabled: true, config: { autoAccept: consentAutoAccept } });
                                    } catch { /* handled */ }
                                    finally { setSavingConsent(false); }
                                }}
                                disabled={savingConsent}
                                className="flex items-center gap-1 px-3 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors text-xs font-medium"
                            >
                                {savingConsent ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                                Save
                            </button>
                        </div>
                        {!consentAutoAccept && (
                            <p className="text-xs text-amber-600 dark:text-amber-400 mt-2">
                                ⚠️ Consent defaults to denied. You need a cookie consent banner to grant consent for visitors.
                            </p>
                        )}
                    </div>
                </div>
            </div>

            {/* Platform Cards */}
            {PLATFORMS.map(platform => {
                const config = configs[platform.key] || { enabled: false, config: {}, updatedAt: null };
                const isExpanded = expanded === platform.key;

                return (
                    <div
                        key={platform.key}
                        id={`capi-${platform.key}`}
                        className={`rounded-xl border transition-all duration-200 ${
                            config.enabled
                                ? 'border-blue-200 dark:border-blue-800 bg-white dark:bg-slate-800'
                                : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50'
                        }`}
                    >
                        {/* Header */}
                        <button
                            onClick={() => setExpanded(isExpanded ? null : platform.key)}
                            className="w-full flex items-center gap-3 px-5 py-4 text-left"
                        >
                            <span className={`w-3 h-3 rounded-full shrink-0 ${platform.color}`} />
                            <div className="flex-1 min-w-0">
                                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{platform.label}</h3>
                                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">{platform.description}</p>
                            </div>
                            <div className="flex items-center gap-3 shrink-0">
                                {config.enabled && (
                                    <span className="flex items-center gap-1 text-xs font-medium text-green-600 dark:text-green-400">
                                        <CheckCircle2 size={14} /> Active
                                    </span>
                                )}
                                {isExpanded ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
                            </div>
                        </button>

                        {/* Expanded form */}
                        {isExpanded && (
                            <div className="px-5 pb-5 border-t border-slate-100 dark:border-slate-700/50 pt-4 space-y-4">
                                {/* Enable toggle */}
                                <label className="flex items-center gap-3 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={config.enabled}
                                        onChange={() => toggleEnabled(platform.key)}
                                        className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                                    />
                                    <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                                        Enable {platform.label}
                                    </span>
                                </label>

                                {/* Credential Fields — grouped by section */}
                                {['pixel', 'capi', 'advanced'].map(section => {
                                    const sectionFields = platform.fields.filter(f => (f.section || 'pixel') === section);
                                    if (!sectionFields.length) return null;
                                    const sectionLabel = section === 'pixel' ? '🔍 Pixel / Tag' : section === 'capi' ? '🔒 Server-Side (CAPI)' : '⚙️ Advanced';
                                    return (
                                        <div key={section}>
                                            <p className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mt-3 mb-2">{sectionLabel}</p>
                                            {sectionFields.map(field => (
                                                <div key={field.name} className="mb-3">
                                                    {field.type === 'toggle' ? (
                                                        <label className="flex items-center gap-3 cursor-pointer">
                                                            <input type="checkbox" checked={!!config.config[field.name]} onChange={(e) => updateField(platform.key, field.name, e.target.checked)} className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500" />
                                                            <span className="text-sm text-slate-700 dark:text-slate-300">{field.label}</span>
                                                            {field.help && <span className="text-xs text-slate-400">{field.help}</span>}
                                                        </label>
                                                    ) : field.type === 'select' ? (
                                                        <>
                                                            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">{field.label}</label>
                                                            <select
                                                                value={config.config[field.name] || field.options?.[0]?.value || ''}
                                                                onChange={(e) => updateField(platform.key, field.name, e.target.value)}
                                                                className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-sm text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-blue-500"
                                                            >
                                                                {field.options?.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                                                            </select>
                                                        </>
                                                    ) : (
                                                        <>
                                                            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">{field.label}</label>
                                                            <div className="relative">
                                                                <input
                                                                    type={field.type === 'password' && !showPasswords[`${platform.key}-${field.name}`] ? 'password' : 'text'}
                                                                    value={config.config[field.name] || ''}
                                                                    onChange={(e) => updateField(platform.key, field.name, e.target.value)}
                                                                    placeholder={field.placeholder}
                                                                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-sm text-slate-900 dark:text-slate-100 font-mono focus:ring-2 focus:ring-blue-500 focus:border-blue-500 pr-10"
                                                                />
                                                                {field.type === 'password' && (
                                                                    <button type="button" onClick={() => setShowPasswords(prev => ({ ...prev, [`${platform.key}-${field.name}`]: !prev[`${platform.key}-${field.name}`] }))} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
                                                                        {showPasswords[`${platform.key}-${field.name}`] ? <EyeOff size={16} /> : <Eye size={16} />}
                                                                    </button>
                                                                )}
                                                            </div>
                                                            {field.help && <p className="text-xs text-slate-400 mt-1">{field.help}</p>}
                                                        </>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    );
                                })}

                                {/* Event Toggles */}
                                <div>
                                    <p className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mt-3 mb-2">📊 Event Tracking</p>
                                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                        {EVENT_TOGGLES.map(evt => (
                                            <label key={evt.key} className="flex items-center gap-2 p-2 rounded-lg border border-slate-100 dark:border-slate-700 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors" title={evt.help}>
                                                <input
                                                    type="checkbox"
                                                    checked={config.config.events?.[evt.key] !== false}
                                                    onChange={(e) => {
                                                        const events = { ...(config.config.events || {}), [evt.key]: e.target.checked };
                                                        updateField(platform.key, 'events', events);
                                                    }}
                                                    className="w-3.5 h-3.5 text-blue-600 rounded focus:ring-blue-500"
                                                />
                                                <span className="text-xs font-medium text-slate-700 dark:text-slate-300">{evt.label}</span>
                                            </label>
                                        ))}
                                    </div>
                                </div>

                                {/* Actions */}
                                <div className="flex items-center gap-3 pt-2">
                                    <button
                                        onClick={() => handleSave(platform.key)}
                                        disabled={saving === platform.key}
                                        className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors text-sm font-medium"
                                    >
                                        {saving === platform.key ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                                        Save
                                    </button>
                                    {config.enabled && (
                                        <button
                                            onClick={() => handleTest(platform.key)}
                                            disabled={testing === platform.key}
                                            className="flex items-center gap-2 px-4 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 disabled:opacity-50 transition-colors text-sm font-medium"
                                        >
                                            {testing === platform.key ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
                                            Send Test Event
                                        </button>
                                    )}
                                </div>

                                {/* Test result */}
                                {testResult && testResult.platform === platform.key && (
                                    <div className={`flex items-start gap-2 p-3 rounded-lg text-sm ${
                                        testResult.success
                                            ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400'
                                            : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400'
                                    }`}>
                                        {testResult.success ? <CheckCircle2 size={16} className="shrink-0 mt-0.5" /> : <XCircle size={16} className="shrink-0 mt-0.5" />}
                                        {testResult.message}
                                    </div>
                                )}

                                {/* Last updated */}
                                {config.updatedAt && (
                                    <p className="text-xs text-slate-400 flex items-center gap-1">
                                        <Clock size={12} />
                                        Last updated: {new Date(config.updatedAt).toLocaleString()}
                                    </p>
                                )}
                            </div>
                        )}
                    </div>
                );
            })}

            {/* Delivery Logs */}
            <div className="border-t border-slate-200 dark:border-slate-700 pt-6 mt-6">
                <button
                    onClick={() => { setShowLogs(!showLogs); if (!showLogs) fetchLogs(); }}
                    className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors"
                >
                    <RefreshCw size={16} className={logsLoading ? 'animate-spin' : ''} />
                    Recent Delivery Logs
                    {showLogs ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>

                {showLogs && (
                    <div className="mt-4 overflow-x-auto">
                        {logsLoading ? (
                            <div className="flex items-center justify-center py-8">
                                <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
                            </div>
                        ) : logs.length === 0 ? (
                            <p className="text-sm text-slate-400 py-4">No delivery logs yet. Events will appear here once conversions are forwarded.</p>
                        ) : (
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="text-left text-xs font-medium text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
                                        <th className="pb-2 pr-4">Platform</th>
                                        <th className="pb-2 pr-4">Event</th>
                                        <th className="pb-2 pr-4">Status</th>
                                        <th className="pb-2 pr-4">HTTP</th>
                                        <th className="pb-2 pr-4">Attempts</th>
                                        <th className="pb-2">Time</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
                                    {logs.map(log => (
                                        <tr key={log.id} className="text-slate-700 dark:text-slate-300">
                                            <td className="py-2 pr-4 font-mono text-xs">{log.platform}</td>
                                            <td className="py-2 pr-4">{log.eventName}</td>
                                            <td className="py-2 pr-4">
                                                <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${
                                                    log.status === 'SENT' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                                                    : log.status === 'PENDING' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                                                    : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                                                }`}>
                                                    {log.status === 'SENT' && <CheckCircle2 size={10} />}
                                                    {log.status === 'FAILED' && <AlertCircle size={10} />}
                                                    {log.status}
                                                </span>
                                            </td>
                                            <td className="py-2 pr-4 font-mono text-xs">{log.httpStatus || '—'}</td>
                                            <td className="py-2 pr-4 text-center">{log.attempts}</td>
                                            <td className="py-2 text-xs text-slate-400">{new Date(log.createdAt).toLocaleString()}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
