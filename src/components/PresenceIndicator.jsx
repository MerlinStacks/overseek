import React from 'react';
import { usePresence } from '../context/PresenceContext';

const PresenceIndicator = () => {
    const { activeUsers } = usePresence();

    if (activeUsers.length === 0) return null;

    return (
        <div style={{ display: 'flex', alignItems: 'center', marginLeft: '16px' }}>
            <div style={{ display: 'flex', flexDirection: 'row-reverse' }}>
                {activeUsers.map((user, i) => (
                    <div
                        key={user.socketId}
                        title={`${user.user} is viewing this page`}
                        style={{
                            width: '28px',
                            height: '28px',
                            borderRadius: '50%',
                            background: user.color,
                            border: '2px solid #1f2937',
                            marginLeft: '-10px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '10px',
                            fontWeight: 'bold',
                            color: '#1f2937',
                            cursor: 'pointer'
                        }}
                    >
                        {user.user.charAt(0)}
                    </div>
                ))}
            </div>
            {activeUsers.length > 0 && (
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: '8px' }}>
                    {activeUsers.length} active
                </span>
            )}
        </div>
    );
};

export default PresenceIndicator;
