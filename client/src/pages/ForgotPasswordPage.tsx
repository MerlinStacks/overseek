import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';

export function ForgotPasswordPage() {
    const [email, setEmail] = useState('');
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (event: FormEvent) => {
        event.preventDefault();
        setError('');
        setMessage('');
        setLoading(true);

        try {
            const response = await fetch('/api/auth/forgot-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email })
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Failed to request password reset');
            setMessage(data.message || 'If an account exists, a reset link has been sent.');
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Failed to request password reset');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-4">
            <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm p-6">
                <h1 className="text-xl font-semibold text-slate-900 dark:text-white">Reset your password</h1>
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">Enter your account email and we will send a reset link.</p>

                <form onSubmit={handleSubmit} className="mt-6 space-y-4">
                    {error ? <div className="text-sm text-rose-600">{error}</div> : null}
                    {message ? <div className="text-sm text-emerald-600">{message}</div> : null}

                    <div>
                        <label htmlFor="email" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Email</label>
                        <input
                            id="email"
                            type="email"
                            required
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-slate-900 dark:text-slate-100"
                            placeholder="you@example.com"
                        />
                    </div>

                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full rounded-lg bg-indigo-600 text-white py-2.5 font-medium disabled:opacity-60"
                    >
                        {loading ? 'Sending...' : 'Send reset link'}
                    </button>
                </form>

                <div className="mt-4 text-sm text-slate-600 dark:text-slate-400">
                    <Link to="/login" className="text-indigo-600 dark:text-indigo-400">Back to login</Link>
                </div>
            </div>
        </div>
    );
}
