import { useState, useRef, useEffect } from 'react';
import { Logger } from '../../utils/logger';
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
    Loader2,
    Check,
    Clock
} from 'lucide-react';

/**
 * MobileProfile - Premium dark-mode mobile profile page.
 * Styled consistently with MobileDashboard for a cohesive PWA experience.
 * 
 * Features:
 * - Dark glassmorphism design
 * - Animated transitions
 * - Haptic feedback
 * - Success state feedback
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
    const [uploadSuccess, setUploadSuccess] = useState(false);

    useEffect(() => {
        if (user) {
            setFullName(user.fullName || '');
            setEmail(user.email || '');
        }
    }, [user]);

    /**
     * Triggers haptic feedback if supported by the device.
     */
    const triggerHaptic = (duration = 10) => {
        if ('vibrate' in navigator) {
            navigator.vibrate(duration);
        }
    };

    const handleSave = async () => {
        if (!token) return;

        triggerHaptic(15);
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
                const updatedUser = await res.json();
                updateUser(updatedUser);
                setSaved(true);
                triggerHaptic(30);
                setTimeout(() => setSaved(false), 2000);
            }
        } catch (e) {
            Logger.error('[MobileProfile] Save error:', { error: e });
        } finally {
            setSaving(false);
        }
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            triggerHaptic();
            const reader = new FileReader();
            reader.onload = () => setAvatarPreview(reader.result as string);
            reader.readAsDataURL(file);

            if (!token) return;

            setUploading(true);
            setUploadSuccess(false);
            const formData = new FormData();
            formData.append('avatar', file);

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
                    setUploadSuccess(true);
                    triggerHaptic(30);
                    setTimeout(() => setUploadSuccess(false), 2000);
                } else {
                    Logger.error('Failed to upload avatar');
                    setAvatarPreview(null);
                }
            } catch (error) {
                Logger.error('Error uploading avatar:', { error: error });
                setAvatarPreview(null);
            } finally {
                setUploading(false);
            }
        }
    };

    const handleLogout = () => {
        triggerHaptic(20);
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
        <div className="space-y-6 animate-fade-slide-up">
            {/* Header */}
            <div className="flex items-center gap-3">
                <button
                    onClick={() => {
                        triggerHaptic();
                        navigate(-1);
                    }}
                    className="w-10 h-10 flex items-center justify-center rounded-2xl bg-slate-800/50 backdrop-blur-sm border border-white/10 active:scale-95 transition-transform"
                    aria-label="Go back"
                >
                    <ChevronLeft size={22} className="text-slate-300" />
                </button>
                <h1 className="text-xl font-bold text-white">Profile</h1>
            </div>

            {/* Avatar Section */}
            <div className="flex flex-col items-center py-8">
                <div className="relative">
                    {avatarUrl ? (
                        <img
                            src={avatarUrl}
                            alt="Profile"
                            className="w-28 h-28 rounded-2xl object-cover ring-4 ring-slate-800 shadow-2xl"
                        />
                    ) : (
                        <div className="w-28 h-28 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white text-4xl font-bold ring-4 ring-slate-800 shadow-2xl">
                            {fullName?.[0]?.toUpperCase() || email?.[0]?.toUpperCase() || 'U'}
                        </div>
                    )}

                    {/* Upload overlay */}
                    {uploading && (
                        <div className="absolute inset-0 bg-black/50 backdrop-blur-sm rounded-2xl flex items-center justify-center">
                            <Loader2 className="animate-spin text-white" size={28} />
                        </div>
                    )}

                    {/* Camera button */}
                    <button
                        onClick={() => fileInputRef.current?.click()}
                        className={`absolute -bottom-2 -right-2 w-10 h-10 rounded-xl flex items-center justify-center shadow-lg transition-all duration-200 ${uploadSuccess
                                ? 'bg-emerald-500 text-white'
                                : 'bg-gradient-to-br from-indigo-500 to-purple-600 text-white active:scale-95'
                            }`}
                        aria-label="Change avatar"
                        disabled={uploading}
                    >
                        {uploadSuccess ? <Check size={18} /> : <Camera size={18} />}
                    </button>
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        onChange={handleFileUpload}
                        className="hidden"
                    />
                </div>
                <h2 className="mt-5 text-xl font-bold text-white">{fullName || 'No name set'}</h2>
                <p className="text-sm text-slate-400 mt-1">{email}</p>
            </div>

            {/* Profile Form */}
            <div className="bg-slate-800/50 backdrop-blur-sm border border-white/10 rounded-2xl p-5 space-y-5">
                <div>
                    <label className="block text-xs font-medium text-slate-400 uppercase tracking-wide mb-2">Full Name</label>
                    <div className="relative">
                        <div className="absolute left-4 top-1/2 -translate-y-1/2 p-1.5 rounded-lg bg-blue-500/20">
                            <User size={16} className="text-blue-400" />
                        </div>
                        <input
                            type="text"
                            value={fullName}
                            onChange={e => setFullName(e.target.value)}
                            className="w-full pl-14 pr-4 py-3.5 bg-slate-900/50 border border-white/10 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all"
                            placeholder="Your name"
                        />
                    </div>
                </div>

                <div>
                    <label className="block text-xs font-medium text-slate-400 uppercase tracking-wide mb-2">Email</label>
                    <div className="relative">
                        <div className="absolute left-4 top-1/2 -translate-y-1/2 p-1.5 rounded-lg bg-emerald-500/20">
                            <Mail size={16} className="text-emerald-400" />
                        </div>
                        <input
                            type="email"
                            value={email}
                            disabled
                            className="w-full pl-14 pr-4 py-3.5 bg-slate-900/30 border border-white/5 rounded-xl text-slate-500"
                        />
                    </div>
                    <p className="text-xs text-slate-500 mt-2">Email cannot be changed</p>
                </div>

                <button
                    onClick={handleSave}
                    disabled={saving}
                    className={`w-full py-3.5 font-semibold rounded-xl flex items-center justify-center gap-2 transition-all active:scale-[0.98] disabled:opacity-50 ${saved
                            ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/25'
                            : 'bg-gradient-to-r from-indigo-500 to-purple-600 text-white shadow-lg shadow-indigo-500/25'
                        }`}
                >
                    {saving ? (
                        <Loader2 size={18} className="animate-spin" />
                    ) : saved ? (
                        <>
                            <Check size={18} />
                            Saved!
                        </>
                    ) : (
                        <>
                            <Save size={18} />
                            Save Changes
                        </>
                    )}
                </button>
            </div>

            {/* Account Info Cards */}
            <div className="bg-slate-800/50 backdrop-blur-sm border border-white/10 rounded-2xl divide-y divide-white/5 overflow-hidden">
                <div className="flex items-center gap-4 p-4">
                    <div className="w-11 h-11 rounded-xl bg-emerald-500/20 flex items-center justify-center">
                        <Shield size={20} className="text-emerald-400" />
                    </div>
                    <div className="flex-1">
                        <p className="font-medium text-white">Account Role</p>
                        <p className="text-sm text-slate-400 capitalize">{(user as any)?.role?.toLowerCase() || 'User'}</p>
                    </div>
                </div>

                <div className="flex items-center gap-4 p-4">
                    <div className="w-11 h-11 rounded-xl bg-blue-500/20 flex items-center justify-center">
                        <Building size={20} className="text-blue-400" />
                    </div>
                    <div className="flex-1">
                        <p className="font-medium text-white">Account ID</p>
                        <p className="text-sm text-slate-400 font-mono">{user?.id?.slice(0, 8)}...</p>
                    </div>
                </div>

                <div className="flex items-center gap-4 p-4">
                    <div className="w-11 h-11 rounded-xl bg-amber-500/20 flex items-center justify-center">
                        <Clock size={20} className="text-amber-400" />
                    </div>
                    <div className="flex-1">
                        <p className="font-medium text-white">Shift Hours</p>
                        <p className="text-sm text-slate-400">
                            {(user as any)?.shiftStart && (user as any)?.shiftEnd
                                ? `${(user as any).shiftStart} – ${(user as any).shiftEnd}`
                                : 'Not set'}
                        </p>
                    </div>
                </div>
            </div>

            {/* Logout Button */}
            <button
                onClick={handleLogout}
                className="w-full py-3.5 bg-red-500/10 border border-red-500/20 text-red-400 font-semibold rounded-2xl flex items-center justify-center gap-2 active:bg-red-500/20 active:scale-[0.98] transition-all"
            >
                <LogOut size={18} />
                Log Out
            </button>
        </div>
    );
}
