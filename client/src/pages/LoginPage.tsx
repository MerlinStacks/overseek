import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { LayoutDashboard, Loader2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export function LoginPage() {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [info, setInfo] = useState('');
    const [loading, setLoading] = useState(false);
    const { login } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const from: unknown = location.state?.from;
    // Only restore local routes, never external URLs or the login page itself.
    const returnTo = typeof from === 'string' && from.startsWith('/') &&
        !from.startsWith('//') && !/[\\\s]/.test(from) && !/^\/login\/*(?:[?#]|$)/i.test(from)
        ? from : '/dashboard';

    // Check for session expired message from global auth error handler
    useEffect(() => {
        const authError = sessionStorage.getItem('authError');
        if (authError) {
            setInfo(authError);
            sessionStorage.removeItem('authError');
        }
    }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setInfo('');
        setLoading(true);

        try {
            const response = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password }),
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Login failed');
            }

            // EDGE CASE FIX: Pass refresh token to auth context for silent refresh
            login(data.token, data.user, data.refreshToken);
            navigate(returnTo, { replace: true });
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Login failed');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col justify-center py-12 sm:px-6 lg:px-8">

            <div className="sm:mx-auto sm:w-full sm:max-w-md relative z-10">
                {/* Application identity */}
                <div className="flex justify-center mb-6">
                    <div className="p-3 bg-[var(--primary-color)] text-[var(--primary-foreground)] rounded-lg">
                        <LayoutDashboard size={32} />
                    </div>
                </div>
                <h2 className="text-center text-3xl font-bold text-slate-900 dark:text-white tracking-tight">
                    Welcome back
                </h2>
                <p className="mt-2 text-center text-sm text-slate-600 dark:text-slate-400">
                    Or{' '}
                    <Link to="/register" className="font-semibold text-[var(--brand-text)] hover:underline transition-colors">
                        create a new account
                    </Link>
                </p>
            </div>

            <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md relative z-10">
                <div className="bg-white dark:bg-slate-900 py-8 px-6 sm:rounded-xl sm:px-10 border border-slate-200 dark:border-slate-800">

                    <form className="space-y-6" onSubmit={handleSubmit}>
                        {error && (
                            <div className="bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 text-rose-600 dark:text-rose-400 px-4 py-3 rounded-xl text-sm">
                                {error}
                            </div>
                        )}

                        {info && (
                            <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 text-amber-700 dark:text-amber-400 px-4 py-3 rounded-xl text-sm">
                                {info}
                            </div>
                        )}

                        <div>
                            <label htmlFor="email" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                                Email address
                            </label>
                            <input
                                id="email"
                                name="email"
                                type="email"
                                autoComplete="email"
                                required
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                className="block w-full px-4 py-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg placeholder-slate-400 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[var(--brand-border)] focus:border-[var(--primary-color)] transition-colors text-sm"
                                placeholder="you@example.com"
                            />
                        </div>

                        <div>
                            <label htmlFor="password" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                                Password
                            </label>
                            <input
                                id="password"
                                name="password"
                                type="password"
                                autoComplete="current-password"
                                required
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="block w-full px-4 py-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg placeholder-slate-400 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[var(--brand-border)] focus:border-[var(--primary-color)] transition-colors text-sm"
                                placeholder="********"
                            />
                        </div>

                        <div className="flex items-center justify-between">
                            <div className="flex items-center">
                                <input
                                    id="remember-me"
                                    name="remember-me"
                                    type="checkbox"
                                    className="h-4 w-4 text-[var(--primary-color)] accent-[var(--primary-color)] focus:ring-[var(--focus-color)] border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-800"
                                />
                                <label htmlFor="remember-me" className="ml-2 block text-sm text-slate-700 dark:text-slate-300">
                                    Remember me
                                </label>
                            </div>

                            <div className="text-sm">
                                <Link to="/forgot-password" className="font-medium text-[var(--brand-text)] hover:underline transition-colors">
                                    Forgot password?
                                </Link>
                            </div>
                        </div>

                        <div>
                            <button
                                type="submit"
                                disabled={loading}
                                className="w-full flex justify-center py-3 px-4 rounded-lg text-sm font-semibold text-[var(--primary-foreground)] bg-[var(--primary-color)] hover:bg-[var(--primary-hover)] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[var(--focus-color)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            >
                                {loading ? <Loader2 className="animate-spin" size={20} /> : 'Sign in'}
                            </button>
                        </div>
                    </form>

                    <div className="mt-6 pt-6 border-t border-slate-200/60 dark:border-slate-700/50 text-center">
                        <Link to="/privacy-policy" className="text-sm text-slate-500 dark:text-slate-400 hover:text-[var(--brand-text)] transition-colors">
                            Privacy Policy
                        </Link>
                    </div>
                </div>
            </div>
        </div>
    );
}
