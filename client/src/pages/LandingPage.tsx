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
    Code2 as Github,
} from 'lucide-react';

const GITHUB_URL = 'https://github.com/MerlinStacks/overseek';

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
    },
    {
        icon: ShoppingCart,
        title: 'Order Management',
        description:
            'Centralise orders from WooCommerce and other platforms. Monitor fulfillment, returns, and customer communication in one place.',
    },
    {
        icon: Package,
        title: 'Inventory & BOM',
        description:
            'Bill-of-Materials tracking, stock forecasting, and purchase-order management to keep your supply chain running smoothly.',
    },
    {
        icon: Users,
        title: 'Customer Intelligence',
        description:
            'Segment customers by purchase behaviour, lifetime value, and engagement. Build targeted audiences automatically.',
    },
    {
        icon: Megaphone,
        title: 'Marketing Automation',
        description:
            'Design email flows, broadcast campaigns, and AI-generated ad copy — all connected to your live store data.',
    },
    {
        icon: Eye,
        title: 'Live Visitor Tracking',
        description:
            'See who is browsing your store in real time. First-party cookie attribution gives you accurate, privacy-friendly insights.',
    },
] as const;

/**
 * Public landing page rendered at `/`.
 *
 * Why: Google OAuth verification requires the homepage to be publicly
 * accessible and to explain the application's purpose. This page satisfies
 * both requirements while pointing visitors to the open-source project.
 */
export function LandingPage() {
    return (
        <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">

            {/* ───── Navbar ───── */}
            <nav className="relative z-20 w-full">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5 flex items-center justify-between">
                    <Link to="/" className="flex items-center gap-3 group">
                        <div className="p-2.5 bg-[var(--primary-color)] rounded-lg">
                            <LayoutDashboard size={22} className="text-[var(--primary-foreground)]" />
                        </div>
                        <span className="text-xl font-bold text-slate-900 dark:text-white tracking-tight">
                            OverSeek
                        </span>
                    </Link>

                    <div className="flex items-center gap-3">
                        <Link
                            to="/login"
                            className="px-5 py-2.5 text-sm font-semibold text-slate-700 dark:text-slate-300 hover:text-[var(--brand-text)] focus-visible:outline-[var(--focus-color)] transition-colors"
                        >
                            Sign In
                        </Link>
                        <a
                            href={GITHUB_URL}
                            target="_blank"
                            rel="noreferrer"
                            className="px-5 py-2.5 text-sm font-semibold text-[var(--primary-foreground)] bg-[var(--primary-color)] hover:bg-[var(--primary-hover)] rounded-lg focus-visible:outline-[var(--focus-color)] transition-colors"
                        >
                            GitHub
                        </a>
                    </div>
                </div>
            </nav>

            {/* ───── Hero ───── */}
            <section className="relative z-10 max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pt-16 pb-20 sm:pt-24 sm:pb-28 text-center">
                <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-[var(--brand-subtle)] border border-[var(--brand-border)] rounded-md text-sm font-medium text-[var(--brand-text)] mb-8">
                    <Shield size={14} />
                    Open source and self-hosted
                </div>

                <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold text-slate-900 dark:text-white tracking-tight leading-tight animate-fade-slide-up animation-delay-100">
                    Open-source eCommerce{' '}
                    <span className="text-[var(--brand-text)]">Operations Dashboard</span>
                </h1>

                <p className="mt-6 text-lg sm:text-xl text-slate-600 dark:text-slate-400 max-w-2xl mx-auto leading-relaxed animate-fade-slide-up animation-delay-200">
                    OverSeek is an open-source project for running your own WooCommerce
                    operations hub. Clone the code, deploy it on your infrastructure, and
                    connect your store data, advertising channels, inventory, and customer
                    communications in one dashboard.
                </p>

                <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4 animate-fade-slide-up animation-delay-300">
                    <a
                        href={GITHUB_URL}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-2 px-6 py-3 text-base font-semibold text-[var(--primary-foreground)] bg-[var(--primary-color)] hover:bg-[var(--primary-hover)] rounded-lg focus-visible:outline-[var(--focus-color)] transition-colors"
                    >
                        Get OverSeek on GitHub
                        <Github size={18} />
                    </a>
                    <a
                        href={GITHUB_URL}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-2 px-6 py-3 text-base font-semibold text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg hover:border-[var(--brand-border)] focus-visible:outline-[var(--focus-color)] transition-colors"
                    >
                        View setup instructions
                        <ArrowRight size={18} />
                    </a>
                </div>
            </section>

            {/* ───── Features ───── */}
            <section className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-24">
                <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white text-center mb-4">
                    What you get when you self-host OverSeek
                </h2>
                <p className="text-slate-600 dark:text-slate-400 text-center max-w-xl mx-auto mb-14">
                    The GitHub project includes the frontend, backend, workers, and
                    WooCommerce integration needed to run your own private operations
                    dashboard.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {FEATURES.map((feature) => {
                        const Icon = feature.icon;
                        return (
                            <div
                                key={feature.title}
                                className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6"
                            >
                                <div
                                    className="inline-flex p-2.5 rounded-lg bg-[var(--brand-subtle)] text-[var(--brand-text)] mb-4"
                                >
                                    <Icon size={22} />
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
                        <LayoutDashboard size={16} className="text-[var(--brand-text)]" />
                        <span>&copy; {new Date().getFullYear()} OverSeek</span>
                    </div>
                    <div className="flex items-center gap-6 text-sm">
                        <Link
                            to="/privacy-policy"
                            className="text-slate-500 dark:text-slate-400 hover:text-[var(--brand-text)] transition-colors"
                        >
                            Privacy Policy
                        </Link>
                        <Link
                            to="/terms-of-service"
                            className="text-slate-500 dark:text-slate-400 hover:text-[var(--brand-text)] transition-colors"
                        >
                            Terms of Service
                        </Link>
                        <Link
                            to="/data-deletion"
                            className="text-slate-500 dark:text-slate-400 hover:text-[var(--brand-text)] transition-colors"
                        >
                            Data Deletion
                        </Link>
                    </div>
                </div>
            </footer>
        </div>
    );
}
