import * as React from 'react';
import { PresenceUser } from '../../hooks/useCollaboration';

interface PresenceAvatarsProps {
    users: PresenceUser[];
    currentUserId?: string; // To optionally exclude self or highlight self
}

export const PresenceAvatars: React.FC<PresenceAvatarsProps> = ({ users, currentUserId }) => {
    // Deduplicate users if needed (socket implementation might return multiple sockets for same user if multiple tabs)
    // For now, let's just show them all or distinct by userId?
    // Distinct by userId is better for "who is here".

    const uniqueUsers = Array.from(new Map(users.map(u => [u.userId, u])).values());

    if (uniqueUsers.length === 0) return null;

    return (
        <div className="flex -space-x-2 overflow-hidden items-center mr-4">
            {uniqueUsers.map((user) => (
                <div
                    key={user.userId + user.connectedAt} // Fallback key
                    className="relative inline-block group"
                >
                    <div
                        className={`h-8 w-8 rounded-full ring-2 ring-background flex items-center justify-center text-xs font-medium text-white select-none cursor-help`}
                        style={{
                            backgroundColor: user.color || '#3B82F6',
                            backgroundImage: user.avatarUrl ? `url(${user.avatarUrl})` : 'none',
                            backgroundSize: 'cover'
                        }}
                    >
                        {!user.avatarUrl && (
                            <span>{user.name.charAt(0).toUpperCase()}</span>
                        )}
                    </div>

                    {/* Tooltip */}
                    <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 hidden group-hover:block z-50 whitespace-nowrap">
                        <div className="bg-gray-900 text-white text-xs rounded-sm py-1 px-2 shadow-lg">
                            {user.name} {user.userId === currentUserId ? '(You)' : ''}
                        </div>
                    </div>
                </div>
            ))}
            {users.length > 0 && (
                <div className="ml-2 text-xs text-muted-foreground hidden lg:block">
                    {uniqueUsers.length > 1 ? `${uniqueUsers.length} editors` : '1 editor'}
                </div>
            )}
        </div>
    );
};
