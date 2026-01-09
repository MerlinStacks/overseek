import { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { Trash2, UserPlus, Shield, User } from 'lucide-react';

interface Member {
    userId: string;
    role: string;
    user: {
        id: string;
        fullName: string;
        email: string;
        avatarUrl: string | null;
    };
}

/**
 * Team management component for Settings page.
 * Allows adding/removing team members and managing roles.
 */
export function TeamSettings() {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [members, setMembers] = useState<Member[]>([]);
    const [email, setEmail] = useState('');
    const [role, setRole] = useState('STAFF');
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        if (currentAccount && token) fetchMembers();
    }, [currentAccount, token]);

    const fetchMembers = async () => {
        try {
            const res = await fetch(`/api/accounts/${currentAccount?.id}/users`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (res.ok) setMembers(await res.json());
        } catch (e) {
            console.error(e);
        } finally {
            setIsLoading(false);
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
                const data = await res.json();
                throw new Error(data.error || 'Failed to add user');
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
            console.error(e);
        }
    };

    if (isLoading) return <div className="p-4 text-gray-500">Loading members...</div>;

    return (
        <div className="space-y-6">
            {/* Invite Card */}
            <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-xs">
                <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                    <UserPlus size={20} className="text-blue-600" />
                    Add New Member
                </h2>
                <form onSubmit={handleInvite} className="flex flex-col sm:flex-row gap-4 items-start">
                    <div className="flex-1 w-full">
                        <input
                            type="email"
                            placeholder="Enter user email address"
                            className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-hidden"
                            value={email}
                            onChange={e => setEmail(e.target.value)}
                        />
                        <p className="text-xs text-gray-500 mt-1">User must already be registered with this email.</p>
                        {error && <p className="text-xs text-red-500 mt-1 font-medium">{error}</p>}
                    </div>

                    <select
                        className="px-4 py-2 border rounded-lg bg-white"
                        value={role}
                        onChange={e => setRole(e.target.value)}
                    >
                        <option value="STAFF">Staff</option>
                        <option value="ADMIN">Admin</option>
                    </select>

                    <button type="submit" className="px-6 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors whitespace-nowrap">
                        Add User
                    </button>
                </form>
            </div>

            {/* Members List */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-xs overflow-hidden">
                <div className="p-4 border-b border-gray-200">
                    <h3 className="font-medium text-gray-900">Team Members</h3>
                    <p className="text-sm text-gray-500">Manage who has access to {currentAccount?.name}</p>
                </div>
                <table className="w-full text-left">
                    <thead className="bg-gray-50 border-b border-gray-200">
                        <tr>
                            <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">User</th>
                            <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Role</th>
                            <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {members.map(member => (
                            <tr key={member.userId} className="hover:bg-gray-50">
                                <td className="px-6 py-4">
                                    <div className="flex items-center gap-3">
                                        <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-gray-500 overflow-hidden">
                                            {member.user.avatarUrl ? (
                                                <img src={member.user.avatarUrl} alt="" className="w-full h-full object-cover" />
                                            ) : (
                                                <User size={16} />
                                            )}
                                        </div>
                                        <div>
                                            <div className="font-medium text-gray-900">{member.user.fullName || 'No Name'}</div>
                                            <div className="text-sm text-gray-500">{member.user.email}</div>
                                        </div>
                                    </div>
                                </td>
                                <td className="px-6 py-4">
                                    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${member.role === 'OWNER' ? 'bg-purple-100 text-purple-800' :
                                        member.role === 'ADMIN' ? 'bg-blue-100 text-blue-800' :
                                            'bg-gray-100 text-gray-800'
                                        }`}>
                                        {member.role === 'OWNER' && <Shield size={12} />}
                                        {member.role}
                                    </span>
                                </td>
                                <td className="px-6 py-4 text-right">
                                    {member.role !== 'OWNER' && (
                                        <button
                                            onClick={() => handleRemove(member.userId)}
                                            className="text-gray-400 hover:text-red-600 transition-colors"
                                            title="Remove User"
                                        >
                                            <Trash2 size={18} />
                                        </button>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
