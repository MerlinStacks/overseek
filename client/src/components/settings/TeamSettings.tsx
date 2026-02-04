import { useState, useEffect } from 'react';
import { Logger } from '../../utils/logger';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { Trash2, UserPlus, Shield, User, Edit2, Check, X, ChevronDown } from 'lucide-react';

interface CustomRole {
    id: string;
    name: string;
    permissions: Record<string, boolean>;
}

interface Member {
    userId: string;
    role: 'OWNER' | 'ADMIN' | 'STAFF' | 'VIEWER';
    roleId: string | null;
    maxRole: CustomRole | null;
    user: {
        id: string;
        fullName: string;
        email: string;
        avatarUrl: string | null;
    };
}

const BASE_ROLES = [
    { value: 'OWNER', label: 'Owner', description: 'Full access, can transfer ownership' },
    { value: 'ADMIN', label: 'Admin', description: 'Full access, cannot transfer ownership' },
    { value: 'STAFF', label: 'Staff', description: 'Access based on custom role' },
    { value: 'VIEWER', label: 'Viewer', description: 'Read-only access' },
] as const;

/**
 * Team management component for Settings page.
 * Allows adding/removing/editing team members and managing roles.
 */
export function TeamSettings() {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [members, setMembers] = useState<Member[]>([]);
    const [customRoles, setCustomRoles] = useState<CustomRole[]>([]);
    const [email, setEmail] = useState('');
    const [role, setRole] = useState<string>('STAFF');
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState('');
    const [editingUserId, setEditingUserId] = useState<string | null>(null);
    const [editValues, setEditValues] = useState<{ role: string; roleId: string | null }>({ role: 'STAFF', roleId: null });
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        if (currentAccount && token) {
            fetchMembers();
            fetchCustomRoles();
        }
    }, [currentAccount, token]);

    const fetchMembers = async () => {
        try {
            const res = await fetch(`/api/accounts/${currentAccount?.id}/users`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (res.ok) setMembers(await res.json());
        } catch (e) {
            Logger.error('Failed to fetch members', { error: e });
        } finally {
            setIsLoading(false);
        }
    };

    const fetchCustomRoles = async () => {
        try {
            const res = await fetch('/api/roles', {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount?.id || ''
                }
            });
            if (res.ok) {
                const data = await res.json();
                setCustomRoles(data);
            }
        } catch (e) {
            Logger.error('Failed to fetch custom roles', { error: e });
        }
    };

    const handleInvite = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        if (!email) return;

        try {
            const res = await fetch(`/api/accounts/${currentAccount?.id}/users`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ email, role })
            });

            if (!res.ok) {
                let errorMessage = 'Failed to add user';
                try {
                    const data = await res.json();
                    errorMessage = data.error || errorMessage;
                } catch {
                    // Response body is not valid JSON, use status text
                    errorMessage = res.statusText || `Error ${res.status}`;
                }
                throw new Error(errorMessage);
            }

            setEmail('');
            fetchMembers();
        } catch (err: any) {
            setError(err.message);
        }
    };

    const handleRemove = async (userId: string) => {
        if (!confirm('Are you sure you want to remove this member?')) return;
        try {
            await fetch(`/api/accounts/${currentAccount?.id}/users/${userId}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${token}` }
            });
            fetchMembers();
        } catch (e) {
            Logger.error('Failed to remove member', { error: e });
        }
    };

    const startEdit = (member: Member) => {
        setEditingUserId(member.userId);
        setEditValues({ role: member.role, roleId: member.roleId });
    };

    const cancelEdit = () => {
        setEditingUserId(null);
        setEditValues({ role: 'STAFF', roleId: null });
    };

    const saveEdit = async (userId: string) => {
        setIsSaving(true);
        try {
            const res = await fetch(`/api/accounts/${currentAccount?.id}/users/${userId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({
                    role: editValues.role,
                    roleId: editValues.roleId
                })
            });

            if (!res.ok) {
                let errorMessage = 'Failed to update user';
                try {
                    const data = await res.json();
                    errorMessage = data.error || errorMessage;
                } catch {
                    // Response body is not valid JSON, use status text
                    errorMessage = res.statusText || `Error ${res.status}`;
                }
                throw new Error(errorMessage);
            }

            setEditingUserId(null);
            fetchMembers();
        } catch (err: any) {
            alert(err.message);
        } finally {
            setIsSaving(false);
        }
    };

    const getRoleBadgeClass = (role: string) => {
        switch (role) {
            case 'OWNER': return 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300';
            case 'ADMIN': return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300';
            case 'STAFF': return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300';
            case 'VIEWER': return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300';
            default: return 'bg-gray-100 text-gray-800';
        }
    };

    if (isLoading) return <div className="p-4 text-gray-500">Loading members...</div>;

    return (
        <div className="space-y-6">
            {/* Invite Card */}
            <div className="bg-white dark:bg-gray-800 p-6 rounded-xl border border-gray-200 dark:border-gray-700 shadow-xs">
                <h2 className="text-lg font-semibold mb-4 flex items-center gap-2 text-gray-900 dark:text-white">
                    <UserPlus size={20} className="text-blue-600" />
                    Add New Member
                </h2>
                <form onSubmit={handleInvite} className="flex flex-col sm:flex-row gap-4 items-start">
                    <div className="flex-1 w-full">
                        <input
                            type="email"
                            placeholder="Enter user email address"
                            className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-hidden dark:bg-gray-900 dark:border-gray-600 dark:text-white"
                            value={email}
                            onChange={e => setEmail(e.target.value)}
                        />
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">User must already be registered with this email.</p>
                        {error && <p className="text-xs text-red-500 mt-1 font-medium">{error}</p>}
                    </div>

                    <select
                        className="px-4 py-2 border rounded-lg bg-white dark:bg-gray-900 dark:border-gray-600 dark:text-white"
                        value={role}
                        onChange={e => setRole(e.target.value)}
                    >
                        <option value="STAFF">Staff</option>
                        <option value="ADMIN">Admin</option>
                        <option value="VIEWER">Viewer</option>
                    </select>

                    <button type="submit" className="px-6 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors whitespace-nowrap">
                        Add User
                    </button>
                </form>
            </div>

            {/* Members List */}
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-xs overflow-hidden">
                <div className="p-4 border-b border-gray-200 dark:border-gray-700">
                    <h3 className="font-medium text-gray-900 dark:text-white">Team Members</h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Manage who has access to {currentAccount?.name}</p>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead className="bg-gray-50 dark:bg-gray-900/50 border-b border-gray-200 dark:border-gray-700">
                            <tr>
                                <th className="px-6 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">User</th>
                                <th className="px-6 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Base Role</th>
                                <th className="px-6 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Custom Role</th>
                                <th className="px-6 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                            {members.map(member => {
                                const isEditing = editingUserId === member.userId;
                                const isOwner = member.role === 'OWNER';

                                return (
                                    <tr key={member.userId} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-3">
                                                <div className="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-gray-500 overflow-hidden">
                                                    {member.user.avatarUrl ? (
                                                        <img src={member.user.avatarUrl} alt="" className="w-full h-full object-cover" />
                                                    ) : (
                                                        <User size={16} />
                                                    )}
                                                </div>
                                                <div>
                                                    <div className="font-medium text-gray-900 dark:text-white">{member.user.fullName || 'No Name'}</div>
                                                    <div className="text-sm text-gray-500 dark:text-gray-400">{member.user.email}</div>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            {isEditing && !isOwner ? (
                                                <select
                                                    value={editValues.role}
                                                    onChange={e => setEditValues({ ...editValues, role: e.target.value })}
                                                    className="px-3 py-1.5 text-sm border rounded-lg bg-white dark:bg-gray-900 dark:border-gray-600 dark:text-white"
                                                >
                                                    {BASE_ROLES.filter(r => r.value !== 'OWNER').map(r => (
                                                        <option key={r.value} value={r.value}>{r.label}</option>
                                                    ))}
                                                </select>
                                            ) : (
                                                <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${getRoleBadgeClass(member.role)}`}>
                                                    {isOwner && <Shield size={12} />}
                                                    {member.role}
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-6 py-4">
                                            {isEditing && !isOwner ? (
                                                <select
                                                    value={editValues.roleId || ''}
                                                    onChange={e => setEditValues({ ...editValues, roleId: e.target.value || null })}
                                                    className="px-3 py-1.5 text-sm border rounded-lg bg-white dark:bg-gray-900 dark:border-gray-600 dark:text-white"
                                                >
                                                    <option value="">None</option>
                                                    {customRoles.map(r => (
                                                        <option key={r.id} value={r.id}>{r.name}</option>
                                                    ))}
                                                </select>
                                            ) : (
                                                member.maxRole ? (
                                                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300">
                                                        {member.maxRole.name}
                                                    </span>
                                                ) : (
                                                    <span className="text-gray-400 dark:text-gray-500 text-sm">—</span>
                                                )
                                            )}
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            <div className="flex items-center justify-end gap-2">
                                                {isEditing ? (
                                                    <>
                                                        <button
                                                            onClick={() => saveEdit(member.userId)}
                                                            disabled={isSaving}
                                                            className="p-1.5 text-green-600 hover:bg-green-100 dark:hover:bg-green-900/30 rounded transition-colors"
                                                            title="Save"
                                                        >
                                                            <Check size={16} />
                                                        </button>
                                                        <button
                                                            onClick={cancelEdit}
                                                            className="p-1.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
                                                            title="Cancel"
                                                        >
                                                            <X size={16} />
                                                        </button>
                                                    </>
                                                ) : (
                                                    <>
                                                        {!isOwner && (
                                                            <button
                                                                onClick={() => startEdit(member)}
                                                                className="p-1.5 text-blue-600 hover:bg-blue-100 dark:hover:bg-blue-900/30 rounded transition-colors"
                                                                title="Edit Role"
                                                            >
                                                                <Edit2 size={16} />
                                                            </button>
                                                        )}
                                                        {!isOwner && (
                                                            <button
                                                                onClick={() => handleRemove(member.userId)}
                                                                className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-100 dark:hover:bg-red-900/30 rounded transition-colors"
                                                                title="Remove User"
                                                            >
                                                                <Trash2 size={16} />
                                                            </button>
                                                        )}
                                                    </>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Custom Roles Info */}
            {customRoles.length === 0 && (
                <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-4">
                    <p className="text-sm text-amber-800 dark:text-amber-300">
                        <strong>Tip:</strong> Create custom roles in the "Roles" tab to define granular permissions for STAFF members.
                    </p>
                </div>
            )}
        </div>
    );
}
