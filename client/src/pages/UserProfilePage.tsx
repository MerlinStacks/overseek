import { useState, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { useAccount } from '../context/AccountContext';
import { User, Mail, Shield, Building, LogOut, Camera, Clock, Save, X } from 'lucide-react';
import SessionManager from '../components/settings/SessionManager';

export function UserProfilePage() {
    const { user, logout, updateUser, token } = useAuth();
    const { currentAccount, accounts } = useAccount();

    const [isEditing, setIsEditing] = useState(false);
    const [isLoading, setIsLoading] = useState(false);

    // Form State
    const [formData, setFormData] = useState({
        fullName: user?.fullName || '',
        shiftStart: user?.shiftStart || '',
        shiftEnd: user?.shiftEnd || ''
    });

    const fileInputRef = useRef<HTMLInputElement>(null);

    if (!user) return null;

    const handleSave = async () => {
        setIsLoading(true);
        try {
            const res = await fetch('/api/auth/me', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(formData)
            });

            if (res.ok) {
                const updatedUser = await res.json();
                updateUser(updatedUser);
                setIsEditing(false);
            }
        } catch (error) {
            console.error('Failed to update profile', error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const uploadData = new FormData();
        uploadData.append('avatar', file);

        try {
            const res = await fetch('/api/auth/upload-avatar', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`
                },
                body: uploadData
            });

            if (res.ok) {
                const { avatarUrl } = await res.json();
                updateUser({ ...user, avatarUrl });
            }
        } catch (error) {
            console.error('Failed to upload avatar', error);
        }
    };

    const getAvatarUrl = () => {
        if (user.avatarUrl) {
            return user.avatarUrl; // This will return relative path like /uploads/avatar-....
        }
        return `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.email}`;
    };

    return (
        <div className="p-8 max-w-4xl mx-auto">
            <div className="flex items-center justify-between mb-8">
                <h1 className="text-2xl font-bold text-gray-900">User Profile</h1>

                {!isEditing ? (
                    <button
                        onClick={() => setIsEditing(true)}
                        className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
                    >
                        Edit Profile
                    </button>
                ) : (
                    <div className="flex gap-2">
                        <button
                            onClick={() => setIsEditing(false)}
                            className="px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors flex items-center gap-2"
                            disabled={isLoading}
                        >
                            <X size={16} /> Cancel
                        </button>
                        <button
                            onClick={handleSave}
                            className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 transition-colors flex items-center gap-2"
                            disabled={isLoading}
                        >
                            <Save size={16} /> {isLoading ? 'Saving...' : 'Save Changes'}
                        </button>
                    </div>
                )}
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                {/* Header / Banner */}
                <div className="h-32 bg-gradient-to-r from-blue-600 to-indigo-600"></div>

                <div className="px-8 pb-8">
                    {/* Avatar & Info */}
                    <div className="relative flex justify-between items-end -mt-12 mb-6">
                        <div className="flex items-end gap-6">
                            <div className="relative group">
                                <div className="w-24 h-24 rounded-full bg-white p-1 shadow-md">
                                    <div className="w-full h-full rounded-full bg-gray-100 flex items-center justify-center overflow-hidden">
                                        <img
                                            src={getAvatarUrl()}
                                            alt="Avatar"
                                            className="w-full h-full object-cover"
                                        />
                                    </div>
                                </div>
                                <button
                                    onClick={() => fileInputRef.current?.click()}
                                    className="absolute bottom-0 right-0 w-8 h-8 bg-white border border-gray-200 rounded-full flex items-center justify-center shadow-sm text-gray-500 hover:text-blue-600 hover:border-blue-200 transition-colors"
                                >
                                    <Camera size={14} />
                                </button>
                                <input
                                    type="file"
                                    ref={fileInputRef}
                                    className="hidden"
                                    accept="image/*"
                                    onChange={handleFileUpload}
                                />
                            </div>

                            <div className="mb-1">
                                {isEditing ? (
                                    <input
                                        type="text"
                                        value={formData.fullName}
                                        onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                                        className="text-2xl font-bold text-gray-900 border-b border-gray-300 focus:border-blue-500 outline-none bg-transparent px-1 py-0.5 w-full"
                                        placeholder="Full Name"
                                    />
                                ) : (
                                    <h2 className="text-2xl font-bold text-gray-900">{user.fullName || 'User'}</h2>
                                )}
                                <p className="text-gray-500">{user.email}</p>
                            </div>
                        </div>
                        <button
                            onClick={logout}
                            className="flex items-center gap-2 px-4 py-2 bg-red-50 text-red-600 hover:bg-red-100 rounded-lg text-sm font-medium transition-colors"
                        >
                            <LogOut size={16} />
                            Sign Out
                        </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        {/* Personal Info */}
                        <div className="space-y-6">
                            <h3 className="text-lg font-semibold text-gray-900 border-b border-gray-100 pb-2">Personal Information</h3>

                            <div className="space-y-4">
                                <div className="flex items-start gap-3">
                                    <User className="text-gray-400 mt-0.5" size={18} />
                                    <div className="flex-1">
                                        <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide">Full Name</label>
                                        <div className="text-gray-900 h-6 flex items-center">{isEditing ? '(Edit above)' : (user.fullName || 'Not set')}</div>
                                    </div>
                                </div>

                                <div className="flex items-start gap-3">
                                    <Clock className="text-gray-400 mt-0.5" size={18} />
                                    <div className="flex-1">
                                        <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Shift Hours</label>

                                        {isEditing ? (
                                            <div className="flex items-center gap-2">
                                                <input
                                                    type="time"
                                                    value={formData.shiftStart}
                                                    onChange={(e) => setFormData({ ...formData, shiftStart: e.target.value })}
                                                    className="border border-gray-300 rounded px-2 py-1 text-sm focus:border-blue-500 outline-none"
                                                />
                                                <span className="text-gray-400">-</span>
                                                <input
                                                    type="time"
                                                    value={formData.shiftEnd}
                                                    onChange={(e) => setFormData({ ...formData, shiftEnd: e.target.value })}
                                                    className="border border-gray-300 rounded px-2 py-1 text-sm focus:border-blue-500 outline-none"
                                                />
                                            </div>
                                        ) : (
                                            <div className="text-gray-900">
                                                {(user.shiftStart && user.shiftEnd)
                                                    ? `${user.shiftStart} - ${user.shiftEnd}`
                                                    : <span className="text-gray-400 italic">No shift hours set</span>
                                                }
                                            </div>
                                        )}
                                    </div>
                                </div>

                                <div className="flex items-start gap-3">
                                    <Mail className="text-gray-400 mt-0.5" size={18} />
                                    <div>
                                        <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide">Email Address</label>
                                        <div className="text-gray-900">{user.email}</div>
                                    </div>
                                </div>

                                <div className="flex items-start gap-3">
                                    <Shield className="text-gray-400 mt-0.5" size={18} />
                                    <div>
                                        <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide">User ID</label>
                                        <div className="text-gray-500 font-mono text-sm">{user.id}</div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Account Context */}
                        <div className="space-y-6">
                            <h3 className="text-lg font-semibold text-gray-900 border-b border-gray-100 pb-2">Current Workspace</h3>

                            {currentAccount ? (
                                <div className="space-y-4">
                                    <div className="flex items-start gap-3">
                                        <Building className="text-gray-400 mt-0.5" size={18} />
                                        <div>
                                            <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide">Store Name</label>
                                            <div className="text-gray-900">{currentAccount.name}</div>
                                        </div>
                                    </div>

                                    <div>
                                        <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Store URL</label>
                                        <a href={currentAccount.wooUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline text-sm truncate block">
                                            {currentAccount.wooUrl}
                                        </a>
                                    </div>

                                    <div>
                                        <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">My Access</label>
                                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                                            Owner
                                        </span>
                                    </div>
                                </div>
                            ) : (
                                <div className="text-gray-500 italic">No active workspace selected.</div>
                            )}

                            {accounts.length > 1 && (
                                <div className="mt-6 pt-6 border-t border-gray-100">
                                    <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Other Workspaces</label>
                                    <div className="space-y-2">
                                        {accounts.filter(a => a.id !== currentAccount?.id).map(account => (
                                            <div key={account.id} className="flex items-center gap-2 text-sm text-gray-600">
                                                <div className="w-2 h-2 rounded-full bg-gray-300"></div>
                                                {account.name}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Active Sessions */}
            <div className="mt-8">
                <SessionManager />
            </div>
        </div >
    );
}
