import { useState } from 'react';
import { X, Lock, Eye, EyeOff, Loader2, Check, AlertCircle } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { Logger } from '../../utils/logger';

interface ChangePasswordModalProps {
    isOpen: boolean;
    onClose: () => void;
}

interface ValidationState {
    minLength: boolean;
    hasLetter: boolean;
    hasNumber: boolean;
    notSameAsCurrent: boolean;
    passwordsMatch: boolean;
}

/**
 * Modal for changing user password with real-time validation
 * and premium glassmorphism styling.
 */
export function ChangePasswordModal({ isOpen, onClose }: ChangePasswordModalProps) {
    const { token } = useAuth();

    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');

    const [showCurrent, setShowCurrent] = useState(false);
    const [showNew, setShowNew] = useState(false);
    const [showConfirm, setShowConfirm] = useState(false);

    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);

    // Real-time validation
    const validation: ValidationState = {
        minLength: newPassword.length >= 8,
        hasLetter: /[a-zA-Z]/.test(newPassword),
        hasNumber: /[0-9]/.test(newPassword),
        notSameAsCurrent: newPassword !== currentPassword || newPassword === '',
        passwordsMatch: newPassword === confirmPassword && confirmPassword !== ''
    };

    const isFormValid =
        currentPassword.length > 0 &&
        validation.minLength &&
        validation.hasLetter &&
        validation.hasNumber &&
        validation.notSameAsCurrent &&
        validation.passwordsMatch;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!isFormValid) return;

        setIsLoading(true);
        setError(null);

        try {
            const res = await fetch('/api/auth/change-password', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ currentPassword, newPassword, confirmPassword })
            });

            const data = await res.json();

            if (!res.ok) {
                setError(data.error || 'Failed to change password');
                return;
            }

            setSuccess(true);
            setTimeout(() => {
                onClose();
                // Reset state after close animation
                setTimeout(() => {
                    setCurrentPassword('');
                    setNewPassword('');
                    setConfirmPassword('');
                    setSuccess(false);
                }, 300);
            }, 1500);
        } catch (err) {
            Logger.error('Change password error', { error: err });
            setError('An unexpected error occurred');
        } finally {
            setIsLoading(false);
        }
    };

    const handleClose = () => {
        if (isLoading) return;
        onClose();
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
        setError(null);
        setSuccess(false);
    };

    if (!isOpen) return null;

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in"
            onClick={handleClose}
        >
            <div
                className="w-full max-w-md bg-white dark:bg-slate-800 rounded-2xl shadow-2xl animate-scale-up overflow-hidden"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-slate-700">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center shadow-lg shadow-amber-500/25">
                            <Lock size={18} className="text-white" />
                        </div>
                        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Change Password</h2>
                    </div>
                    <button
                        onClick={handleClose}
                        disabled={isLoading}
                        className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-lg transition-all"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Form */}
                <form onSubmit={handleSubmit} className="p-6 space-y-5">
                    {/* Error Alert */}
                    {error && (
                        <div className="flex items-center gap-3 p-3 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-xl text-red-600 dark:text-red-400 text-sm">
                            <AlertCircle size={18} />
                            {error}
                        </div>
                    )}

                    {/* Success Message */}
                    {success && (
                        <div className="flex items-center gap-3 p-3 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/30 rounded-xl text-emerald-600 dark:text-emerald-400 text-sm">
                            <Check size={18} />
                            Password changed successfully!
                        </div>
                    )}

                    {/* Current Password */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-2">
                            Current Password
                        </label>
                        <div className="relative">
                            <input
                                type={showCurrent ? 'text' : 'password'}
                                value={currentPassword}
                                onChange={(e) => { setCurrentPassword(e.target.value); setError(null); }}
                                className="input-premium w-full pr-10"
                                placeholder="Enter current password"
                                disabled={isLoading || success}
                            />
                            <button
                                type="button"
                                onClick={() => setShowCurrent(!showCurrent)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                            >
                                {showCurrent ? <EyeOff size={18} /> : <Eye size={18} />}
                            </button>
                        </div>
                    </div>

                    {/* New Password */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-2">
                            New Password
                        </label>
                        <div className="relative">
                            <input
                                type={showNew ? 'text' : 'password'}
                                value={newPassword}
                                onChange={(e) => setNewPassword(e.target.value)}
                                className="input-premium w-full pr-10"
                                placeholder="Enter new password"
                                disabled={isLoading || success}
                            />
                            <button
                                type="button"
                                onClick={() => setShowNew(!showNew)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                            >
                                {showNew ? <EyeOff size={18} /> : <Eye size={18} />}
                            </button>
                        </div>

                        {/* Validation Hints */}
                        {newPassword.length > 0 && (
                            <div className="mt-3 space-y-1.5">
                                <ValidationHint valid={validation.minLength} text="At least 8 characters" />
                                <ValidationHint valid={validation.hasLetter} text="Contains a letter" />
                                <ValidationHint valid={validation.hasNumber} text="Contains a number" />
                                {!validation.notSameAsCurrent && (
                                    <ValidationHint valid={false} text="Cannot be same as current password" />
                                )}
                            </div>
                        )}
                    </div>

                    {/* Confirm Password */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-2">
                            Confirm New Password
                        </label>
                        <div className="relative">
                            <input
                                type={showConfirm ? 'text' : 'password'}
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                className="input-premium w-full pr-10"
                                placeholder="Confirm new password"
                                disabled={isLoading || success}
                            />
                            <button
                                type="button"
                                onClick={() => setShowConfirm(!showConfirm)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                            >
                                {showConfirm ? <EyeOff size={18} /> : <Eye size={18} />}
                            </button>
                        </div>
                        {confirmPassword.length > 0 && !validation.passwordsMatch && (
                            <p className="mt-2 text-sm text-red-500 dark:text-red-400 flex items-center gap-1.5">
                                <X size={14} /> Passwords do not match
                            </p>
                        )}
                    </div>

                    {/* Submit Button */}
                    <button
                        type="submit"
                        disabled={!isFormValid || isLoading || success}
                        className="w-full btn-gradient btn-shimmer py-3 rounded-xl font-semibold text-white disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                        {isLoading ? (
                            <>
                                <Loader2 size={18} className="animate-spin" />
                                Changing Password...
                            </>
                        ) : success ? (
                            <>
                                <Check size={18} />
                                Password Changed!
                            </>
                        ) : (
                            'Change Password'
                        )}
                    </button>
                </form>
            </div>
        </div>
    );
}

/** Validation hint component with check/x icon */
function ValidationHint({ valid, text }: { valid: boolean; text: string }) {
    return (
        <div className={`flex items-center gap-2 text-xs ${valid ? 'text-emerald-500' : 'text-slate-400 dark:text-slate-500'}`}>
            {valid ? <Check size={12} /> : <X size={12} />}
            {text}
        </div>
    );
}
