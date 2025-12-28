import React from 'react';
import { useSync } from '../context/SyncContext';
import { Loader2, XCircle, CheckCircle, PauseCircle, PlayCircle } from 'lucide-react';

const SyncOverlay = () => {
    const { status, progress, task, cancelSync, pauseSync, resumeSync } = useSync();

    if (status === 'idle' || status === 'complete') return null;

    // Optional: Handle error state in overlay or just let it close and show toast?
    // If error, we might want to show it here too until dismissed.
    // For now, let's focus on "running" and "paused".

    // If error, we can show a red state
    if (status === 'error') {
        // Maybe auto-close or strictly explicit close?
        // Let's rely on the context auto-reset or manual reset.
        // For now, let's show an error overlay that requires a click to dismiss?
        // Actually context sets logs, maybe we just show a toast in context. 
        // Let's hide overlay on error to not block UI.
        return null;
    }

    return (
        <div style={{
            position: 'fixed',
            bottom: '20px',
            right: '20px',
            width: '350px',
            background: 'var(--bg-panel)',
            border: '1px solid var(--border-glass)',
            backdropFilter: 'blur(20px)',
            borderRadius: '12px',
            padding: '1.25rem',
            zIndex: 9999, // High z-index but not covering EVERYTHING (modal style) -> User asked for "Background" but "Overlay"? 
            // "Sync All from settings to run in background AND have overlay to show status"
            // Usually means a toast-like persistent widget, not a full screen blocker.
            // Let's make it a nice floating widget in the corner.
            boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
            animation: 'slideUp 0.3s ease-out'
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {status === 'running' && <Loader2 size={18} className="spin" color="var(--primary)" />}
                    {status === 'paused' && <PauseCircle size={18} color="var(--warning)" />}
                    <h4 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 600 }}>
                        {status === 'paused' ? 'Sync Paused' : 'Syncing Data...'}
                    </h4>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                    {status === 'running' ? (
                        <button onClick={pauseSync} className="btn-icon" title="Pause">
                            <PauseCircle size={18} />
                        </button>
                    ) : (
                        <button onClick={resumeSync} className="btn-icon" title="Resume">
                            <PlayCircle size={18} />
                        </button>
                    )}
                    <button onClick={cancelSync} className="btn-icon" title="Cancel" style={{ color: '#ef4444' }}>
                        <XCircle size={18} />
                    </button>
                </div>
            </div>

            <div style={{ marginBottom: '8px', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                {task || 'Preparing...'}
            </div>

            {/* Progress Bar */}
            <div style={{
                height: '6px',
                width: '100%',
                background: 'rgba(255,255,255,0.1)',
                borderRadius: '3px',
                overflow: 'hidden'
            }}>
                <div style={{
                    height: '100%',
                    width: `${progress}%`,
                    background: 'var(--primary)', // Gradient? 'linear-gradient(90deg, #6366f1, #8b5cf6)'
                    backgroundImage: 'linear-gradient(90deg, #6366f1, #8b5cf6)',
                    transition: 'width 0.3s ease'
                }} />
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '6px', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                <span>{Math.round(progress)}% Complete</span>
            </div>

            <style>{`
                @keyframes slideUp {
                    from { transform: translateY(20px); opacity: 0; }
                    to { transform: translateY(0); opacity: 1; }
                }
            `}</style>
        </div>
    );
};

export default SyncOverlay;
