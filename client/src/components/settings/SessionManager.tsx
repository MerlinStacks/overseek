import React, { useState, useEffect } from 'react';
import { api } from '../../services/api';
import './SessionManager.css';

interface Session {
    id: string;
    createdAt: string;
    expiresAt: string;
    ipAddress: string | null;
    userAgent: string | null;
    isCurrent?: boolean;
}

export const SessionManager: React.FC = () => {
    const [sessions, setSessions] = useState<Session[]>([]);
    const [loading, setLoading] = useState(true);
    const [revoking, setRevoking] = useState<string | null>(null);

    const fetchSessions = async () => {
        try {
            setLoading(true);
            const data = await api.get<Session[]>('/api/sessions');
            setSessions(data);
        } catch (error) {
            console.error('Failed to fetch sessions:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchSessions();
    }, []);

    const revokeSession = async (id: string) => {
        if (!confirm('Are you sure you want to revoke this session?')) return;

        try {
            setRevoking(id);
            await api.delete(`/sessions/${id}`);
            setSessions(prev => prev.filter(s => s.id !== id));
        } catch (error) {
            console.error('Failed to revoke session:', error);
        } finally {
            setRevoking(null);
        }
    };

    const revokeAllSessions = async () => {
        if (!confirm('This will sign you out of all other devices. Continue?')) return;

        try {
            setRevoking('all');
            await api.delete('/sessions');
            await fetchSessions();
        } catch (error) {
            console.error('Failed to revoke sessions:', error);
        } finally {
            setRevoking(null);
        }
    };

    const formatDate = (dateStr: string) => {
        return new Date(dateStr).toLocaleString();
    };

    const parseUserAgent = (ua: string | null): string => {
        if (!ua) return 'Unknown Device';

        if (ua.includes('Chrome')) return 'Chrome Browser';
        if (ua.includes('Firefox')) return 'Firefox Browser';
        if (ua.includes('Safari')) return 'Safari Browser';
        if (ua.includes('Edge')) return 'Edge Browser';

        return 'Unknown Browser';
    };

    if (loading) {
        return <div className="session-manager loading">Loading sessions...</div>;
    }

    return (
        <div className="session-manager">
            <div className="session-header">
                <h3>Active Sessions</h3>
                {sessions.length > 1 && (
                    <button
                        className="btn-danger"
                        onClick={revokeAllSessions}
                        disabled={revoking === 'all'}
                    >
                        {revoking === 'all' ? 'Revoking...' : 'Revoke All Sessions'}
                    </button>
                )}
            </div>

            <p className="session-description">
                These are devices that are currently signed into your account.
                Revoke any sessions you don't recognize.
            </p>

            <div className="session-list">
                {sessions.length === 0 ? (
                    <div className="no-sessions">No active sessions found</div>
                ) : (
                    sessions.map(session => (
                        <div key={session.id} className="session-item">
                            <div className="session-info">
                                <div className="session-device">
                                    <span className="device-icon">💻</span>
                                    <span className="device-name">{parseUserAgent(session.userAgent)}</span>
                                </div>
                                <div className="session-details">
                                    <span className="session-ip">
                                        IP: {session.ipAddress || 'Unknown'}
                                    </span>
                                    <span className="session-date">
                                        Signed in: {formatDate(session.createdAt)}
                                    </span>
                                    <span className="session-expires">
                                        Expires: {formatDate(session.expiresAt)}
                                    </span>
                                </div>
                            </div>
                            <button
                                className="btn-revoke"
                                onClick={() => revokeSession(session.id)}
                                disabled={revoking === session.id}
                            >
                                {revoking === session.id ? 'Revoking...' : 'Revoke'}
                            </button>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
};

export default SessionManager;
