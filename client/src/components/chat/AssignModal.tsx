import { useState, useEffect } from 'react';
import { Logger } from '../../utils/logger';
import { Users, X, Check } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { cn } from '../../utils/cn';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';

interface TeamMember {
    id: string;
    fullName?: string;
    email: string;
    avatarUrl?: string;
}

interface AssignModalProps {
    isOpen: boolean;
    onClose: () => void;
    onAssign: (userId: string) => Promise<void>;
    currentAssigneeId?: string;
}

/**
 * Modal component for assigning a conversation to a team member.
 * Fetches available team members from the account and allows selection.
 */
export function AssignModal({ isOpen, onClose, onAssign, currentAssigneeId }: AssignModalProps) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isAssigning, setIsAssigning] = useState(false);

    useEffect(() => {
        if (!isOpen || !token || !currentAccount) return;

        const fetchTeamMembers = async () => {
            setIsLoading(true);
            try {
                const res = await fetch(`/api/account/${currentAccount.id}/users`, {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'x-account-id': currentAccount.id
                    }
                });
                if (res.ok) {
                    const data = await res.json();
                    setTeamMembers(data);
                }
            } catch (error) {
                Logger.error('Failed to fetch team members:', { error: error });
            } finally {
                setIsLoading(false);
            }
        };

        fetchTeamMembers();
    }, [isOpen, token, currentAccount]);

    const handleAssign = async (userId: string) => {
        setIsAssigning(true);
        try {
            await onAssign(userId);
            onClose();
        } finally {
            setIsAssigning(false);
        }
    };

    const getInitials = (member: TeamMember) => {
        if (member.fullName) {
            return member.fullName.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
        }
        return member.email.charAt(0).toUpperCase();
    };

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={
                <div className="flex items-center gap-2">
                    <Users size={18} className="text-blue-600" />
                    <span>Assign Conversation</span>
                </div>
            }
            maxWidth="max-w-sm"
        >
            <div className="max-h-80 overflow-y-auto -mx-6 px-6">
                {isLoading ? (
                    <div className="flex items-center justify-center py-8">
                        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
                    </div>
                ) : teamMembers.length === 0 ? (
                    <div className="text-center py-8 text-gray-500">
                        No team members found
                    </div>
                ) : (
                    <div className="space-y-1">
                        {/* Unassign option */}
                        {currentAssigneeId && (
                            <button
                                onClick={() => handleAssign('')}
                                disabled={isAssigning}
                                className={cn(
                                    "w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors",
                                    "hover:bg-gray-50 text-left",
                                    isAssigning && "opacity-50 cursor-not-allowed"
                                )}
                            >
                                <div className="w-9 h-9 rounded-full bg-gray-200 flex items-center justify-center text-gray-500">
                                    <X size={16} />
                                </div>
                                <div className="flex-1">
                                    <div className="font-medium text-gray-700">Unassign</div>
                                    <div className="text-xs text-gray-500">Remove current assignee</div>
                                </div>
                            </button>
                        )}

                        {teamMembers.map((member) => (
                            <button
                                key={member.id}
                                onClick={() => handleAssign(member.id)}
                                disabled={isAssigning || member.id === currentAssigneeId}
                                className={cn(
                                    "w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors",
                                    "hover:bg-blue-50 text-left",
                                    member.id === currentAssigneeId && "bg-blue-50",
                                    isAssigning && "opacity-50 cursor-not-allowed"
                                )}
                            >
                                {member.avatarUrl ? (
                                    <img
                                        src={member.avatarUrl}
                                        alt={member.fullName || member.email}
                                        className="w-9 h-9 rounded-full object-cover"
                                    />
                                ) : (
                                    <div className="w-9 h-9 rounded-full bg-blue-600 flex items-center justify-center text-white text-sm font-medium">
                                        {getInitials(member)}
                                    </div>
                                )}
                                <div className="flex-1 min-w-0">
                                    <div className="font-medium text-gray-900 truncate">
                                        {member.fullName || member.email}
                                    </div>
                                    {member.fullName && (
                                        <div className="text-xs text-gray-500 truncate">{member.email}</div>
                                    )}
                                </div>
                                {member.id === currentAssigneeId && (
                                    <Check size={16} className="text-blue-600" />
                                )}
                            </button>
                        ))}
                    </div>
                )}
            </div>

            <button
                onClick={onClose}
                className="w-full px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors border-t border-gray-100 pt-3 mt-4"
            >
                Cancel
            </button>
        </Modal>
    );
}
