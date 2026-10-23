import { useState, useRef } from 'react';
import DOMPurify from 'dompurify';
import { Logger } from '../utils/logger';
import { useAuth } from '../context/AuthContext';
import { useAccount } from '../context/AccountContext';
import { User, Mail, Shield, Building, LogOut, Camera, Clock, Save, X, FileSignature, Loader2, Check, Lock } from 'lucide-react';
import SessionManager from '../components/settings/SessionManager';
import { RichTextEditor } from '../components/common/RichTextEditor';
import { ChangePasswordModal } from '../components/settings/ChangePasswordModal';
import { getSafeHref } from '../utils/url';
import { DateTimeSettings } from '../components/settings/DateTimeSettings';

/**
 * User profile with opaque workspace surfaces and dark mode support.
 */
export function UserProfilePage() {
    const { user, logout, updateUser, token } = useAuth();
    const { currentAccount, accounts } = useAccount();

    const [isEditing, setIsEditing] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
    const [uploadSuccess, setUploadSuccess] = useState(false);
    const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);

    // Form State
    const [formData, setFormData] = useState({
        fullName: user?.fullName || '',
        shiftStart: user?.shiftStart || '',
        shiftEnd: user?.shiftEnd || '',
        emailSignature: user?.emailSignature || ''
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
            Logger.error('Failed to update profile', { error: error });
        } finally {
            setIsLoading(false);
        }
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setIsUploadingAvatar(true);
        setUploadSuccess(false);

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
                setUploadSuccess(true);
                setTimeout(() => setUploadSuccess(false), 2000);
            }
        } catch (error) {
            Logger.error('Failed to upload avatar', { error: error });
        } finally {
            setIsUploadingAvatar(false);
        }
    };

    const getAvatarUrl = () => {
        if (user.avatarUrl) {
            return user.avatarUrl;
        }
        return `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.email}`;
    };

    return (
        <div className="p-0 sm:p-4 max-w-4xl mx-auto">
            {/* Page Header */}
            <div className="flex flex-wrap gap-4 items-center justify-between mb-6">
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white">User Profile</h1>

                {!isEditing ? (
                    <button
                        onClick={() => setIsEditing(true)}
                        className="bg-[var(--primary-color)] text-[var(--primary-foreground)] hover:bg-[var(--primary-hover)] px-5 py-2.5 text-sm font-semibold rounded-lg"
                    >
                        Edit Profile
                    </button>
                ) : (
                    <div className="flex gap-3">
                        <button
                            onClick={() => setIsEditing(false)}
                            className="px-4 py-2.5 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 text-gray-700 dark:text-slate-300 rounded-xl text-sm font-medium hover:bg-gray-50 dark:hover:bg-slate-700 transition-all duration-200 flex items-center gap-2"
                            disabled={isLoading}
                        >
                            <X size={16} /> Cancel
                        </button>
                        <button
                            onClick={handleSave}
                            className="px-4 py-2.5 bg-[var(--primary-color)] text-[var(--primary-foreground)] hover:bg-[var(--primary-hover)] rounded-lg text-sm font-semibold transition-colors flex items-center gap-2"
                            disabled={isLoading}
                        >
                            {isLoading ? (
                                <Loader2 size={16} className="animate-spin" />
                            ) : (
                                <Save size={16} />
                            )}
                            {isLoading ? 'Saving...' : 'Save Changes'}
                        </button>
                    </div>
                )}
            </div>

            {/* Main Profile Card */}
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 overflow-hidden">
                {/* Account-brand header */}
                <div className="h-24 bg-[var(--brand-subtle)] border-b border-[var(--brand-border)]" />

                <div className="px-4 pb-6 sm:px-6">
                    {/* Avatar & Quick Info */}
                    <div className="relative flex flex-wrap gap-4 justify-between items-end -mt-10 mb-8">
                        <div className="flex flex-wrap items-end gap-4 min-w-0">
                            {/* Avatar with upload */}
                            <div className="relative group">
                                <div className="w-24 h-24 rounded-xl bg-white dark:bg-slate-800 p-1 ring-4 ring-white dark:ring-slate-800">
                                    <div className="w-full h-full rounded-lg bg-slate-100 dark:bg-slate-700 flex items-center justify-center overflow-hidden">
                                        <img
                                            src={getAvatarUrl()}
                                            alt="Avatar"
                                            className="w-full h-full object-cover"
                                        />
                                    </div>
                                </div>
                                <button
                                    aria-label="Upload profile photo"
                                    onClick={() => fileInputRef.current?.click()}
                                    disabled={isUploadingAvatar}
                                    className={`absolute -bottom-1 -right-1 w-9 h-9 rounded-xl flex items-center justify-center shadow-lg transition-all duration-200 ${uploadSuccess
                                        ? 'bg-emerald-500 text-white'
                                        : 'bg-white dark:bg-slate-700 border border-gray-200 dark:border-slate-600 text-gray-600 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 hover:border-blue-200 dark:hover:border-blue-500'
                                        }`}
                                >
                                    {isUploadingAvatar ? (
                                        <Loader2 size={16} className="animate-spin" />
                                    ) : uploadSuccess ? (
                                        <Check size={16} />
                                    ) : (
                                        <Camera size={16} />
                                    )}
                                </button>
                                <input
                                    type="file"
                                    ref={fileInputRef}
                                    className="hidden"
                                    accept="image/*"
                                    onChange={handleFileUpload}
                                />
                            </div>

                            {/* Name & Email */}
                            <div className="mb-2">
                                {isEditing ? (
                                    <input
                                        type="text"
                                        value={formData.fullName}
                                        onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                                        className="text-2xl font-bold text-gray-900 dark:text-white border-b-2 border-blue-500 focus:border-blue-600 outline-none bg-transparent px-1 py-0.5 w-full"
                                        placeholder="Full Name"
                                    />
                                ) : (
                                    <h2 className="text-2xl font-bold text-gray-900 dark:text-white">{user.fullName || 'User'}</h2>
                                )}
                                <p className="text-slate-500 dark:text-slate-400 mt-0.5">{user.email}</p>
                            </div>
                        </div>

                        {/* Sign Out Button */}
                        <button
                            onClick={logout}
                            className="flex items-center gap-2 px-4 py-2.5 bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-500/20 rounded-xl text-sm font-medium transition-all duration-200"
                        >
                            <LogOut size={16} />
                            Sign Out
                        </button>
                    </div>

                    {/* Info Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        {/* Personal Info */}
                        <div className="space-y-6">
                            <h3 className="text-lg font-semibold text-gray-900 dark:text-white border-b border-gray-100 dark:border-slate-700 pb-3">
                                Personal Information
                            </h3>

                            <div className="space-y-5">
                                {/* Full Name */}
                                <div className="flex items-start gap-4">
                                    <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-500/10 flex items-center justify-center flex-shrink-0">
                                        <User className="text-blue-600 dark:text-blue-400" size={18} />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">Full Name</label>
                                        <div className="text-gray-900 dark:text-white font-medium">
                                            {isEditing ? '(Edit above)' : (user.fullName || 'Not set')}
                                        </div>
                                    </div>
                                </div>

                                {/* Shift Hours */}
                                <div className="flex items-start gap-4">
                                    <div className="w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-500/10 flex items-center justify-center flex-shrink-0">
                                        <Clock className="text-amber-600 dark:text-amber-400" size={18} />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">Shift Hours</label>
                                        {isEditing ? (
                                            <div className="flex items-center gap-2">
                                                <input
                                                    type="time"
                                                    value={formData.shiftStart}
                                                    onChange={(e) => setFormData({ ...formData, shiftStart: e.target.value })}
                                                    className="input-premium px-3 py-1.5 text-sm rounded-lg"
                                                />
                                                <span className="text-slate-400">–</span>
                                                <input
                                                    type="time"
                                                    value={formData.shiftEnd}
                                                    onChange={(e) => setFormData({ ...formData, shiftEnd: e.target.value })}
                                                    className="input-premium px-3 py-1.5 text-sm rounded-lg"
                                                />
                                            </div>
                                        ) : (
                                            <div className="text-gray-900 dark:text-white font-medium">
                                                {(user.shiftStart && user.shiftEnd)
                                                    ? `${user.shiftStart} – ${user.shiftEnd}`
                                                    : <span className="text-slate-400 italic font-normal">No shift hours set</span>
                                                }
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Email */}
                                <div className="flex items-start gap-4">
                                    <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 flex items-center justify-center flex-shrink-0">
                                        <Mail className="text-emerald-600 dark:text-emerald-400" size={18} />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">Email Address</label>
                                        <div className="text-gray-900 dark:text-white font-medium truncate">{user.email}</div>
                                    </div>
                                </div>

                                {/* User ID */}
                                <div className="flex items-start gap-4">
                                    <div className="w-10 h-10 rounded-xl bg-violet-50 dark:bg-violet-500/10 flex items-center justify-center flex-shrink-0">
                                        <Shield className="text-violet-600 dark:text-violet-400" size={18} />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">User ID</label>
                                        <div className="text-slate-500 dark:text-slate-400 font-mono text-sm truncate">{user.id}</div>
                                    </div>
                                </div>

                                {/* Change Password Button */}
                                <button
                                    onClick={() => setIsPasswordModalOpen(true)}
                                    className="flex items-center gap-3 w-full p-3 bg-slate-50 dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors group"
                                >
                                    <div className="w-10 h-10 rounded-lg bg-[var(--brand-subtle)] flex items-center justify-center">
                                        <Lock className="text-[var(--brand-text)]" size={18} />
                                    </div>
                                    <div className="text-left">
                                        <div className="text-sm font-medium text-gray-900 dark:text-white">Change Password</div>
                                        <div className="text-xs text-slate-500 dark:text-slate-400">Update your account password</div>
                                    </div>
                                </button>
                            </div>
                        </div>

                        {/* Workspace Info */}
                        <div className="space-y-6">
                            <h3 className="text-lg font-semibold text-gray-900 dark:text-white border-b border-gray-100 dark:border-slate-700 pb-3">
                                Current Workspace
                            </h3>

                            {currentAccount ? (
                                <div className="space-y-5">
                                    {/* Store Name */}
                                    <div className="flex items-start gap-4">
                                        <div className="w-10 h-10 rounded-xl bg-indigo-50 dark:bg-indigo-500/10 flex items-center justify-center flex-shrink-0">
                                            <Building className="text-indigo-600 dark:text-indigo-400" size={18} />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">Store Name</label>
                                            <div className="text-gray-900 dark:text-white font-medium">{currentAccount.appearance?.appName?.trim() || currentAccount.name}</div>
                                        </div>
                                    </div>

                                    {/* Store URL */}
                                    <div>
                                        <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-2">Store URL</label>
                                        <a
                                            href={getSafeHref(currentAccount.wooUrl)}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 text-sm font-medium truncate block hover:underline transition-colors"
                                        >
                                            {currentAccount.wooUrl}
                                        </a>
                                    </div>

                                    {/* Access Role */}
                                    <div>
                                        <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-2">My Access</label>
                                        <span className="inline-flex items-center px-3 py-1 rounded-md text-xs font-semibold bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200">
                                            Owner
                                        </span>
                                    </div>
                                </div>
                            ) : (
                                <div className="text-slate-500 dark:text-slate-400 italic">No active workspace selected.</div>
                            )}

                            {/* Other Workspaces */}
                            {accounts.length > 1 && (
                                <div className="mt-6 pt-6 border-t border-gray-100 dark:border-slate-700">
                                    <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-3">Other Workspaces</label>
                                    <div className="space-y-2">
                                        {accounts.filter(a => a.id !== currentAccount?.id).map(account => (
                                            <div key={account.id} className="flex items-center gap-3 text-sm text-slate-600 dark:text-slate-400 py-1">
                                                <div className="w-2 h-2 rounded-full bg-slate-300 dark:bg-slate-600"></div>
                                                {account.name}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Email Signature Section */}
                    <div className="mt-10 pt-8 border-t border-gray-100 dark:border-slate-700">
                        <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-3 mb-2">
                            <div className="w-10 h-10 rounded-xl bg-rose-50 dark:bg-rose-500/10 flex items-center justify-center">
                                <FileSignature size={18} className="text-rose-600 dark:text-rose-400" />
                            </div>
                            Email Signature
                        </h3>
                        <p className="text-sm text-slate-500 dark:text-slate-400 mb-5 ml-13">
                            This signature will be appended to emails you send from the Inbox. Supports rich text and images.
                        </p>

                        {isEditing ? (
                            <div className="space-y-3">
                                <RichTextEditor
                                    variant="standard"
                                    value={formData.emailSignature}
                                    onChange={(val) => setFormData({ ...formData, emailSignature: val })}
                                    features={['bold', 'italic', 'link']}
                                    placeholder="Add your email signature..."
                                />
                                <p className="text-xs text-slate-400 dark:text-slate-500">
                                    Tip: Format your signature with bold, italic, and links.
                                </p>
                            </div>
                        ) : (
                            <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 p-5 min-h-[80px]">
                                {user.emailSignature ? (
                                    <div
                                        className="text-sm text-gray-700 dark:text-slate-300"
                                        dangerouslySetInnerHTML={{
                                            __html: DOMPurify.sanitize(user.emailSignature, {
                                                ALLOWED_TAGS: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'a', 'div', 'span'],
                                                ALLOWED_ATTR: ['href', 'target', 'style']
                                            })
                                        }}
                                    />
                                ) : (
                                    <span className="text-slate-400 dark:text-slate-500 italic text-sm">No email signature configured. Click "Edit Profile" to add one.</span>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Session Manager */}
            <div className="mt-8"><DateTimeSettings /></div>
            <div className="mt-8 animate-fade-slide-up animation-delay-200">
                <SessionManager />
            </div>

            {/* Change Password Modal */}
            <ChangePasswordModal
                isOpen={isPasswordModalOpen}
                onClose={() => setIsPasswordModalOpen(false)}
            />
        </div>
    );
}
