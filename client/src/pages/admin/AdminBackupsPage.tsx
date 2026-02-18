import { useEffect, useState, useCallback } from 'react';
import { Logger } from '../../utils/logger';
import { useAuth } from '../../context/AuthContext';
import {
    Download, HardDrive, Loader2, RefreshCw, Database, FileJson,
    Trash2, RotateCcw, Save, AlertTriangle, Settings
} from 'lucide-react';
import { cn } from '../../utils/cn';

// ─── Types ──────────────────────────────────────────────────────────

interface Account {
    id: string;
    name: string;
    domain: string | null;
    _count: { users: number };
}

interface BackupPreview {
    accountId: string;
    accountName: string;
    recordCounts: Record<string, number>;
    estimatedSizeKB: number;
}

interface BackupSettings {
    isEnabled: boolean;
    frequency: 'DAILY' | 'EVERY_3_DAYS' | 'WEEKLY';
    maxBackups: number;
    lastBackupAt: string | null;
    nextBackupAt: string | null;
}

interface StoredBackup {
    id: string;
    filename: string;
    sizeBytes: number;
    recordCount: number;
    status: string;
    type: string;
    createdAt: string;
}

// ─── Utilities ──────────────────────────────────────────────────────

/**
 * Trigger a browser file-download from a fetch Response.
 * Why extracted: the same blob→anchor→click→revoke dance was duplicated
 * in handleDownloadBackup and handleDownloadStored.
 */
function downloadBlob(blob: Blob, filename: string) {
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
}

/** Parse Content-Disposition header for a filename, with fallback. */
function parseFilename(response: Response, fallback: string): string {
    const header = response.headers.get('Content-Disposition');
    if (!header) return fallback;
    const match = header.match(/filename="(.+)"/);
    return match ? match[1] : fallback;
}

// ─── useBackups Hook ────────────────────────────────────────────────

/** Encapsulates all state + data-fetching for the backups page. */
function useBackups() {
    const { token } = useAuth();

    const [accounts, setAccounts] = useState<Account[]>([]);
    const [selectedAccountId, setSelectedAccountId] = useState('');
    const [preview, setPreview] = useState<BackupPreview | null>(null);
    const [settings, setSettings] = useState<BackupSettings | null>(null);
    const [storedBackups, setStoredBackups] = useState<StoredBackup[]>([]);

    const [loading, setLoading] = useState(true);
    const [previewLoading, setPreviewLoading] = useState(false);
    const [savingBackup, setSavingBackup] = useState(false);
    const [downloading, setDownloading] = useState(false);
    const [savingSettings, setSavingSettings] = useState(false);

    const [includeAuditLogs, setIncludeAuditLogs] = useState(false);
    const [includeAnalytics, setIncludeAnalytics] = useState(false);

    /** Shared auth headers to avoid repeating `Bearer ${token}` everywhere. */
    const authHeaders = { Authorization: `Bearer ${token}` };

    // ── Fetchers ──

    const fetchAccounts = useCallback(async () => {
        try {
            const res = await fetch('/api/admin/accounts', { headers: authHeaders });
            if (!res.ok) throw new Error('Failed to fetch accounts');
            setAccounts(await res.json());
        } catch (err) {
            Logger.error('AdminBackupsPage fetch error:', { error: err });
        } finally {
            setLoading(false);
        }
    }, [token]);

    const fetchPreview = useCallback(async (accountId: string) => {
        if (!accountId) { setPreview(null); return; }
        setPreviewLoading(true);
        try {
            const res = await fetch(`/api/admin/accounts/${accountId}/backup/preview`, { headers: authHeaders });
            if (!res.ok) throw new Error('Failed to fetch preview');
            setPreview(await res.json());
        } catch (err) {
            Logger.error('Backup preview error:', { error: err });
            setPreview(null);
        } finally {
            setPreviewLoading(false);
        }
    }, [token]);

    const fetchSettings = useCallback(async (accountId: string) => {
        try {
            const res = await fetch(`/api/admin/accounts/${accountId}/backup/settings`, { headers: authHeaders });
            if (res.ok) setSettings(await res.json());
        } catch (err) {
            Logger.error('Settings fetch error:', { error: err });
        }
    }, [token]);

    const fetchStoredBackups = useCallback(async (accountId: string) => {
        try {
            const res = await fetch(`/api/admin/accounts/${accountId}/backups`, { headers: authHeaders });
            if (res.ok) setStoredBackups(await res.json());
        } catch (err) {
            Logger.error('Stored backups fetch error:', { error: err });
        }
    }, [token]);

    // ── Actions ──

    const handleAccountChange = useCallback((accountId: string) => {
        setSelectedAccountId(accountId);
        setStoredBackups([]);
        setSettings(null);
        if (accountId) {
            fetchPreview(accountId);
            fetchSettings(accountId);
            fetchStoredBackups(accountId);
        } else {
            setPreview(null);
        }
    }, [fetchPreview, fetchSettings, fetchStoredBackups]);

    const handleSaveBackup = useCallback(async () => {
        if (!selectedAccountId) return;
        setSavingBackup(true);
        try {
            const res = await fetch(`/api/admin/accounts/${selectedAccountId}/backup/save`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...authHeaders },
                body: JSON.stringify({ includeAuditLogs, includeAnalytics })
            });
            if (!res.ok) throw new Error('Failed to save backup');
            await fetchStoredBackups(selectedAccountId);
        } catch (err: any) {
            Logger.error('Backup save error:', { error: err });
            alert('Backup failed: ' + err.message);
        } finally {
            setSavingBackup(false);
        }
    }, [selectedAccountId, includeAuditLogs, includeAnalytics, token, fetchStoredBackups]);

    const handleDownloadBackup = useCallback(async () => {
        if (!selectedAccountId) return;
        setDownloading(true);
        try {
            const res = await fetch(`/api/admin/accounts/${selectedAccountId}/backup`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...authHeaders },
                body: JSON.stringify({ includeAuditLogs, includeAnalytics })
            });
            if (!res.ok) throw new Error('Failed to generate backup');
            const fallback = `backup_${new Date().toISOString().split('T')[0]}.json`;
            downloadBlob(await res.blob(), parseFilename(res, fallback));
        } catch (err: any) {
            Logger.error('Backup download error:', { error: err });
            alert('Backup failed: ' + err.message);
        } finally {
            setDownloading(false);
        }
    }, [selectedAccountId, includeAuditLogs, includeAnalytics, token]);

    const handleDownloadStored = useCallback(async (backupId: string, filename: string) => {
        try {
            const res = await fetch(`/api/admin/backups/${backupId}/download`, { headers: authHeaders });
            if (!res.ok) throw new Error('Failed to download');
            downloadBlob(await res.blob(), filename);
        } catch (err) {
            Logger.error('Download error:', { error: err });
        }
    }, [token]);

    const handleDeleteBackup = useCallback(async (backupId: string) => {
        if (!confirm('Delete this backup?')) return;
        try {
            const res = await fetch(`/api/admin/backups/${backupId}`, {
                method: 'DELETE',
                headers: authHeaders
            });
            if (res.ok) setStoredBackups(prev => prev.filter(b => b.id !== backupId));
        } catch (err) {
            Logger.error('Delete backup error:', { error: err });
        }
    }, [token]);

    const handleUpdateSettings = useCallback(async (updates: Partial<BackupSettings>) => {
        if (!selectedAccountId) return;
        setSavingSettings(true);
        try {
            const res = await fetch(`/api/admin/accounts/${selectedAccountId}/backup/settings`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', ...authHeaders },
                body: JSON.stringify(updates)
            });
            if (res.ok) setSettings(await res.json());
        } catch (err) {
            Logger.error('Settings update error:', { error: err });
        } finally {
            setSavingSettings(false);
        }
    }, [selectedAccountId, token]);

    const handleRestore = useCallback(async (backupId: string, confirmName: string) => {
        try {
            const res = await fetch(`/api/admin/backups/${backupId}/restore`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...authHeaders },
                body: JSON.stringify({ confirmAccountName: confirmName })
            });
            const data = await res.json();
            if (res.ok) {
                alert(`Restored: ${data.restoredTables.join(', ')}`);
                return true;
            }
            alert('Restore failed: ' + data.error);
            return false;
        } catch (err: any) {
            alert('Restore failed: ' + err.message);
            return false;
        }
    }, [token]);

    useEffect(() => { fetchAccounts(); }, [fetchAccounts]);

    return {
        accounts, selectedAccountId, preview, settings, storedBackups,
        loading, previewLoading, savingBackup, downloading, savingSettings,
        includeAuditLogs, setIncludeAuditLogs, includeAnalytics, setIncludeAnalytics,
        handleAccountChange, handleSaveBackup, handleDownloadBackup,
        handleDownloadStored, handleDeleteBackup, handleUpdateSettings, handleRestore,
        fetchPreview,
    };
}

// ─── RestoreModal ───────────────────────────────────────────────────

interface RestoreModalProps {
    backup: StoredBackup;
    accountName: string;
    onClose: () => void;
    onRestore: (backupId: string, confirmName: string) => Promise<boolean>;
}

/** Dangerous-action confirmation modal for restoring a backup. */
function RestoreModal({ backup, accountName, onClose, onRestore }: RestoreModalProps) {
    const [confirmName, setConfirmName] = useState('');
    const [restoring, setRestoring] = useState(false);

    const handleConfirm = async () => {
        setRestoring(true);
        const ok = await onRestore(backup.id, confirmName);
        setRestoring(false);
        if (ok) onClose();
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs">
            <div className="bg-white/95 backdrop-blur-md rounded-2xl shadow-2xl border border-slate-200 p-6 w-full max-w-md mx-4">
                <div className="flex items-center gap-3 text-amber-600 mb-4">
                    <AlertTriangle className="w-6 h-6" />
                    <h2 className="text-lg font-bold text-slate-900">Restore Backup</h2>
                </div>
                <p className="text-sm text-slate-600 mb-3">
                    This will <strong className="text-red-600">replace existing data</strong> with the backup from:
                </p>
                <p className="text-sm font-mono bg-slate-100 rounded px-3 py-2 mb-4">
                    {new Date(backup.createdAt).toLocaleString()}
                </p>
                <p className="text-sm text-slate-700 mb-4">
                    Type the account name to confirm: <strong>{accountName}</strong>
                </p>
                <input
                    type="text"
                    value={confirmName}
                    onChange={(e) => setConfirmName(e.target.value)}
                    placeholder="Type account name"
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 mb-4"
                    autoFocus
                />
                <div className="flex justify-end gap-3">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleConfirm}
                        disabled={confirmName !== accountName || restoring}
                        className={cn(
                            "px-4 py-2 text-sm font-medium rounded-lg",
                            confirmName === accountName && !restoring
                                ? "bg-amber-600 text-white hover:bg-amber-700"
                                : "bg-slate-200 text-slate-400 cursor-not-allowed"
                        )}
                    >
                        {restoring ? 'Restoring...' : 'Confirm Restore'}
                    </button>
                </div>
            </div>
        </div>
    );
}

// ─── Page Component ─────────────────────────────────────────────────

export function AdminBackupsPage() {
    const {
        accounts, selectedAccountId, preview, settings, storedBackups,
        loading, previewLoading, savingBackup, downloading, savingSettings,
        includeAuditLogs, setIncludeAuditLogs, includeAnalytics, setIncludeAnalytics,
        handleAccountChange, handleSaveBackup, handleDownloadBackup,
        handleDownloadStored, handleDeleteBackup, handleUpdateSettings, handleRestore,
        fetchPreview,
    } = useBackups();

    const [restoreTarget, setRestoreTarget] = useState<StoredBackup | null>(null);

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
            </div>
        );
    }

    const totalRecords = preview
        ? Object.values(preview.recordCounts).reduce((a, b) => a + b, 0)
        : 0;

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg">
                        <HardDrive className="w-5 h-5 text-white" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-slate-800">Account Backups</h1>
                        <p className="text-sm text-slate-500">Manage backups with auto-scheduling and restore</p>
                    </div>
                </div>
            </div>

            <div className="bg-white rounded-xl shadow-xs border border-slate-200 p-6 space-y-6">
                {/* Account Selector */}
                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                        Select Account
                    </label>
                    <select
                        value={selectedAccountId}
                        onChange={(e) => handleAccountChange(e.target.value)}
                        className="w-full max-w-md px-4 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
                    >
                        <option value="">Choose an account...</option>
                        {accounts.map(acc => (
                            <option key={acc.id} value={acc.id}>
                                {acc.name} {acc.domain ? `(${acc.domain})` : ''}
                            </option>
                        ))}
                    </select>
                </div>

                {previewLoading && (
                    <div className="flex items-center gap-2 text-slate-500">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span className="text-sm">Loading...</span>
                    </div>
                )}

                {preview && !previewLoading && (
                    <>
                        {/* Schedule Settings */}
                        {settings && (
                            <div className="bg-slate-50 rounded-lg p-4 border border-slate-200">
                                <div className="flex items-center justify-between mb-4">
                                    <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                                        <Settings className="w-4 h-4 text-slate-400" />
                                        Auto-Backup Schedule
                                    </h3>
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={settings.isEnabled}
                                            onChange={(e) => handleUpdateSettings({ isEnabled: e.target.checked })}
                                            disabled={savingSettings}
                                            className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                        />
                                        <span className="text-sm text-slate-700">Enabled</span>
                                    </label>
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                    <div>
                                        <label className="block text-xs text-slate-500 mb-1">Frequency</label>
                                        <select
                                            value={settings.frequency}
                                            onChange={(e) => handleUpdateSettings({ frequency: e.target.value as any })}
                                            disabled={savingSettings}
                                            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
                                        >
                                            <option value="DAILY">Daily</option>
                                            <option value="EVERY_3_DAYS">Every 3 Days</option>
                                            <option value="WEEKLY">Weekly</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-xs text-slate-500 mb-1">Keep Last</label>
                                        <select
                                            value={settings.maxBackups}
                                            onChange={(e) => handleUpdateSettings({ maxBackups: parseInt(e.target.value) })}
                                            disabled={savingSettings}
                                            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
                                        >
                                            {[1, 2, 3, 4, 5, 7, 10].map(n => (
                                                <option key={n} value={n}>{n} backup{n > 1 ? 's' : ''}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-xs text-slate-500 mb-1">Next Backup</label>
                                        <div className="px-3 py-2 text-sm text-slate-600">
                                            {settings.nextBackupAt
                                                ? new Date(settings.nextBackupAt).toLocaleString()
                                                : settings.isEnabled ? 'Calculating...' : 'Disabled'
                                            }
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Stored Backups */}
                        {storedBackups.length > 0 && (
                            <div>
                                <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
                                    <Database className="w-4 h-4 text-slate-400" />
                                    Stored Backups ({storedBackups.length})
                                </h3>
                                <div className="border border-slate-200 rounded-lg overflow-hidden">
                                    <table className="w-full text-sm">
                                        <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
                                            <tr>
                                                <th className="px-4 py-2 text-left">Date</th>
                                                <th className="px-4 py-2 text-left">Type</th>
                                                <th className="px-4 py-2 text-right">Size</th>
                                                <th className="px-4 py-2 text-right">Records</th>
                                                <th className="px-4 py-2 text-right">Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100">
                                            {storedBackups.map(backup => (
                                                <tr key={backup.id} className="hover:bg-slate-50/50">
                                                    <td className="px-4 py-2 text-slate-700">
                                                        {new Date(backup.createdAt).toLocaleString()}
                                                    </td>
                                                    <td className="px-4 py-2">
                                                        <span className={cn(
                                                            "text-xs px-2 py-0.5 rounded-full",
                                                            backup.type === 'SCHEDULED'
                                                                ? "bg-blue-100 text-blue-700"
                                                                : "bg-slate-100 text-slate-700"
                                                        )}>
                                                            {backup.type}
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-2 text-right text-slate-500">
                                                        {(backup.sizeBytes / 1024).toFixed(0)} KB
                                                    </td>
                                                    <td className="px-4 py-2 text-right text-slate-500">
                                                        {backup.recordCount.toLocaleString()}
                                                    </td>
                                                    <td className="px-4 py-2 text-right">
                                                        <div className="flex items-center justify-end gap-1">
                                                            <button
                                                                onClick={() => handleDownloadStored(backup.id, backup.filename)}
                                                                className="p-1.5 hover:bg-slate-100 rounded text-slate-500 hover:text-slate-700"
                                                                title="Download"
                                                            >
                                                                <Download className="w-4 h-4" />
                                                            </button>
                                                            <button
                                                                onClick={() => setRestoreTarget(backup)}
                                                                className="p-1.5 hover:bg-amber-50 rounded text-slate-500 hover:text-amber-600"
                                                                title="Restore"
                                                            >
                                                                <RotateCcw className="w-4 h-4" />
                                                            </button>
                                                            <button
                                                                onClick={() => handleDeleteBackup(backup.id)}
                                                                className="p-1.5 hover:bg-red-50 rounded text-slate-500 hover:text-red-600"
                                                                title="Delete"
                                                            >
                                                                <Trash2 className="w-4 h-4" />
                                                            </button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}

                        {/* Preview Section */}
                        <div className="space-y-4">
                            <div className="flex items-center justify-between">
                                <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                                    <FileJson className="w-4 h-4 text-slate-400" />
                                    New Backup Preview
                                </h3>
                                <button
                                    onClick={() => fetchPreview(selectedAccountId)}
                                    className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1"
                                >
                                    <RefreshCw className="w-3.5 h-3.5" />
                                    Refresh
                                </button>
                            </div>

                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                                {Object.entries(preview.recordCounts)
                                    .filter(([, count]) => count > 0)
                                    .sort((a, b) => b[1] - a[1])
                                    .slice(0, 10)
                                    .map(([key, count]) => (
                                        <div
                                            key={key}
                                            className="bg-slate-50 rounded-lg p-3 border border-slate-100"
                                        >
                                            <div className="text-lg font-semibold text-slate-900">
                                                {count.toLocaleString()}
                                            </div>
                                            <div className="text-xs text-slate-500 capitalize">
                                                {key.replace(/([A-Z])/g, ' $1').trim()}
                                            </div>
                                        </div>
                                    ))}
                            </div>

                            <div className="flex items-center gap-4 text-sm text-slate-600">
                                <span className="flex items-center gap-1.5">
                                    <strong>{totalRecords.toLocaleString()}</strong> total records
                                </span>
                                <span>•</span>
                                <span>~{preview.estimatedSizeKB > 1024
                                    ? `${(preview.estimatedSizeKB / 1024).toFixed(1)} MB`
                                    : `${preview.estimatedSizeKB} KB`
                                } estimated</span>
                            </div>
                        </div>

                        {/* Options */}
                        <div className="space-y-3 pt-4 border-t border-slate-200">
                            <h4 className="text-sm font-semibold text-slate-700">Backup Options</h4>
                            <div className="flex gap-6">
                                <label className="flex items-center gap-2 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={includeAuditLogs}
                                        onChange={(e) => setIncludeAuditLogs(e.target.checked)}
                                        className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                    />
                                    <span className="text-sm text-slate-700">Include Audit Logs</span>
                                </label>
                                <label className="flex items-center gap-2 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={includeAnalytics}
                                        onChange={(e) => setIncludeAnalytics(e.target.checked)}
                                        className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                    />
                                    <span className="text-sm text-slate-700">Include Analytics</span>
                                </label>
                            </div>
                        </div>

                        {/* Action Buttons */}
                        <div className="flex gap-3 pt-4">
                            <button
                                onClick={handleSaveBackup}
                                disabled={savingBackup}
                                className={cn(
                                    "inline-flex items-center gap-2 px-5 py-2.5 rounded-lg font-medium text-sm transition-all shadow-sm",
                                    savingBackup
                                        ? "bg-slate-200 text-slate-400 cursor-not-allowed"
                                        : "bg-gradient-to-r from-blue-600 to-indigo-600 text-white hover:from-blue-700 hover:to-indigo-700"
                                )}
                            >
                                {savingBackup ? (
                                    <><Loader2 className="w-4 h-4 animate-spin" />Saving...</>
                                ) : (
                                    <><Save className="w-4 h-4" />Save to Storage</>
                                )}
                            </button>
                            <button
                                onClick={handleDownloadBackup}
                                disabled={downloading}
                                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg font-medium text-sm border border-slate-300 text-slate-700 hover:bg-slate-50"
                            >
                                {downloading ? (
                                    <><Loader2 className="w-4 h-4 animate-spin" />Generating...</>
                                ) : (
                                    <><Download className="w-4 h-4" />Download Now</>
                                )}
                            </button>
                        </div>
                    </>
                )}
            </div>

            {/* Restore Confirmation Modal */}
            {restoreTarget && preview && (
                <RestoreModal
                    backup={restoreTarget}
                    accountName={preview.accountName}
                    onClose={() => setRestoreTarget(null)}
                    onRestore={handleRestore}
                />
            )}
        </div>
    );
}
