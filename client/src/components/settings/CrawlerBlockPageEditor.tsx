/**
 * CrawlerBlockPageEditor — Manage the HTML template shown to blocked crawlers.
 *
 * Why: Lets admins customize the 403 page so legitimate crawlers that get
 * accidentally flagged can see a branded page with contact info, rather
 * than a bare 403 error that provides no recourse.
 */

import { useState, useEffect, useCallback } from 'react';
import { Logger } from '../../utils/logger';
import { FileText, Loader2, RotateCcw, Save, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';

const DEFAULT_TEMPLATE = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Access Restricted - {{site_name}}</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; max-width: 600px; margin: 80px auto; padding: 20px; text-align: center; color: #334155; background: #f8fafc; }
    h1 { font-size: 1.5rem; color: #1e293b; margin-bottom: 0.5rem; }
    p { line-height: 1.6; margin: 0.75rem 0; }
    .muted { color: #94a3b8; font-size: 0.85rem; margin-top: 2.5rem; }
    .card { background: white; border-radius: 12px; padding: 2.5rem; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
  </style>
</head>
<body>
  <div class="card">
    <h1>Access Restricted</h1>
    <p>Automated access to <strong>{{site_name}}</strong> has been restricted.</p>
    <p>If you believe this is an error, please contact us at <strong>{{contact_email}}</strong>.</p>
    <p class="muted">Identified pattern: {{crawler_name}}</p>
  </div>
</body>
</html>`;

const PLACEHOLDERS = [
    { tag: '{{site_name}}', description: 'Your store name (from WordPress settings)' },
    { tag: '{{contact_email}}', description: 'Admin email address' },
    { tag: '{{crawler_name}}', description: 'The blocked crawler pattern that matched' },
];

export function CrawlerBlockPageEditor() {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [html, setHtml] = useState('');
    const [savedHtml, setSavedHtml] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [showPreview, setShowPreview] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);

    const fetchTemplate = useCallback(async () => {
        if (!currentAccount || !token) return;

        try {
            setIsLoading(true);
            const res = await fetch(`/api/crawlers/block-page`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount.id,
                }
            });

            if (!res.ok) throw new Error('Failed to fetch block page');

            const data = await res.json();
            const template = data.html || '';
            setHtml(template);
            setSavedHtml(template);
        } catch (err) {
            Logger.error('Failed to fetch block page template', { error: err });
            setError('Failed to load block page template');
        } finally {
            setIsLoading(false);
        }
    }, [currentAccount, token]);

    useEffect(() => {
        fetchTemplate();
    }, [fetchTemplate]);

    const handleSave = async () => {
        if (!currentAccount || !token) return;

        setIsSaving(true);
        setError(null);
        setSuccess(false);

        try {
            const res = await fetch(`/api/crawlers/block-page`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount.id,
                },
                body: JSON.stringify({ html: html || null }),
            });

            if (!res.ok) throw new Error('Failed to save block page');

            setSavedHtml(html);
            setSuccess(true);
            setTimeout(() => setSuccess(false), 3000);
        } catch (err) {
            Logger.error('Failed to save block page template', { error: err });
            setError('Failed to save template');
        } finally {
            setIsSaving(false);
        }
    };

    const handleReset = () => {
        setHtml(DEFAULT_TEMPLATE);
    };

    const hasChanges = html !== savedHtml;

    /** Replace placeholders with example values for preview */
    const previewHtml = html
        .replace(/\{\{site_name\}\}/g, currentAccount?.name || 'My Store')
        .replace(/\{\{contact_email\}\}/g, 'admin@example.com')
        .replace(/\{\{crawler_name\}\}/g, 'semrushbot');

    if (!currentAccount) return null;

    return (
        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-gray-200 dark:border-slate-700 overflow-hidden">
            {/* Header */}
            <div className="p-6 border-b border-gray-200 dark:border-slate-700">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-orange-100 dark:bg-orange-500/20 rounded-lg">
                        <FileText className="w-5 h-5 text-orange-600 dark:text-orange-400" />
                    </div>
                    <div className="flex-1">
                        <h2 className="text-lg font-medium text-gray-900 dark:text-white">Block Page Template</h2>
                        <p className="text-sm text-gray-500 dark:text-slate-400 mt-0.5">
                            Customize what blocked bots see. Leave empty to use the default page.
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setShowPreview(!showPreview)}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-gray-600 dark:text-slate-300 bg-gray-100 dark:bg-slate-700 hover:bg-gray-200 dark:hover:bg-slate-600 transition-colors"
                        >
                            {showPreview ? <EyeOff size={14} /> : <Eye size={14} />}
                            {showPreview ? 'Editor' : 'Preview'}
                        </button>
                    </div>
                </div>
            </div>

            <div className="p-6 space-y-4">
                {/* Error / Success */}
                {error && (
                    <div className="p-3 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-lg text-red-700 dark:text-red-400 text-sm">
                        {error}
                    </div>
                )}
                {success && (
                    <div className="p-3 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 rounded-lg text-emerald-700 dark:text-emerald-400 text-sm">
                        ✓ Block page template saved. Changes will sync to your store within 1 hour.
                    </div>
                )}

                {/* Placeholder Reference */}
                <div className="p-3 bg-blue-50 dark:bg-blue-500/10 rounded-lg border border-blue-100 dark:border-blue-500/20">
                    <p className="text-xs font-medium text-blue-700 dark:text-blue-300 mb-1.5">Available Placeholders</p>
                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                        {PLACEHOLDERS.map(p => (
                            <span key={p.tag} className="text-xs text-blue-600 dark:text-blue-400">
                                <code className="px-1 py-0.5 bg-blue-100 dark:bg-blue-500/20 rounded font-mono">{p.tag}</code>
                                <span className="text-blue-500 dark:text-blue-500 ml-1">{p.description}</span>
                            </span>
                        ))}
                    </div>
                </div>

                {isLoading ? (
                    <div className="p-12 text-center text-gray-500 dark:text-slate-400">
                        <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
                        Loading template...
                    </div>
                ) : showPreview ? (
                    /* Preview Mode */
                    <div className="border border-gray-200 dark:border-slate-700 rounded-lg overflow-hidden">
                        <div className="bg-gray-50 dark:bg-slate-800/50 px-4 py-2 border-b border-gray-200 dark:border-slate-700">
                            <span className="text-xs text-gray-500 dark:text-slate-400">Live Preview (placeholders replaced with example data)</span>
                        </div>
                        <iframe
                            srcDoc={previewHtml || DEFAULT_TEMPLATE.replace(/\{\{site_name\}\}/g, currentAccount.name || 'My Store').replace(/\{\{contact_email\}\}/g, 'admin@example.com').replace(/\{\{crawler_name\}\}/g, 'semrushbot')}
                            className="w-full h-80 bg-white"
                            sandbox="allow-same-origin"
                            title="Block page preview"
                        />
                    </div>
                ) : (
                    /* Editor Mode */
                    <textarea
                        value={html}
                        onChange={e => setHtml(e.target.value)}
                        placeholder="Paste your custom HTML here, or click 'Reset to Default' for a starter template..."
                        rows={14}
                        className="w-full px-4 py-3 border border-gray-300 dark:border-slate-600 rounded-lg font-mono text-sm bg-gray-50 dark:bg-slate-900 text-gray-800 dark:text-slate-200 focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 outline-none resize-y"
                    />
                )}

                {/* Actions */}
                <div className="flex items-center gap-3">
                    <button
                        onClick={handleSave}
                        disabled={isSaving || !hasChanges}
                        className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors font-medium disabled:opacity-50 text-sm"
                    >
                        {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                        Save Template
                    </button>
                    <button
                        onClick={handleReset}
                        className="flex items-center gap-2 bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-slate-300 px-4 py-2 rounded-lg hover:bg-gray-200 dark:hover:bg-slate-600 transition-colors font-medium text-sm"
                    >
                        <RotateCcw size={16} />
                        Reset to Default
                    </button>
                </div>
            </div>
        </div>
    );
}
