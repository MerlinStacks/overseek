import * as React from 'react';
import type { PresenceUser } from '../../hooks/useCollaboration';

interface PresenceAvatarsProps {
    users: PresenceUser[];
    currentUserId?: string; // To optionally exclude self or highlight self
}

export const PresenceAvatars: React.FC<PresenceAvatarsProps> = ({ users, currentUserId }) => {
    // Multiple tabs can create several socket entries for the same editor.
    const uniqueUsers = Array.from(new Map(users.map(u => [u.userId, u])).values());

    if (uniqueUsers.length === 0) return null;

    return (
        <div role="group" aria-label="Editors present" className="flex -space-x-2 items-center mr-4">
            {uniqueUsers.map((user) => {
                const name = user.name?.trim() || 'Unknown editor';
                const label = `${name}${user.userId === currentUserId ? ' (You)' : ''}`;
                return (
                    <div
                        key={user.userId}
                        className="relative inline-block group"
                    >
                        <div
                            role="img" aria-label={label} tabIndex={0} title={label}
                            className="h-8 w-8 rounded-full ring-2 ring-background flex items-center justify-center text-xs font-medium text-white select-none cursor-help"
                            style={{
                                backgroundColor: user.color || '#3B82F6',
                                backgroundImage: user.avatarUrl ? `url(${user.avatarUrl})` : 'none',
                                backgroundSize: 'cover'
                            }}
                        >
                            {!user.avatarUrl && (
                                <span aria-hidden="true">{name.charAt(0).toUpperCase()}</span>
                            )}
                        </div>

                        {/* The avatar's accessible name already provides this information. */}
                        <div aria-hidden="true" className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 hidden group-hover:block group-focus-within:block z-50 whitespace-nowrap pointer-events-none">
                            <div className="bg-gray-900 text-white text-xs rounded-sm py-1 px-2 shadow-lg">
                                {label}
                            </div>
                        </div>
                    </div>
                );
            })}
            {users.length > 0 && (
                <div className="ml-2 text-xs text-muted-foreground hidden lg:block">
                    {uniqueUsers.length > 1 ? `${uniqueUsers.length} editors` : '1 editor'}
                </div>
            )}
        </div>
    );
};
