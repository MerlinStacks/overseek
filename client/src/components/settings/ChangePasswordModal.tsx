import { useEffect, useEffectEvent, useId, useRef, useState } from 'react';
import { Lock, Eye, EyeOff, Loader2, Check, AlertCircle, X } from 'lucide-react';
import { Modal } from '../ui/Modal';
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
 * and accessible, theme-aware styling.
 */
export function ChangePasswordModal(props: ChangePasswordModalProps) {
    const { token } = useAuth();
    if (!props.isOpen) return null;
    if (!token) return <Modal isOpen onClose={props.onClose} title="Change Password"><p role="alert">Authentication required.</p></Modal>;
    return <ChangePasswordContent key={token} {...props} token={token} />;
}

function ChangePasswordContent({ isOpen, onClose, token }: ChangePasswordModalProps & { token: string }) {
    const id = useId();
    const active = useRef(true);
    const pending = useRef(false);
    const request = useRef<AbortController | null>(null);
    useEffect(() => {
        active.current = true;
        return () => { active.current = false; request.current?.abort(); };
    }, []);

    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');

    const [showCurrent, setShowCurrent] = useState(false);
    const [showNew, setShowNew] = useState(false);
    const [showConfirm, setShowConfirm] = useState(false);

    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);
    const closeAfterSuccess = useEffectEvent(() => onClose());
    useEffect(() => {
        if (!success) return;
        const timer = setTimeout(() => closeAfterSuccess(), 1500);
        return () => clearTimeout(timer);
    }, [success]);

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
        if (!isFormValid || pending.current || success) return;

        pending.current = true;
        const controller = new AbortController();
        request.current = controller;
        setIsLoading(true);
        setError(null);

        try {
            const res = await fetch('/api/auth/change-password', {
                method: 'POST',
                signal: controller.signal,
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ currentPassword, newPassword, confirmPassword })
            });

            const data = await res.json().catch(() => ({}));
            if (!active.current || controller.signal.aborted) return;

            if (!res.ok) {
                setError(data.error || 'Failed to change password');
                return;
            }

            setSuccess(true);
            setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
            setShowCurrent(false); setShowNew(false); setShowConfirm(false);
        } catch (err) {
            if (!active.current || controller.signal.aborted) return;
            Logger.error('Change password error', { error: err });
            setError('An unexpected error occurred');
        } finally {
            pending.current = false;
            if (active.current) setIsLoading(false);
        }
    };

    const handleClose = () => {
        if (pending.current) return;
        onClose();
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
        setError(null);
        setSuccess(false);
        setShowCurrent(false); setShowNew(false); setShowConfirm(false);
    };

    return (
        <Modal
            isOpen={isOpen}
            onClose={handleClose}
            title={
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-[var(--brand-subtle)] text-[var(--brand-text)] flex items-center justify-center">
                        <Lock size={18} />
                    </div>
                    <span>Change Password</span>
                </div>
            }
            maxWidth="max-w-md"
        >
            <form onSubmit={handleSubmit} className="space-y-5">
                {/* Error Alert */}
                {error && (
                    <div role="alert" className="flex items-center gap-3 p-3 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-xl text-red-600 dark:text-red-400 text-sm">
                        <AlertCircle size={18} />
                        {error}
                    </div>
                )}

                {/* Success Message */}
                {success && (
                    <div role="status" className="flex items-center gap-3 p-3 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/30 rounded-xl text-emerald-600 dark:text-emerald-400 text-sm">
                        <Check size={18} />
                        Password changed successfully!
                    </div>
                )}

                {/* Current Password */}
                <div>
                    <label htmlFor={`${id}-current`} className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-2">
                        Current Password
                    </label>
                    <div className="relative">
                        <input
                            id={`${id}-current`} autoComplete="current-password"
                            type={showCurrent ? 'text' : 'password'}
                            value={currentPassword}
                            onChange={(e) => { setCurrentPassword(e.target.value); setError(null); }}
                            className="input-premium w-full pr-10"
                            placeholder="Enter current password"
                            disabled={isLoading || success}
                        />
                        <button
                            type="button"
                            aria-label={`${showCurrent ? 'Hide' : 'Show'} current password`} aria-pressed={showCurrent}
                            onClick={() => setShowCurrent(!showCurrent)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                        >
                            {showCurrent ? <EyeOff size={18} /> : <Eye size={18} />}
                        </button>
                    </div>
                </div>

                {/* New Password */}
                <div>
                    <label htmlFor={`${id}-new`} className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-2">
                        New Password
                    </label>
                    <div className="relative">
                        <input
                            id={`${id}-new`} autoComplete="new-password"
                            type={showNew ? 'text' : 'password'}
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            className="input-premium w-full pr-10"
                            placeholder="Enter new password"
                            disabled={isLoading || success}
                        />
                        <button
                            type="button"
                            aria-label={`${showNew ? 'Hide' : 'Show'} new password`} aria-pressed={showNew}
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
                    <label htmlFor={`${id}-confirm`} className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-2">
                        Confirm New Password
                    </label>
                    <div className="relative">
                        <input
                            id={`${id}-confirm`} autoComplete="new-password"
                            type={showConfirm ? 'text' : 'password'}
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            className="input-premium w-full pr-10"
                            placeholder="Confirm new password"
                            disabled={isLoading || success}
                        />
                        <button
                            type="button"
                            aria-label={`${showConfirm ? 'Hide' : 'Show'} password confirmation`} aria-pressed={showConfirm}
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
                    className="w-full bg-[var(--primary-color)] text-[var(--primary-foreground)] hover:bg-[var(--primary-hover)] py-3 rounded-lg font-semibold disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
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
        </Modal>
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
