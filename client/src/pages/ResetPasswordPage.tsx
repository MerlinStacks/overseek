import { FormEvent, useState } from 'react';
import { useRecoveryAttempt } from '../hooks/useRecoveryAttempt';
import { Link, useSearchParams } from 'react-router-dom';

export function ResetPasswordPage() {
    const [searchParams] = useSearchParams();
    const token = searchParams.getAll('token').length === 1 ? searchParams.get('token') || '' : '';
    return <ResetPasswordForm key={token} token={token} />;
}
function ResetPasswordForm({ token }: { token: string }) {
    const attempt = useRecoveryAttempt();
    const validToken = /^[a-f0-9]{64}$/.test(token);
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (event: FormEvent) => {
        event.preventDefault();
        if (message) return;
        setError('');
        setMessage('');

        if (!validToken) {
            setError('Reset link is missing or invalid. Request a new link.');
            return;
        }
        if (newPassword.length < 8 || newPassword.length > 1024) {
            setError('Password must be at least 8 characters long.');
            return;
        }
        if (newPassword !== confirmPassword) {
            setError('Passwords do not match.');
            return;
        }

        const request = attempt.begin(); if (!request) return;
        const timer = setTimeout(() => request.abort(), 20000);
        setLoading(true);
        try {
            const response = await fetch('/api/auth/reset-password', {
                signal: request.signal,
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token, newPassword })
            });
            const data = await response.json();
            if (!response.ok || !data || typeof data.message !== 'string' || data.message.length > 1000) throw new Error('Invalid acknowledgement');
            if (!attempt.current(request)) return;
            setMessage('Password has been reset successfully.');
            setNewPassword('');
            setConfirmPassword('');
        } catch (err: unknown) {
            if (attempt.current(request, true)) setError('Reset was not acknowledged. The link may be expired or already used. Try signing in or request a new link.');
        } finally {
            clearTimeout(timer); attempt.finish();
            if (attempt.current(request, true)) setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-4">
            <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6">
                <h1 className="text-xl font-semibold text-slate-900 dark:text-white">Choose a new password</h1>
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">Create a new password for your account.</p>

                <form onSubmit={handleSubmit} className="mt-6 space-y-4">
                    {!validToken && <p role="alert">Reset link is missing or invalid. Request a new link.</p>}
                    {error ? <div role="alert" className="text-sm text-rose-600">{error}</div> : null}
                    {message ? <div role="status" className="text-sm text-emerald-600">{message}</div> : null}

                    <div>
                        <label htmlFor="new-password" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">New password</label>
                        <input
                            id="new-password"
                            disabled={loading || !!message || !validToken}
                            maxLength={1024}
                            type="password"
                            autoComplete="new-password"
                            required
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[var(--brand-border)] focus:border-[var(--primary-color)]"
                        />
                    </div>

                    <div>
                        <label htmlFor="confirm-password" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Confirm password</label>
                        <input
                            id="confirm-password"
                            disabled={loading || !!message || !validToken}
                            maxLength={1024}
                            type="password"
                            autoComplete="new-password"
                            required
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[var(--brand-border)] focus:border-[var(--primary-color)]"
                        />
                    </div>

                    <button
                        type="submit"
                        disabled={loading || !validToken || !!message}
                        className="w-full rounded-lg bg-[var(--primary-color)] text-[var(--primary-foreground)] py-2.5 font-medium hover:bg-[var(--primary-hover)] focus-visible:outline-[var(--focus-color)] disabled:opacity-60"
                    >
                        {loading ? 'Resetting...' : 'Reset password'}
                    </button>
                </form>

                <div className="mt-4 text-sm text-slate-600 dark:text-slate-400">
                    <Link to="/login" className="text-[var(--brand-text)] hover:underline">Back to login</Link>
                </div>
            </div>
        </div>
    );
}
