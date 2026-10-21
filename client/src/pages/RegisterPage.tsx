import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { LayoutDashboard, Loader2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useScopedMutation } from '../hooks/useScopedMutation';
import { isRecord } from '../utils/responseValidation';
import { abortable } from '../utils/abortable';

export function RegisterPage() {
    const { token, user } = useAuth();
    if (token || user) return <p role="status">You are already signed in. <Link to="/dashboard">Go to dashboard</Link></p>;
    return <RegistrationForm />;
}

function RegistrationForm() {
    const [fullName, setFullName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const mutation = useScopedMutation();
    const loading = mutation.busy;
    const [initialSession] = useState(() => localStorage.getItem('token'));
    const { login } = useAuth();
    const navigate = useNavigate();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (mutation.isPending()) return;
        setError('');
        if (fullName.trim().length < 2 || password.length < 8 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setError('Enter a full name, valid email and password of at least 8 characters.'); return; }
        const result = await mutation.run(async signal => {
            const response = await abortable(fetch('/api/auth/register', {
                method: 'POST',
                signal,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ fullName: fullName.trim(), email: email.trim().toLowerCase(), password }),
            }), signal);

            const data: unknown = await abortable(response.json(), signal);

            if (!response.ok) {
                throw new Error('Registration failed');
            }

            if (!isRecord(data) || typeof data.token !== 'string' || !data.token.trim() || typeof data.refreshToken !== 'string' || !data.refreshToken.trim() || !isRecord(data.user) || typeof data.user.id !== 'string' || !data.user.id || typeof data.user.email !== 'string' || (data.user.fullName !== null && typeof data.user.fullName !== 'string') || (data.user.avatarUrl != null && typeof data.user.avatarUrl !== 'string') || (data.user.isSuperAdmin !== undefined && typeof data.user.isSuperAdmin !== 'boolean')) throw new Error('Invalid registration confirmation');
            return { token: data.token, refreshToken: data.refreshToken, user: data.user as unknown as Parameters<typeof login>[1] };
        }, 'Could not confirm registration. Your inputs are retained. Check whether your account was created before retrying or try signing in.');
        if (result.ok && localStorage.getItem('token') === initialSession) {
            login(result.value.token, result.value.user, result.value.refreshToken);
            navigate('/dashboard');
        }
    };

    return (
        <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
            <div className="sm:mx-auto sm:w-full sm:max-w-md">
                <div className="flex justify-center text-blue-600">
                    <LayoutDashboard size={48} />
                </div>
                <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
                    Create your account
                </h2>
                <p className="mt-2 text-center text-sm text-gray-600">
                    Already have an account?{' '}
                    <Link to="/login" className="font-medium text-blue-600 hover:text-blue-500">
                        Sign in
                    </Link>
                </p>
            </div>

            <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
                <div className="bg-white py-8 px-4 shadow-sm sm:rounded-lg sm:px-10">
                    <form className="space-y-6" onSubmit={handleSubmit}>
                        <fieldset disabled={loading} className="space-y-6">
                        {(error || mutation.error) && (
                            <div role="alert" className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-md text-sm">
                                {error || mutation.error}
                            </div>
                        )}

                        <div>
                            <label htmlFor="fullName" className="block text-sm font-medium text-gray-700">
                                Full Name
                            </label>
                            <div className="mt-1">
                                <input
                                    id="fullName"
                                    name="fullName"
                                    autoComplete="name"
                                    minLength={2}
                                    type="text"
                                    required
                                    value={fullName}
                                    onChange={(e) => setFullName(e.target.value)}
                                    className="appearance-none block w-full px-3 py-2 border border-gray-300 rounded-md shadow-xs placeholder-gray-400 focus:outline-hidden focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                                />
                            </div>
                        </div>

                        <div>
                            <label htmlFor="email" className="block text-sm font-medium text-gray-700">
                                Email address
                            </label>
                            <div className="mt-1">
                                <input
                                    id="email"
                                    name="email"
                                    type="email"
                                    autoComplete="email"
                                    required
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    className="appearance-none block w-full px-3 py-2 border border-gray-300 rounded-md shadow-xs placeholder-gray-400 focus:outline-hidden focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                                />
                            </div>
                        </div>

                        <div>
                            <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                                Password
                            </label>
                            <div className="mt-1">
                                <input
                                    id="password"
                                    name="password"
                                    minLength={8}
                                    type="password"
                                    autoComplete="new-password"
                                    required
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    className="appearance-none block w-full px-3 py-2 border border-gray-300 rounded-md shadow-xs placeholder-gray-400 focus:outline-hidden focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                                />
                            </div>
                        </div>

                        <div>
                            <button
                                type="submit"
                                disabled={loading}
                                className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-xs text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {loading ? <><Loader2 aria-hidden="true" className="animate-spin motion-reduce:animate-none" size={20} /><span role="status">Registering...</span></> : 'Register'}
                            </button>
                        </div>
                        </fieldset>
                    </form>
                </div>
            </div>
        </div>
    );
}
