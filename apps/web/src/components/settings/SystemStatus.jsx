import React, { useEffect, useState } from 'react';
import { CheckCircle, XCircle, Activity, Database, Server, ExternalLink, RefreshCw } from 'lucide-react';
import { fetchSystemStatus } from '../../services/api';
import { useSync } from '../../context/SyncContext';
import { db } from '../../db/db';
import { toast } from 'sonner';

const SystemStatus = ({ settings }) => {
    const { status: syncStatus, lastLiveSync, progress, task } = useSync();

    const [pluginData, setPluginData] = useState(null);
    const [dbCounts, setDbCounts] = useState(null);
    const [loading, setLoading] = useState(false);
    const [connError, setConnError] = useState(null);

    const runDiagnostics = async () => {
        if (!settings.storeUrl || !settings.consumerKey) {
            setLoading(false);
            setConnError("API Connection Not Configured");
            return;
        }

        setLoading(true);
        setConnError(null);
        try {
            // 1. Check Local Database (Dexie)
            const counts = {
                products: await db.products.count(),
                orders: await db.orders.count(),
                customers: await db.customers.count(),
                visits: await db.visits.count()
            };
            setDbCounts(counts);

            // 2. Check Remote Connection & Plugin Health
            // Uses our failover-capable fetchSystemStatus
            const remoteStatus = await fetchSystemStatus(settings);

            if (remoteStatus) {
                setPluginData(remoteStatus);
            } else {
                // If returns null, it means all failover attempts failed (or 404s)
                throw new Error("Could not reach Helper Plugin (404/Network Error)");
            }

        } catch (e) {
            console.error("Diagnostic failed", e);
            setConnError(e.message || "Connection Failed");
            setPluginData(null);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        runDiagnostics();
    }, [settings.storeUrl]);

    const StatusRow = ({ icon: Icon, label, status, detail, error }) => (
        <div style={{ padding: '1rem', borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{
                    width: 36, height: 36, borderRadius: '50%',
                    background: status === 'ok' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: status === 'ok' ? '#10b981' : '#ef4444'
                }}>
                    <Icon size={18} />
                </div>
                <div>
                    <div style={{ fontWeight: 600 }}>{label}</div>
                    {error && <div style={{ fontSize: '0.8rem', color: '#ef4444' }}>{error}</div>}
                    {!error && detail && <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{detail}</div>}
                </div>
            </div>
            <div>
                {status === 'ok' ? (
                    <CheckCircle size={20} color="#10b981" />
                ) : (
                    <XCircle size={20} color="#ef4444" />
                )}
            </div>
        </div>
    );

    return (
        <div className="fade-in">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                <h2 className="section-title">System Health</h2>
                <button onClick={runDiagnostics} disabled={loading} className="btn" style={{ gap: '8px' }}>
                    <RefreshCw size={16} className={loading ? 'spin' : ''} />
                    Run Diagnostics
                </button>
            </div>

            <div className="glass-panel" style={{ padding: 0, overflow: 'hidden' }}>
                {/* 1. Dashboard Application Status */}
                <StatusRow
                    icon={Activity}
                    label="Dashboard Application"
                    status="ok"
                    detail={`Version 2.0.0 • React Environment`}
                />

                {/* 2. Remote Store Connection */}
                <StatusRow
                    icon={Server}
                    label="Store Connection"
                    status={connError ? 'error' : 'ok'}
                    error={connError}
                    detail={!connError ? `Connected to ${settings.storeUrl}` : null}
                />

                {/* 3. Helper Plugin Status */}
                <StatusRow
                    icon={Database}
                    label="Helper Plugin"
                    status={pluginData ? 'ok' : 'error'}
                    error={!pluginData && !loading ? "Plugin not detected or outdated" : null}
                    detail={pluginData ? `${pluginData.plugin_name} v${pluginData.version} (${pluginData.namespace})` : null}
                />

                {/* 4. Local Database */}
                <StatusRow
                    icon={Database}
                    label="Local Database (Dexie)"
                    status={dbCounts ? 'ok' : 'error'}
                    detail={dbCounts ? `${dbCounts.products} Products • ${dbCounts.orders} Orders • ${dbCounts.visits} Visits` : "Not initialized"}
                />

                {/* 5. Sync Engine */}
                <StatusRow
                    icon={RefreshCw}
                    label="Sync Engine"
                    status={syncStatus === 'error' ? 'error' : 'ok'}
                    detail={syncStatus === 'running' ? `Running... (${progress}%)` : `Idle (Last sync: ${lastLiveSync ? new Date(lastLiveSync).toLocaleTimeString() : 'Never'})`}
                />
            </div>

            {pluginData && (
                <div style={{ marginTop: '2rem' }}>
                    <h3 style={{ fontSize: '1rem', marginBottom: '1rem', fontWeight: 600 }}>Remote Environment</h3>
                    <div className="glass-panel" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
                        <div>
                            <div className="text-muted text-xs">WordPress Version</div>
                            <div className="font-mono">{pluginData.wp_version}</div>
                        </div>
                        <div>
                            <div className="text-muted text-xs">WooCommerce Version</div>
                            <div className="font-mono">{pluginData.wc_version}</div>
                        </div>
                        <div>
                            <div className="text-muted text-xs">PHP Version</div>
                            <div className="font-mono">{pluginData.php_version}</div>
                        </div>
                        <div>
                            <div className="text-muted text-xs">Server Software</div>
                            <div className="font-mono text-xs">{pluginData.server}</div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default SystemStatus;
