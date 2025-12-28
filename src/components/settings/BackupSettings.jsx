import React, { useState } from 'react';
import { Save, RefreshCw, Database, Check, X } from 'lucide-react';
import { toast } from 'sonner';
import { exportDatabase, importDatabase, getBackupDryRun } from '../../services/backupService';

const BackupSettings = () => {
    const [importing, setImporting] = useState(false);
    const [dryRunData, setDryRunData] = useState(null);
    const [showConfirm, setShowConfirm] = useState(false);
    const [selectedFile, setSelectedFile] = useState(null);

    const handleExport = async () => {
        try {
            await exportDatabase();
            toast.success("Backup downloaded successfully");
        } catch (e) {
            toast.error("Export failed");
        }
    };

    const handleFileSelect = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        // Reset file input so same file can be selected again if cancelled
        e.target.value = null;

        const toastId = toast.loading("Analyzing backup file...");
        try {
            const summary = await getBackupDryRun(file);
            setDryRunData(summary);
            setSelectedFile(file);
            setShowConfirm(true);
            toast.dismiss(toastId);
        } catch (err) {
            console.error(err);
            toast.dismiss(toastId);
            toast.error("Invalid backup file: " + err.message);
        }
    };

    const confirmRestore = async () => {
        if (!selectedFile) return;

        setImporting(true);
        const toastId = toast.loading("Restoring data...");
        try {
            await importDatabase(selectedFile);
            toast.dismiss(toastId);
            toast.success("Restore complete! Reloading...");
            setTimeout(() => window.location.reload(), 1500);
        } catch (e) {
            console.error(e);
            toast.dismiss(toastId);
            toast.error("Restore failed: " + e.message);
            setImporting(false);
            setShowConfirm(false);
        }
    };

    const closeConfirm = () => {
        setShowConfirm(false);
        setDryRunData(null);
        setSelectedFile(null);
    };

    return (
        <div>
            <h2 className="section-title mb-6">Backup & Restore</h2>
            <div className="glass-card" style={{ padding: '24px' }}>
                <p style={{ marginBottom: '24px', lineHeight: '1.6', color: 'var(--text-secondary)' }}>
                    Export your local dashboard configuration (Settings, Automations, Segments, Notes).
                    <strong> This does not include synced product/order data</strong>, which will be re-synced from your store.
                </p>

                <div style={{ display: 'grid', gap: '24px', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)' }}>
                    <div style={{ background: 'rgba(255,255,255,0.03)', padding: '20px', borderRadius: '12px', border: '1px solid var(--border-glass)' }}>
                        <h3 style={{ fontSize: '1.1rem', fontWeight: 'bold', marginBottom: '12px' }}>Export Backup</h3>
                        <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '16px' }}>
                            Download a JSON file containing all your custom rules and settings.
                        </p>
                        <button onClick={handleExport} className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }}>
                            <Save size={16} /> Download Backup
                        </button>
                    </div>

                    <div style={{ background: 'rgba(255,255,255,0.03)', padding: '20px', borderRadius: '12px', border: '1px solid var(--border-glass)' }}>
                        <h3 style={{ fontSize: '1.1rem', fontWeight: 'bold', marginBottom: '12px' }}>Restore Backup</h3>
                        <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '16px' }}>
                            Restore a previously saved JSON backup file.
                        </p>
                        <label className={`btn ${importing ? 'disabled' : ''}`} style={{ width: '100%', justifyContent: 'center', cursor: 'pointer', background: 'var(--primary)', color: 'white', border: 'none' }}>
                            {importing ? <RefreshCw className="animate-spin" size={16} /> : <Database size={16} />}
                            {importing ? ' Restoring...' : ' Select File to Restore'}
                            <input
                                type="file"
                                accept=".json"
                                onChange={handleFileSelect}
                                style={{ display: 'none' }}
                                disabled={importing}
                            />
                        </label>
                    </div>
                </div>
            </div>

            {/* Dry Run Confirmation Modal */}
            {showConfirm && dryRunData && (
                <div className="modal-overlay" style={{ animation: 'fadeIn 0.2s', position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div className="modal-content glass-panel" style={{ maxWidth: '600px', width: '90%', background: '#1e293b', border: '1px solid var(--border-glass)', borderRadius: '12px', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)' }}>
                        <div className="modal-header" style={{ padding: '20px', borderBottom: '1px solid var(--border-glass)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <h3 style={{ fontSize: '1.2rem', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '10px' }}>
                                <Database size={20} color="#f59e0b" /> Confirm Restore
                            </h3>
                            <button onClick={closeConfirm} className="btn-icon" style={{ background: 'transparent', border: 'none', color: 'white' }}><X size={20} /></button>
                        </div>

                        <div className="modal-body" style={{ padding: '20px' }}>
                            <div className="warning-box" style={{ background: 'rgba(245, 158, 11, 0.1)', border: '1px solid rgba(245, 158, 11, 0.2)', color: '#f59e0b', padding: '15px', borderRadius: '8px', marginBottom: '20px' }}>
                                <strong>Warning:</strong> This action will <u>overwrite</u> existing data in the tables listed below. Current session data will be lost.
                            </div>

                            <div style={{ marginBottom: '20px' }}>
                                <h4 style={{ fontSize: '0.9rem', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '10px' }}>Tables to be updated</h4>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '8px', maxHeight: '200px', overflowY: 'auto' }}>
                                    {Object.entries(dryRunData.tables).map(([table, count]) => (
                                        <div key={table} style={{ padding: '8px 12px', background: 'rgba(255,255,255,0.05)', borderRadius: '6px', fontSize: '0.9rem', display: 'flex', justifyContent: 'space-between' }}>
                                            <span style={{ textTransform: 'capitalize' }}>{table.replace(/_/g, ' ')}</span>
                                            <span style={{ fontFamily: 'monospace', fontWeight: 'bold' }}>{count} records</span>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {dryRunData.warnings.length > 0 && (
                                <div style={{ marginBottom: '20px' }}>
                                    <h4 style={{ fontSize: '0.9rem', textTransform: 'uppercase', color: '#ef4444', marginBottom: '10px' }}>Warnings</h4>
                                    <div style={{ background: 'rgba(239, 68, 68, 0.1)', padding: '10px', borderRadius: '6px' }}>
                                        <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '0.85rem', color: '#f87171' }}>
                                            {dryRunData.warnings.map((w, i) => <li key={i}>{w}</li>)}
                                        </ul>
                                    </div>
                                </div>
                            )}

                            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', textAlign: 'center' }}>
                                Backup Timestamp: {new Date(dryRunData.meta.timestamp).toLocaleString()}
                            </div>
                        </div>

                        <div className="modal-actions" style={{ padding: '20px', borderTop: '1px solid var(--border-glass)', display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                            <button onClick={closeConfirm} className="btn" disabled={importing}>Cancel</button>
                            <button
                                onClick={confirmRestore}
                                className="btn btn-primary"
                                disabled={importing}
                                style={{ background: '#f59e0b', borderColor: '#f59e0b', color: 'black' }}
                            >
                                {importing ? 'Restoring...' : 'Yes, Overwrite & Restore'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default BackupSettings;
