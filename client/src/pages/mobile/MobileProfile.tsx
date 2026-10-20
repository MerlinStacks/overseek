import { useState, useRef, useEffect } from 'react';
import { Logger } from '../../utils/logger';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useHaptic } from '../../hooks/useHaptic';
import { MobilePageHeader } from '../../components/mobile/MobilePageHeader';
import { DateTimeSettings } from '../../components/settings/DateTimeSettings';
import {
    User,
    Mail,
    Camera,
    Save,
    Shield,
    LogOut,
    Building,
    Loader2,
    Check,
    Clock
} from 'lucide-react';

/**
 * MobileProfile - Account-branded mobile profile page.
 * Styled consistently with MobileDashboard for a cohesive PWA experience.
 * 
 * Features:
 * - Quiet, shared companion surfaces
 * - Haptic feedback
 * - Success state feedback
 */
export function MobileProfile() {
    const navigate = useNavigate();
    const { token, user, logout, updateUser } = useAuth();
    const { triggerHaptic } = useHaptic();
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
    const roleLabel = (user as { role?: string | null } | null)?.role?.toLowerCase() || 'user';
    const shiftStart = user?.shiftStart;
    const shiftEnd = user?.shiftEnd;

    return (
        <div className="space-y-6">
            {/* Header */}
            <MobilePageHeader
                title="Profile"
                description="Your details and account information"
                onBack={() => { triggerHaptic(); navigate(-1); }}
            />

            {/* Avatar Section */}
            <div className="mobile-panel flex flex-col items-center py-6 px-4">
                <div className="relative">
                    {avatarUrl ? (
                        <img
                            src={avatarUrl}
                            alt="Profile"
                            className="w-24 h-24 rounded-xl object-cover"
                        />
                    ) : (
                        <div className="mobile-brand-soft w-24 h-24 rounded-xl flex items-center justify-center text-4xl font-semibold">
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
                        className={`absolute -bottom-2 -right-2 w-10 h-10 rounded-lg flex items-center justify-center ${uploadSuccess
                            ? 'bg-emerald-500 text-white'
                            : 'mobile-brand-solid'
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
                <h2 className="mt-5 text-center text-xl font-semibold text-white">{fullName || 'No name set'}</h2>
                <p className="max-w-full break-all text-center text-sm text-slate-400 mt-1">{email}</p>
            </div>

            {/* Profile Form */}
            <div className="mobile-panel p-5 space-y-5">
                <div>
                    <label className="block text-xs font-medium text-slate-400 uppercase tracking-wide mb-2">Full Name</label>
                    <div className="relative">
                        <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400">
                            <User size={18} />
                        </div>
                        <input
                            type="text"
                            value={fullName}
                            onChange={e => setFullName(e.target.value)}
                            className="mobile-field w-full pl-11 pr-4 py-3.5"
                            placeholder="Your name"
                        />
                    </div>
                </div>

                <div>
                    <label className="block text-xs font-medium text-slate-400 uppercase tracking-wide mb-2">Email</label>
                    <div className="relative">
                        <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400">
                            <Mail size={18} />
                        </div>
                        <input
                            type="email"
                            value={email}
                            disabled
                            className="mobile-field w-full pl-11 pr-4 py-3.5"
                        />
                    </div>
                    <p className="text-xs text-slate-500 mt-2">Email cannot be changed</p>
                </div>

                <button
                    onClick={handleSave}
                    disabled={saving}
                    className={`w-full py-3.5 font-semibold rounded-lg flex items-center justify-center gap-2 disabled:opacity-50 ${saved
                        ? 'bg-emerald-500 text-white'
                        : 'mobile-brand-solid'
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
            <div className="mobile-panel divide-y divide-white/5 overflow-hidden">
                <div className="flex items-center gap-4 p-4">
                    <div className="mobile-icon w-11 h-11 rounded-lg flex items-center justify-center">
                        <Shield size={20} />
                    </div>
                    <div className="flex-1">
                        <p className="font-medium text-white">Account Role</p>
                        <p className="text-sm text-slate-400 capitalize">{roleLabel}</p>
                    </div>
                </div>

                <div className="flex items-center gap-4 p-4">
                    <div className="mobile-icon w-11 h-11 rounded-lg flex items-center justify-center">
                        <Building size={20} />
                    </div>
                    <div className="flex-1">
                        <p className="font-medium text-white">Account ID</p>
                        <p className="text-sm text-slate-400 font-mono">{user?.id?.slice(0, 8)}...</p>
                    </div>
                </div>

                <div className="flex items-center gap-4 p-4">
                    <div className="mobile-icon w-11 h-11 rounded-lg flex items-center justify-center">
                        <Clock size={20} />
                    </div>
                    <div className="flex-1">
                        <p className="font-medium text-white">Shift Hours</p>
                        <p className="text-sm text-slate-400">
                            {shiftStart && shiftEnd
                                ? `${shiftStart} - ${shiftEnd}`
                                : 'Not set'}
                        </p>
                    </div>
                </div>
            </div>

            {/* Logout Button */}
            <DateTimeSettings />
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
