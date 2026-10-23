import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { useRecoveryAttempt } from '../hooks/useRecoveryAttempt';

export function ForgotPasswordPage() {
    const attempt = useRecoveryAttempt();
    const [email, setEmail] = useState('');
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (event: FormEvent) => {
        event.preventDefault();
        if (email.trim().length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setError('Enter a valid email address.'); return; }
        const request = attempt.begin(); if (!request) return;
        const timer = setTimeout(() => request.abort(), 20000);
        setError('');
        setMessage('');
        setLoading(true);

        try {
            const response = await fetch('/api/auth/forgot-password', {
                signal: request.signal,
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: email.trim() })
            });
            const data = await response.json();
            if (!response.ok || !data || typeof data.message !== 'string' || data.message.length > 1000) throw new Error('Invalid acknowledgement');
            if (attempt.current(request)) setMessage('If an account exists, a reset link has been sent.');
        } catch (err: unknown) {
            if (attempt.current(request, true)) setError('Request was not acknowledged. Check your inbox before trying again.');
        } finally {
            clearTimeout(timer); attempt.finish();
            if (attempt.current(request, true)) setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-4">
            <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6">
                <h1 className="text-xl font-semibold text-slate-900 dark:text-white">Reset your password</h1>
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">Enter your account email and we will send a reset link.</p>

                <form onSubmit={handleSubmit} className="mt-6 space-y-4">
                    {error ? <div role="alert" className="text-sm text-rose-600">{error}</div> : null}
                    {message ? <div role="status" className="text-sm text-emerald-600">{message}</div> : null}

                    <div>
                        <label htmlFor="email" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Email</label>
                        <input
                            id="email"
                            type="email"
                            autoComplete="email"
                            maxLength={254}
                            disabled={loading}
                            required
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[var(--brand-border)] focus:border-[var(--primary-color)]"
                            placeholder="you@example.com"
                        />
                    </div>

                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full rounded-lg bg-[var(--primary-color)] text-[var(--primary-foreground)] py-2.5 font-medium hover:bg-[var(--primary-hover)] focus-visible:outline-[var(--focus-color)] disabled:opacity-60"
                    >
                        {loading ? 'Sending...' : 'Send reset link'}
                    </button>
                </form>

                <div className="mt-4 text-sm text-slate-600 dark:text-slate-400">
                    <Link to="/login" className="text-[var(--brand-text)] hover:underline">Back to login</Link>
                </div>
            </div>
        </div>
    );
}
