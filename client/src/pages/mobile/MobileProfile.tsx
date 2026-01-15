import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import {
    User,
    Mail,
    Camera,
    Save,
    ChevronLeft,
    Shield,
    LogOut,
    Building,
    Loader2
} from 'lucide-react';

/**
 * MobileProfile - Mobile-optimized user profile page
 * Allows viewing and editing user details with a clean mobile UI
 */
export function MobileProfile() {
    const navigate = useNavigate();
    const { token, user, logout, updateUser } = useAuth();
    const fileInputRef = useRef<HTMLInputElement>(null);

    const [fullName, setFullName] = useState(user?.fullName || '');
    const [email, setEmail] = useState(user?.email || '');
    const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [saved, setSaved] = useState(false);

    useEffect(() => {
        if (user) {
            setFullName(user.fullName || '');
            setEmail(user.email || '');
        }
    }, [user]);

    const handleSave = async () => {
        if (!token) return;

        setSaving(true);
        try {
            const res = await fetch('/api/auth/me', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ fullName })
            });
            if (res.ok) {
                setSaved(true);
                setTimeout(() => setSaved(false), 2000);
            }
        } catch (e) {
            console.error('[MobileProfile] Save error:', e);
        } finally {
            setSaving(false);
        }
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = () => setAvatarPreview(reader.result as string);
            reader.readAsDataURL(file);

            if (!token) return;

            setUploading(true);
            const formData = new FormData();
            formData.append('file', file);

            try {
                const res = await fetch('/api/auth/upload-avatar', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`
                    },
                    body: formData
                });

                if (res.ok) {
                    const data = await res.json();
                    if (user) {
                        updateUser({ ...user, avatarUrl: data.avatarUrl });
                    }
                    setAvatarPreview(null);
                } else {
                    console.error('Failed to upload avatar');
                    setAvatarPreview(null);
                }
            } catch (error) {
                console.error('Error uploading avatar:', error);
                setAvatarPreview(null);
            } finally {
                setUploading(false);
            }
        }
    };

    const handleLogout = () => {
        if (confirm('Are you sure you want to log out?')) {
            logout();
            navigate('/login');
        }
    };

    const getAvatarUrl = () => {
        if (avatarPreview) return avatarPreview;
        if (user?.avatarUrl) return user.avatarUrl;
        return null;
    };

    const avatarUrl = getAvatarUrl();

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center gap-3">
                <button
                    onClick={() => navigate(-1)}
                    className="w-10 h-10 flex items-center justify-center rounded-full bg-gray-100 active:bg-gray-200"
                    aria-label="Go back"
                >
                    <ChevronLeft size={24} />
                </button>
                <h1 className="text-xl font-bold text-gray-900">Profile</h1>
            </div>

            {/* Avatar Section */}
            <div className="flex flex-col items-center py-6">
                <div className="relative">
                    {avatarUrl ? (
                        <img
                            src={avatarUrl}
                            alt="Profile"
                            className="w-24 h-24 rounded-full object-cover ring-4 ring-white shadow-lg"
                        />
                    ) : (
                        <div className="w-24 h-24 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white text-3xl font-bold ring-4 ring-white shadow-lg">
                            {fullName?.[0]?.toUpperCase() || email?.[0]?.toUpperCase() || 'U'}
                        </div>
                    )}
                    {uploading && (
                        <div className="absolute inset-0 bg-black/30 rounded-full flex items-center justify-center">
                            <Loader2 className="animate-spin text-white" size={24} />
                        </div>
                    )}
                    <button
                        onClick={() => fileInputRef.current?.click()}
                        className="absolute bottom-0 right-0 w-8 h-8 bg-indigo-600 rounded-full flex items-center justify-center text-white shadow-lg active:bg-indigo-700"
                        aria-label="Change avatar"
                        disabled={uploading}
                    >
                        <Camera size={16} />
                    </button>
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        onChange={handleFileUpload}
                        className="hidden"
                    />
                </div>
                <h2 className="mt-4 text-lg font-semibold text-gray-900">{fullName || 'No name set'}</h2>
                <p className="text-sm text-gray-500">{email}</p>
            </div>

            {/* Profile Form */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 space-y-4">
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
                    <div className="relative">
                        <User size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                        <input
                            type="text"
                            value={fullName}
                            onChange={e => setFullName(e.target.value)}
                            className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-base"
                            placeholder="Your name"
                        />
                    </div>
                </div>

                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                    <div className="relative">
                        <Mail size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                        <input
                            type="email"
                            value={email}
                            disabled
                            className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-lg bg-gray-50 text-gray-500 text-base"
                        />
                    </div>
                    <p className="text-xs text-gray-400 mt-1">Email cannot be changed</p>
                </div>

                <button
                    onClick={handleSave}
                    disabled={saving}
                    className="w-full py-3 bg-indigo-600 text-white font-medium rounded-lg flex items-center justify-center gap-2 active:bg-indigo-700 disabled:opacity-50"
                >
                    {saving ? (
                        <Loader2 size={18} className="animate-spin" />
                    ) : saved ? (
                        <>✓ Saved</>
                    ) : (
                        <>
                            <Save size={18} />
                            Save Changes
                        </>
                    )}
                </button>
            </div>

            {/* Account Info */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 divide-y divide-gray-100">
                <div className="flex items-center gap-4 p-4">
                    <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center">
                        <Shield size={20} className="text-green-600" />
                    </div>
                    <div className="flex-1">
                        <p className="font-medium text-gray-900">Account Role</p>
                        <p className="text-sm text-gray-500 capitalize">{(user as any)?.role?.toLowerCase() || 'User'}</p>
                    </div>
                </div>

                <div className="flex items-center gap-4 p-4">
                    <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
                        <Building size={20} className="text-blue-600" />
                    </div>
                    <div className="flex-1">
                        <p className="font-medium text-gray-900">Account ID</p>
                        <p className="text-sm text-gray-500 font-mono">{user?.id?.slice(0, 8)}...</p>
                    </div>
                </div>
            </div>

            {/* Logout Button */}
            <button
                onClick={handleLogout}
                className="w-full py-3 bg-red-50 text-red-600 font-medium rounded-xl flex items-center justify-center gap-2 active:bg-red-100 border border-red-100"
            >
                <LogOut size={18} />
                Log Out
            </button>
        </div>
    );
}
