import { FormEvent, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

export function ResetPasswordPage() {
    const [searchParams] = useSearchParams();
    const token = useMemo(() => searchParams.get('token') || '', [searchParams]);
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (event: FormEvent) => {
        event.preventDefault();
        setError('');
        setMessage('');

        if (!token) {
            setError('Reset token is missing from the link.');
            return;
        }
        if (newPassword.length < 8) {
            setError('Password must be at least 8 characters long.');
            return;
        }
        if (newPassword !== confirmPassword) {
            setError('Passwords do not match.');
            return;
        }

        setLoading(true);
        try {
            const response = await fetch('/api/auth/reset-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token, newPassword })
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Failed to reset password');
            setMessage(data.message || 'Password has been reset successfully.');
            setNewPassword('');
            setConfirmPassword('');
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Failed to reset password');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-4">
            <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm p-6">
                <h1 className="text-xl font-semibold text-slate-900 dark:text-white">Choose a new password</h1>
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">Create a new password for your account.</p>

                <form onSubmit={handleSubmit} className="mt-6 space-y-4">
                    {error ? <div className="text-sm text-rose-600">{error}</div> : null}
                    {message ? <div className="text-sm text-emerald-600">{message}</div> : null}

                    <div>
                        <label htmlFor="new-password" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">New password</label>
                        <input
                            id="new-password"
                            type="password"
                            autoComplete="new-password"
                            required
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-slate-900 dark:text-slate-100"
                        />
                    </div>

                    <div>
                        <label htmlFor="confirm-password" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Confirm password</label>
                        <input
                            id="confirm-password"
                            type="password"
                            autoComplete="new-password"
                            required
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-slate-900 dark:text-slate-100"
                        />
                    </div>

                    <button
                        type="submit"
                        disabled={loading || !token}
                        className="w-full rounded-lg bg-indigo-600 text-white py-2.5 font-medium disabled:opacity-60"
                    >
                        {loading ? 'Resetting...' : 'Reset password'}
                    </button>
                </form>

                <div className="mt-4 text-sm text-slate-600 dark:text-slate-400">
                    <Link to="/login" className="text-indigo-600 dark:text-indigo-400">Back to login</Link>
                </div>
            </div>
        </div>
    );
}
