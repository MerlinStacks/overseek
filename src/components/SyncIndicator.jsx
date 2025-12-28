import React, { useEffect, useState } from 'react';
import { useSync } from '../context/SyncContext';
import { RefreshCw, Wifi, WifiOff, CheckCircle2 } from 'lucide-react';

const SyncIndicator = () => {
    const { status, lastLiveSync, startSync } = useSync();
    const [timeAgo, setTimeAgo] = useState(0);

    useEffect(() => {
        const interval = setInterval(() => {
            if (lastLiveSync) {
                const diff = Math.floor((new Date() - new Date(lastLiveSync)) / 1000);
                setTimeAgo(diff);
            }
        }, 1000);
        return () => clearInterval(interval);
    }, [lastLiveSync]);

    // Derived State
    const isRunning = status === 'running';
    const isLive = lastLiveSync && timeAgo < 45; // Considered live if synced in last 45s (polling is 10s)

    // Status text
    let statusText = "Offline";
    let statusColor = "var(--text-muted)";
    let Icon = WifiOff;

    if (isRunning) {
        statusText = "Syncing...";
        statusColor = "var(--primary)";
        Icon = RefreshCw;
    } else if (isLive) {
        statusText = "Live";
        statusColor = "var(--success)";
        Icon = Wifi;
    } else if (lastLiveSync) {
        statusText = `Stale (${timeAgo}s ago)`;
        statusColor = "#f59e0b"; // Amber
        Icon = Wifi;
    }

    return (
        <div
            className="glass-panel"
            style={{
                padding: '6px 12px',
                borderRadius: '20px',
                display: 'flex',
                gap: '8px',
                alignItems: 'center',
                border: `1px solid ${status === 'error' ? '#ef4444' : 'rgba(255,255,255,0.1)'}`,
                cursor: 'pointer',
                transition: 'all 0.2s'
            }}
            onClick={() => !isRunning && startSync(false)}
            title={isRunning ? "Sync in progress..." : "Click to force sync"}
        >
            <div style={{ position: 'relative', display: 'flex' }}>
                <Icon
                    size={16}
                    color={status === 'error' ? '#ef4444' : statusColor}
                    className={isRunning ? "spin-animate" : ""}
                />
                {!isRunning && isLive && (
                    <span
                        className="pulse-green"
                        style={{
                            position: 'absolute',
                            top: -2,
                            right: -2,
                            width: '6px',
                            height: '6px',
                            background: 'var(--success)',
                            borderRadius: '50%',
                        }}
                    />
                )}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1 }}>
                <span style={{ fontSize: '0.75rem', fontWeight: '600', color: 'var(--text-main)' }}>
                    {status === 'error' ? 'Sync Error' : statusText}
                </span>
                {!isRunning && isLive && (
                    <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                        Optimized
                    </span>
                )}
            </div>
        </div>
    );
};

export default SyncIndicator;
