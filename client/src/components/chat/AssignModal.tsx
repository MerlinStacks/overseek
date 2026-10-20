import { useState, useEffect, useRef } from 'react';
import { Logger } from '../../utils/logger';
import { Users, Check } from 'lucide-react';
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
export function AssignModal(props: AssignModalProps) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    if (!props.isOpen) return null;
    if (!token || !currentAccount) return <Modal isOpen onClose={props.onClose} title="Assign Conversation"><p role="alert">Authentication and an account are required.</p></Modal>;
    return <AssignModalContent key={JSON.stringify([currentAccount.id, token])} {...props} token={token} accountId={currentAccount.id} />;
}

function AssignModalContent({ isOpen, onClose, onAssign, currentAssigneeId, token, accountId }: AssignModalProps & { token: string; accountId: string }) {
    const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isAssigning, setIsAssigning] = useState(false);
    const [loadError, setLoadError] = useState(false);
    const [assignError, setAssignError] = useState(false);
    const [retry, setRetry] = useState(0);
    const active = useRef(true);
    const pending = useRef(false);

    useEffect(() => {
        const controller = new AbortController();
        active.current = true;

        const fetchTeamMembers = async () => {
            setIsLoading(true);
            try {
                const res = await fetch(`/api/account/${accountId}/users`, {
                    signal: controller.signal,
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'x-account-id': accountId
                    }
                });
                if (!res.ok) throw new Error('Failed to load team');
                const data: unknown = await res.json();
                if (!Array.isArray(data) || !data.every(member => member && typeof member.id === 'string' && typeof member.email === 'string' && (member.fullName == null || typeof member.fullName === 'string'))) throw new Error('Invalid team response');
                if (!controller.signal.aborted) { setTeamMembers(data); setLoadError(false); }
            } catch (error) {
                if (controller.signal.aborted) return;
                setLoadError(true);
                Logger.error('Failed to fetch team members:', { error: error });
            } finally {
                if (!controller.signal.aborted) setIsLoading(false);
            }
        };

        fetchTeamMembers();
        return () => { active.current = false; controller.abort(); };
    }, [token, accountId, retry]);

    const handleAssign = async (userId: string) => {
        if (pending.current) return;
        pending.current = true;
        setAssignError(false);
        setIsAssigning(true);
        try {
            await onAssign(userId);
            if (active.current) onClose();
        } catch {
            if (active.current) setAssignError(true);
        } finally {
            pending.current = false;
            if (active.current) setIsAssigning(false);
        }
    };

    const getInitials = (member: TeamMember) => {
        if (member.fullName) {
            return member.fullName.trim().split(/\s+/).map(n => n[0] || '').join('').toUpperCase().slice(0, 2) || member.email.charAt(0).toUpperCase();
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
            {assignError && <p role="alert" className="text-red-700 dark:text-red-300 mb-3">Could not assign this conversation. Please try again.</p>}
            {currentAssigneeId && <button type="button" disabled={isAssigning} onClick={() => void handleAssign('')} className="w-full p-3 text-left text-gray-700 dark:text-slate-200">Unassign</button>}
            <div className="max-h-80 overflow-y-auto -mx-6 px-6">
                {isLoading ? (
                    <div className="flex items-center justify-center py-8">
                        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
                    </div>
                ) : loadError ? (
                    <div><p role="alert">Could not load team members.</p><button type="button" onClick={() => { setIsLoading(true); setRetry(value => value + 1); }}>Retry loading team</button></div>
                ) : teamMembers.length === 0 ? (
                    <div className="text-center py-8 text-gray-500">
                        No team members found
                    </div>
                ) : (
                    <div className="space-y-1">
                        {teamMembers.map((member) => (
                            <button
                                type="button"
                                key={member.id}
                                onClick={() => handleAssign(member.id)}
                                disabled={isAssigning || member.id === currentAssigneeId}
                                className={cn(
                                    "w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors",
                                    "hover:bg-blue-50 dark:hover:bg-slate-700 text-left",
                                    member.id === currentAssigneeId && "bg-blue-50",
                                    isAssigning && "opacity-50 cursor-not-allowed"
                                )}
                            >
                                {member.avatarUrl ? (
                                    <img
                                        src={member.avatarUrl}
                                        alt=""
                                        className="w-9 h-9 rounded-full object-cover"
                                    />
                                ) : (
                                    <div aria-hidden="true" className="w-9 h-9 rounded-full bg-blue-600 flex items-center justify-center text-white text-sm font-medium">
                                        {getInitials(member)}
                                    </div>
                                )}
                                <div className="flex-1 min-w-0">
                                    <div className="font-medium text-gray-900 dark:text-slate-100 truncate">
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
                type="button"
                onClick={onClose}
                className="w-full px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors border-t border-gray-100 pt-3 mt-4"
            >
                Cancel
            </button>
        </Modal>
    );
}
