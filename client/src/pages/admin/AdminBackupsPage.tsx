import { useEffect, useState } from 'react';
import { Logger } from '../../utils/logger';
import { useAuth } from '../../context/AuthContext';
import {
    Download, HardDrive, Loader2, RefreshCw, Database, FileJson,
    Clock, Trash2, RotateCcw, Save, Calendar, AlertTriangle, X, Settings
} from 'lucide-react';
import { cn } from '../../utils/cn';

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

const FREQUENCY_LABELS: Record<string, string> = {
    DAILY: 'Daily',
    EVERY_3_DAYS: 'Every 3 Days',
    WEEKLY: 'Weekly',
};

export function AdminBackupsPage() {
    const { token } = useAuth();
    const [accounts, setAccounts] = useState<Account[]>([]);
    const [selectedAccountId, setSelectedAccountId] = useState<string>('');
    const [preview, setPreview] = useState<BackupPreview | null>(null);
    const [settings, setSettings] = useState<BackupSettings | null>(null);
    const [storedBackups, setStoredBackups] = useState<StoredBackup[]>([]);
    const [loading, setLoading] = useState(true);
    const [previewLoading, setPreviewLoading] = useState(false);
    const [savingBackup, setSavingBackup] = useState(false);
    const [downloading, setDownloading] = useState(false);
    const [savingSettings, setSavingSettings] = useState(false);

    // Restore modal state
    const [restoreTarget, setRestoreTarget] = useState<StoredBackup | null>(null);
    const [confirmName, setConfirmName] = useState('');
    const [restoring, setRestoring] = useState(false);

    // Options
    const [includeAuditLogs, setIncludeAuditLogs] = useState(false);
    const [includeAnalytics, setIncludeAnalytics] = useState(false);

    useEffect(() => {
        fetchAccounts();
    }, [token]);

    const fetchAccounts = async () => {
        try {
            const res = await fetch('/api/admin/accounts', {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (!res.ok) throw new Error('Failed to fetch accounts');
            const data = await res.json();
            setAccounts(data);
        } catch (err) {
            Logger.error('AdminBackupsPage fetch error:', { error: err });
        } finally {
            setLoading(false);
        }
    };

    const fetchPreview = async (accountId: string) => {
        if (!accountId) {
            setPreview(null);
            return;
        }

        setPreviewLoading(true);
        try {
            const res = await fetch(`/api/admin/accounts/${accountId}/backup/preview`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (!res.ok) throw new Error('Failed to fetch preview');
            const data = await res.json();
            setPreview(data);
        } catch (err) {
            Logger.error('Backup preview error:', { error: err });
            setPreview(null);
        } finally {
            setPreviewLoading(false);
        }
    };

    const fetchSettings = async (accountId: string) => {
        try {
            const res = await fetch(`/api/admin/accounts/${accountId}/backup/settings`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (res.ok) {
                const data = await res.json();
                setSettings(data);
            }
        } catch (err) {
            Logger.error('Settings fetch error:', { error: err });
        }
    };

    const fetchStoredBackups = async (accountId: string) => {
        try {
            const res = await fetch(`/api/admin/accounts/${accountId}/backups`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (res.ok) {
                const data = await res.json();
                setStoredBackups(data);
            }
        } catch (err) {
            Logger.error('Stored backups fetch error:', { error: err });
        }
    };

    const handleAccountChange = (accountId: string) => {
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
    };

    const handleSaveBackup = async () => {
        if (!selectedAccountId) return;

        setSavingBackup(true);
        try {
            const res = await fetch(`/api/admin/accounts/${selectedAccountId}/backup/save`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({ includeAuditLogs, includeAnalytics })
            });

            if (!res.ok) throw new Error('Failed to save backup');

            // Refresh stored backups
            await fetchStoredBackups(selectedAccountId);
        } catch (err: any) {
            Logger.error('Backup save error:', { error: err });
            alert('Backup failed: ' + err.message);
        } finally {
            setSavingBackup(false);
        }
    };

    const handleDownloadBackup = async () => {
        if (!selectedAccountId) return;

        setDownloading(true);
        try {
            const res = await fetch(`/api/admin/accounts/${selectedAccountId}/backup`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({ includeAuditLogs, includeAnalytics })
            });

            if (!res.ok) throw new Error('Failed to generate backup');

            const contentDisposition = res.headers.get('Content-Disposition');
            let filename = `backup_${new Date().toISOString().split('T')[0]}.json`;
            if (contentDisposition) {
                const match = contentDisposition.match(/filename="(.+)"/);
                if (match) filename = match[1];
            }

            const blob = await res.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(url);
        } catch (err: any) {
            Logger.error('Backup download error:', { error: err });
            alert('Backup failed: ' + err.message);
        } finally {
            setDownloading(false);
        }
    };

    const handleUpdateSettings = async (updates: Partial<BackupSettings>) => {
        if (!selectedAccountId) return;

        setSavingSettings(true);
        try {
            const res = await fetch(`/api/admin/accounts/${selectedAccountId}/backup/settings`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify(updates)
            });

            if (res.ok) {
                const data = await res.json();
                setSettings(data);
            }
        } catch (err) {
            Logger.error('Settings update error:', { error: err });
        } finally {
            setSavingSettings(false);
        }
    };

    const handleDeleteBackup = async (backupId: string) => {
        if (!confirm('Delete this backup?')) return;

        try {
            const res = await fetch(`/api/admin/backups/${backupId}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${token}` }
            });

            if (res.ok) {
                setStoredBackups(prev => prev.filter(b => b.id !== backupId));
            }
        } catch (err) {
            Logger.error('Delete backup error:', { error: err });
        }
    };

    const handleDownloadStored = async (backupId: string, filename: string) => {
        try {
            const res = await fetch(`/api/admin/backups/${backupId}/download`, {
                headers: { Authorization: `Bearer ${token}` }
            });

            if (!res.ok) throw new Error('Failed to download');

            const blob = await res.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(url);
        } catch (err) {
            Logger.error('Download error:', { error: err });
        }
    };

    const handleRestore = async () => {
        if (!restoreTarget || confirmName !== preview?.accountName) return;

        setRestoring(true);
        try {
            const res = await fetch(`/api/admin/backups/${restoreTarget.id}/restore`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({ confirmAccountName: confirmName })
            });

            const data = await res.json();
            if (res.ok) {
                alert(`Restored: ${data.restoredTables.join(', ')}`);
                setRestoreTarget(null);
                setConfirmName('');
            } else {
                alert('Restore failed: ' + data.error);
            }
        } catch (err: any) {
            alert('Restore failed: ' + err.message);
        } finally {
            setRestoring(false);
        }
    };

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
                                                                onClick={() => { setRestoreTarget(backup); setConfirmName(''); }}
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
                            {new Date(restoreTarget.createdAt).toLocaleString()}
                        </p>
                        <p className="text-sm text-slate-700 mb-4">
                            Type the account name to confirm: <strong>{preview.accountName}</strong>
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
                                onClick={() => { setRestoreTarget(null); setConfirmName(''); }}
                                className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleRestore}
                                disabled={confirmName !== preview.accountName || restoring}
                                className={cn(
                                    "px-4 py-2 text-sm font-medium rounded-lg",
                                    confirmName === preview.accountName && !restoring
                                        ? "bg-amber-600 text-white hover:bg-amber-700"
                                        : "bg-slate-200 text-slate-400 cursor-not-allowed"
                                )}
                            >
                                {restoring ? 'Restoring...' : 'Confirm Restore'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
