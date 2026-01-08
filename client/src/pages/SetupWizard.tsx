import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Store, ArrowRight, SkipForward } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useAccount } from '../context/AccountContext';

export function SetupWizard() {
    const [formData, setFormData] = useState({
        name: '',
        domain: '',
        wooUrl: '',
        wooConsumerKey: '',
        wooConsumerSecret: ''
    });
    const [isSubmitting, setIsSubmitting] = useState(false);
    const { token, logout, isLoading: authLoading } = useAuth();
    const { refreshAccounts, currentAccount, accounts, isLoading } = useAccount();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const isAddingNew = searchParams.get('addNew') === 'true';

    // Redirect to login if not authenticated
    useEffect(() => {
        if (!authLoading && !token) {
            navigate('/login', { replace: true });
        }
    }, [authLoading, token, navigate]);

    // Redirect to dashboard if user already has accounts (unless adding new)
    useEffect(() => {
        console.log('[SetupWizard] Redirect check:', { isLoading, accountsLength: accounts.length, isAddingNew });
        if (!isLoading && accounts.length > 0 && !isAddingNew) {
            console.log('[SetupWizard] Redirecting to dashboard');
            navigate('/');
        }
    }, [accounts, isLoading, navigate, isAddingNew]);

    // Show loading during auth check
    if (authLoading) {
        return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
    }

    // Don't render wizard if not authenticated (redirect will happen)
    if (!token) {
        return null;
    }

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    const handleSkip = async () => {
        // Create a demo account to satisfy the AccountGuard
        setIsSubmitting(true);
        try {
            const demoData = {
                name: 'Demo Store',
                domain: 'https://demo.overseek.com',
                wooUrl: 'https://demo.overseek.com',
                wooConsumerKey: 'ck_demo',
                wooConsumerSecret: 'cs_demo'
            };

            const res = await fetch('/api/accounts', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(demoData)
            });

            if (res.status === 401) {
                logout();
                alert('Session expired. Please log in again.');
                return;
            }

            if (!res.ok) throw new Error('Failed to create demo account');

            await refreshAccounts();
            navigate('/');
        } catch (error) {
            console.error('Skip failed:', error);
            alert('Failed to set up demo account. Please try connecting a real store.');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSubmitting(true);

        try {
            const res = await fetch('/api/accounts', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(formData)
            });

            if (res.status === 401) {
                logout();
                alert('Session expired. Please log in again.');
                return;
            }

            if (!res.ok) throw new Error('Failed to create account');

            await refreshAccounts(); // Update context
            navigate('/');
        } catch (error) {
            console.error(error);
            alert('Error creating account. Please check your inputs.');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
            <div className="max-w-2xl w-full bg-white rounded-2xl shadow-xl overflow-hidden">
                <div className="bg-blue-600 p-8 text-white text-center">
                    <Store className="w-16 h-16 mx-auto mb-4 opacity-90" />
                    <h1 className="text-3xl font-bold mb-2">Welcome to OverSeek</h1>
                    <p className="text-blue-100">Let's connect your WooCommerce store to get started.</p>
                </div>

                <div className="p-8">
                    <form onSubmit={handleSubmit} className="space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Store Name</label>
                                <input
                                    type="text"
                                    name="name"
                                    required
                                    placeholder="My Awesome Store"
                                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                                    value={formData.name}
                                    onChange={handleChange}
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Domain URL</label>
                                <input
                                    type="url"
                                    name="domain"
                                    placeholder="https://mystore.com"
                                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                                    value={formData.domain}
                                    onChange={handleChange}
                                />
                            </div>
                        </div>

                        <div className="border-t border-gray-100 pt-6">
                            <h3 className="text-lg font-semibold text-gray-900 mb-4">WooCommerce API Credentials</h3>
                            <p className="text-sm text-gray-500 mb-6 bg-blue-50 p-4 rounded-lg">
                                You can find these in WooCommerce &gt; Settings &gt; Advanced &gt; REST API.
                                Make sure to set permissions to <strong>Read/Write</strong>.
                            </p>

                            <div className="space-y-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Store URL (with https://)</label>
                                    <input
                                        type="url"
                                        name="wooUrl"
                                        required
                                        placeholder="https://mystore.com"
                                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                                        value={formData.wooUrl}
                                        onChange={handleChange}
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Consumer Key (ck_...)</label>
                                    <input
                                        type="text"
                                        name="wooConsumerKey"
                                        required
                                        placeholder="ck_xxxxxxxxxxxxxxxxxxxxxxxx"
                                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none font-mono text-sm"
                                        value={formData.wooConsumerKey}
                                        onChange={handleChange}
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Consumer Secret (cs_...)</label>
                                    <input
                                        type="password"
                                        name="wooConsumerSecret"
                                        required
                                        placeholder="cs_xxxxxxxxxxxxxxxxxxxxxxxx"
                                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none font-mono text-sm"
                                        value={formData.wooConsumerSecret}
                                        onChange={handleChange}
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="flex items-center justify-between pt-6">
                            <button
                                type="button"
                                onClick={handleSkip}
                                className="text-gray-500 hover:text-gray-700 font-medium flex items-center gap-2"
                            >
                                <SkipForward size={18} /> Skip for now
                            </button>

                            <button
                                type="submit"
                                disabled={isSubmitting}
                                className="bg-blue-600 text-white px-8 py-3 rounded-lg hover:bg-blue-700 transition-colors font-bold flex items-center gap-2 shadow-lg hover:shadow-xl disabled:opacity-70"
                            >
                                {isSubmitting ? 'Connecting...' : 'Connect Store'} <ArrowRight size={20} />
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
}
