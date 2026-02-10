import { Link } from 'react-router-dom';
import {
    LayoutDashboard,
    BarChart3,
    Package,
    Users,
    Megaphone,
    Eye,
    ShoppingCart,
    ArrowRight,
    Shield,
} from 'lucide-react';

/**
 * Feature descriptor used to render the features grid on the landing page.
 * Kept as static data to avoid re-allocation on every render.
 */
const FEATURES = [
    {
        icon: BarChart3,
        title: 'Analytics & Attribution',
        description:
            'Track revenue, ad spend, and customer acquisition across every channel with real-time dashboards and cohort analysis.',
        gradient: 'from-blue-500 to-cyan-500',
        shadow: 'shadow-blue-500/20',
    },
    {
        icon: ShoppingCart,
        title: 'Order Management',
        description:
            'Centralise orders from WooCommerce and other platforms. Monitor fulfillment, returns, and customer communication in one place.',
        gradient: 'from-violet-500 to-purple-500',
        shadow: 'shadow-violet-500/20',
    },
    {
        icon: Package,
        title: 'Inventory & BOM',
        description:
            'Bill-of-Materials tracking, stock forecasting, and purchase-order management to keep your supply chain running smoothly.',
        gradient: 'from-emerald-500 to-teal-500',
        shadow: 'shadow-emerald-500/20',
    },
    {
        icon: Users,
        title: 'Customer Intelligence',
        description:
            'Segment customers by purchase behaviour, lifetime value, and engagement. Build targeted audiences automatically.',
        gradient: 'from-amber-500 to-orange-500',
        shadow: 'shadow-amber-500/20',
    },
    {
        icon: Megaphone,
        title: 'Marketing Automation',
        description:
            'Design email flows, broadcast campaigns, and AI-generated ad copy — all connected to your live store data.',
        gradient: 'from-rose-500 to-pink-500',
        shadow: 'shadow-rose-500/20',
    },
    {
        icon: Eye,
        title: 'Live Visitor Tracking',
        description:
            'See who is browsing your store in real time. First-party cookie attribution gives you accurate, privacy-friendly insights.',
        gradient: 'from-indigo-500 to-blue-500',
        shadow: 'shadow-indigo-500/20',
    },
] as const;

/**
 * Public landing page rendered at `/`.
 *
 * Why: Google OAuth verification requires the homepage to be publicly
 * accessible and to explain the application's purpose. This page satisfies
 * both requirements while funnelling visitors toward login/register.
 */
export function LandingPage() {
    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-violet-50/20 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 relative overflow-hidden">
            {/* Background decoration */}
            <div className="absolute inset-0 bg-mesh pointer-events-none" />
            <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-blue-400/10 rounded-full blur-3xl" />
            <div className="absolute bottom-0 left-0 w-[600px] h-[600px] bg-violet-400/10 rounded-full blur-3xl" />
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-indigo-400/5 rounded-full blur-3xl" />

            {/* ───── Navbar ───── */}
            <nav className="relative z-20 w-full">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5 flex items-center justify-between">
                    <Link to="/" className="flex items-center gap-3 group">
                        <div className="p-2.5 bg-gradient-to-br from-blue-500 to-violet-600 rounded-xl shadow-lg shadow-blue-500/25 group-hover:shadow-blue-500/40 transition-shadow duration-300">
                            <LayoutDashboard size={22} className="text-white" />
                        </div>
                        <span className="text-xl font-bold text-slate-900 dark:text-white tracking-tight">
                            OverSeek
                        </span>
                    </Link>

                    <div className="flex items-center gap-3">
                        <Link
                            to="/login"
                            className="px-5 py-2.5 text-sm font-semibold text-slate-700 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                        >
                            Sign In
                        </Link>
                        <Link
                            to="/register"
                            className="px-5 py-2.5 text-sm font-semibold text-white bg-gradient-to-r from-blue-500 to-violet-600 hover:from-blue-600 hover:to-violet-700 rounded-xl shadow-lg shadow-blue-500/25 hover:shadow-blue-500/40 hover:-translate-y-0.5 transition-all duration-200"
                        >
                            Get Started
                        </Link>
                    </div>
                </div>
            </nav>

            {/* ───── Hero ───── */}
            <section className="relative z-10 max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pt-16 pb-20 sm:pt-24 sm:pb-28 text-center">
                <div className="inline-flex items-center gap-2 px-4 py-2 bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/20 rounded-full text-sm font-medium text-blue-700 dark:text-blue-400 mb-8 animate-fade-slide-up">
                    <Shield size={14} />
                    Secure, self-hosted eCommerce analytics
                </div>

                <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold text-slate-900 dark:text-white tracking-tight leading-tight animate-fade-slide-up animation-delay-100">
                    All-in-one eCommerce{' '}
                    <span className="text-gradient">Operations Platform</span>
                </h1>

                <p className="mt-6 text-lg sm:text-xl text-slate-600 dark:text-slate-400 max-w-2xl mx-auto leading-relaxed animate-fade-slide-up animation-delay-200">
                    OverSeek connects your WooCommerce store, advertising channels, and
                    customer communications into a single dashboard — giving you real-time
                    visibility over orders, inventory, marketing performance, and customer
                    behaviour.
                </p>

                <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4 animate-fade-slide-up animation-delay-300">
                    <Link
                        to="/register"
                        className="inline-flex items-center gap-2 px-8 py-3.5 text-base font-semibold text-white bg-gradient-to-r from-blue-500 to-violet-600 hover:from-blue-600 hover:to-violet-700 rounded-xl shadow-lg shadow-blue-500/25 hover:shadow-blue-500/40 hover:-translate-y-0.5 transition-all duration-200"
                    >
                        Get Started Free
                        <ArrowRight size={18} />
                    </Link>
                    <Link
                        to="/login"
                        className="inline-flex items-center gap-2 px-8 py-3.5 text-base font-semibold text-slate-700 dark:text-slate-300 bg-white/70 dark:bg-slate-800/70 backdrop-blur-sm border border-slate-200 dark:border-slate-700 rounded-xl hover:border-blue-300 dark:hover:border-blue-600 hover:-translate-y-0.5 transition-all duration-200"
                    >
                        Sign In
                    </Link>
                </div>
            </section>

            {/* ───── Features ───── */}
            <section className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-24">
                <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white text-center mb-4">
                    Everything you need to run your store
                </h2>
                <p className="text-slate-600 dark:text-slate-400 text-center max-w-xl mx-auto mb-14">
                    From analytics to inventory management, OverSeek replaces a dozen
                    plugins and spreadsheets with one integrated platform.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {FEATURES.map((feature) => {
                        const Icon = feature.icon;
                        return (
                            <div
                                key={feature.title}
                                className="group bg-white/70 dark:bg-slate-800/60 backdrop-blur-xl border border-white/60 dark:border-slate-700/50 rounded-2xl p-6 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300"
                            >
                                <div
                                    className={`inline-flex p-3 rounded-xl bg-gradient-to-br ${feature.gradient} shadow-lg ${feature.shadow} mb-4`}
                                >
                                    <Icon size={22} className="text-white" />
                                </div>
                                <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">
                                    {feature.title}
                                </h3>
                                <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                                    {feature.description}
                                </p>
                            </div>
                        );
                    })}
                </div>
            </section>

            {/* ───── Footer ───── */}
            <footer className="relative z-10 border-t border-slate-200/60 dark:border-slate-800/60">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex flex-col sm:flex-row items-center justify-between gap-4">
                    <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                        <LayoutDashboard size={16} className="text-blue-500" />
                        <span>&copy; {new Date().getFullYear()} OverSeek</span>
                    </div>
                    <div className="flex items-center gap-6 text-sm">
                        <Link
                            to="/privacy-policy"
                            className="text-slate-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                        >
                            Privacy Policy
                        </Link>
                        <Link
                            to="/terms-of-service"
                            className="text-slate-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                        >
                            Terms of Service
                        </Link>
                        <Link
                            to="/data-deletion"
                            className="text-slate-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                        >
                            Data Deletion
                        </Link>
                    </div>
                </div>
            </footer>
        </div>
    );
}
